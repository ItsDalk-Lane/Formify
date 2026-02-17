/**
 * 远程 SSE MCP 传输层
 *
 * - 通过 GET 建立持久 SSE 连接接收消息
 * - 通过独立 POST 请求发送 JSON-RPC 消息
 */

import { feedChunk, type ParsedSSEEvent } from '../../providers/sse'
import { DebugLogger } from 'src/utils/DebugLogger'
import type { ITransport, JsonRpcMessage, JsonRpcResponse } from './ITransport'
import { isJsonRpcRequest } from './ITransport'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000]

export interface RemoteSseTransportConfig {
	/** SSE endpoint URL */
	url: string
	/** 自定义请求头 */
	headers?: Record<string, string>
	/** 请求超时时间（毫秒） */
	timeout: number
}

export class RemoteSseTransport implements ITransport {
	private stopped = true
	private started = false
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private sseAbortController: AbortController | null = null
	private inFlightPostRequests = new Set<AbortController>()
	private postUrl: string

	onMessage: ((msg: JsonRpcMessage) => void) | null = null
	onClose: ((code: number | null) => void) | null = null
	onError: ((error: Error) => void) | null = null

	constructor(private readonly config: RemoteSseTransportConfig) {
		this.postUrl = config.url
	}

	async start(): Promise<void> {
		if (this.started && !this.stopped) return

		this.started = true
		this.stopped = false
		this.reconnectAttempt = 0
		this.postUrl = this.config.url

		await this.openSseConnection(true)
	}

	send(message: JsonRpcMessage): void {
		if (!this.started || this.stopped) {
			throw new Error('Remote SSE 传输层未启动，无法发送消息')
		}

		void this.sendViaPost(message)
	}

	async stop(): Promise<void> {
		if (!this.started) return

		this.stopped = true
		this.started = false

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		if (this.sseAbortController) {
			this.sseAbortController.abort()
			this.sseAbortController = null
		}

		for (const controller of this.inFlightPostRequests) {
			controller.abort()
		}
		this.inFlightPostRequests.clear()

		this.onClose?.(1000)
		DebugLogger.info('[MCP:remote-sse] 传输层已停止')
	}

	private async openSseConnection(isInitial: boolean): Promise<void> {
		if (this.stopped) return

		const controller = new AbortController()
		this.sseAbortController = controller

		const timeoutMs = this.getTimeout()
		const timeoutId = setTimeout(() => {
			controller.abort()
		}, timeoutMs)

		try {
			DebugLogger.info(`[MCP:remote-sse] 正在连接 SSE: ${this.config.url}`)
			const response = await fetch(this.config.url, {
				method: 'GET',
				headers: this.buildSseHeaders(),
				signal: controller.signal,
			})
			clearTimeout(timeoutId)

			if (!response.ok) {
				const responseText = await response.text().catch(() => '')
				const detail = responseText.trim().slice(0, 300)
				throw new Error(
					detail
						? `SSE 连接失败 (${response.status}): ${detail}`
						: `SSE 连接失败 (${response.status})`
				)
			}

			if (!response.body) {
				throw new Error('SSE 响应体不可读')
			}

			this.reconnectAttempt = 0
			DebugLogger.info(`[MCP:remote-sse] SSE 已连接: ${this.config.url}`)

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
			void this.readSseLoop(reader, controller)
		} catch (err) {
			clearTimeout(timeoutId)
			if (this.stopped) return

			const error = controller.signal.aborted
				? new Error(`SSE 连接超时 (${timeoutMs}ms): ${this.config.url}`)
				: new Error(`SSE 连接失败: ${err instanceof Error ? err.message : String(err)}`)

			this.reportError(error)

			if (isInitial) {
				throw error
			}

			this.scheduleReconnect()
		}
	}

	private async readSseLoop(reader: ReadableStreamDefaultReader<string>, controller: AbortController): Promise<void> {
		let rest = ''

		try {
			while (!this.stopped && !controller.signal.aborted) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}

				const parsed = feedChunk(rest, value)
				rest = parsed.rest
				this.handleSseEvents(parsed.events)
			}

			if (rest.trim()) {
				const flushed = feedChunk(rest, '\n\n')
				rest = flushed.rest
				this.handleSseEvents(flushed.events)
			}
		} catch (err) {
			if (!this.stopped && !controller.signal.aborted) {
				this.reportError(
					new Error(`SSE 读取失败: ${err instanceof Error ? err.message : String(err)}`)
				)
			}
		} finally {
			try {
				reader.releaseLock()
			} catch {
				// ignore
			}

			if (this.sseAbortController === controller) {
				this.sseAbortController = null
			}

			if (!this.stopped && !controller.signal.aborted) {
				DebugLogger.warn('[MCP:remote-sse] SSE 连接已断开，准备重连')
				this.scheduleReconnect()
			}
		}
	}

	private handleSseEvents(events: ParsedSSEEvent[]): void {
		for (const event of events) {
			const endpoint = this.extractEndpoint(event)
			if (endpoint) {
				this.postUrl = endpoint
				DebugLogger.info(`[MCP:remote-sse] 更新 POST endpoint: ${this.postUrl}`)
				continue
			}

			if (event.parseError) {
				this.reportError(new Error(`SSE 消息解析失败: ${event.parseError}`))
				continue
			}

			const message = this.extractJsonRpcMessage(event)
			if (message) {
				this.onMessage?.(message)
			}
		}
	}

	private extractEndpoint(event: ParsedSSEEvent): string | null {
		if (event.event !== 'endpoint') return null

		const raw = event.data.trim()
		if (!raw) return null

		let candidate: string | null = null
		if (event.json && typeof event.json === 'object' && event.json !== null) {
			const json = event.json as { endpoint?: unknown; url?: unknown }
			if (typeof json.endpoint === 'string' && json.endpoint.trim()) {
				candidate = json.endpoint.trim()
			} else if (typeof json.url === 'string' && json.url.trim()) {
				candidate = json.url.trim()
			}
		}

		if (!candidate) {
			candidate = raw
		}

		try {
			return new URL(candidate, this.config.url).toString()
		} catch {
			return candidate
		}
	}

	private extractJsonRpcMessage(event: ParsedSSEEvent): JsonRpcMessage | null {
		if (event.event === 'endpoint') return null

		if (event.json && this.isJsonRpcLike(event.json)) {
			return event.json as JsonRpcMessage
		}

		const raw = event.data.trim()
		if (!raw || !/^[\[{]/.test(raw)) return null

		try {
			const parsed = JSON.parse(raw) as unknown
			if (this.isJsonRpcLike(parsed)) {
				return parsed as JsonRpcMessage
			}
		} catch {
			// 由 parseError 路径处理
		}

		return null
	}

	private async sendViaPost(message: JsonRpcMessage): Promise<void> {
		const controller = new AbortController()
		this.inFlightPostRequests.add(controller)

		const timeoutMs = this.getTimeout()
		const timeoutId = setTimeout(() => {
			controller.abort()
		}, timeoutMs)

		try {
			const response = await fetch(this.postUrl, {
				method: 'POST',
				headers: this.buildPostHeaders(),
				body: JSON.stringify(message),
				signal: controller.signal,
			})

			if (!response.ok) {
				const responseText = await response.text().catch(() => '')
				const detail = responseText.trim().slice(0, 300)
				const error = new Error(
					detail
						? `POST 请求失败 (${response.status}): ${detail}`
						: `POST 请求失败 (${response.status})`
				)
				this.reportPostError(message, error)
				return
			}

			const responseText = (await response.text()).trim()
			if (!responseText) {
				return
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(responseText)
			} catch {
				this.reportPostError(message, new Error(`POST 响应解析失败: ${responseText.slice(0, 200)}`))
				return
			}

			if (!this.isJsonRpcLike(parsed)) {
				this.reportPostError(message, new Error('POST 响应不是有效的 JSON-RPC 消息'))
				return
			}

			this.onMessage?.(parsed as JsonRpcMessage)
		} catch (err) {
			if (controller.signal.aborted && this.stopped) {
				return
			}

			const error = controller.signal.aborted
				? new Error(`POST 请求超时 (${timeoutMs}ms): ${this.postUrl}`)
				: new Error(`POST 请求失败: ${err instanceof Error ? err.message : String(err)}`)
			this.reportPostError(message, error)
		} finally {
			clearTimeout(timeoutId)
			this.inFlightPostRequests.delete(controller)
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return

		const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
		this.reconnectAttempt += 1

		const reconnectErr = new Error(`SSE 连接断开，将在 ${delay}ms 后重连`)
		this.reportError(reconnectErr)

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (this.stopped) return
			void this.openSseConnection(false)
		}, delay)
	}

	private reportPostError(message: JsonRpcMessage, error: Error): void {
		this.reportError(error)

		if (isJsonRpcRequest(message)) {
			const response: JsonRpcResponse = {
				jsonrpc: '2.0',
				id: message.id,
				error: {
					code: -32000,
					message: error.message,
				},
			}
			this.onMessage?.(response)
		}
	}

	private reportError(error: Error): void {
		DebugLogger.error('[MCP:remote-sse] 传输错误', error)
		this.onError?.(error)
	}

	private getTimeout(): number {
		return this.config.timeout > 0 ? this.config.timeout : 30000
	}

	private buildSseHeaders(): Record<string, string> {
		return {
			Accept: 'text/event-stream',
			'Cache-Control': 'no-cache',
			...(this.config.headers ?? {}),
		}
	}

	private buildPostHeaders(): Record<string, string> {
		return {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
			...(this.config.headers ?? {}),
		}
	}

	private isJsonRpcLike(value: unknown): value is JsonRpcMessage {
		return typeof value === 'object' && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === '2.0'
	}
}
