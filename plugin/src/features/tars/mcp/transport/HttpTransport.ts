/**
 * 基于 HTTP POST 的 MCP 传输层
 *
 * 每次发送 JSON-RPC 消息都发起一次独立 HTTP 请求
 */

import { requestUrl } from 'obsidian'
import { feedChunk } from '../../providers/sse'
import { DebugLogger } from 'src/utils/DebugLogger'
import type { ITransport, JsonRpcMessage, JsonRpcResponse } from './ITransport'
import { isJsonRpcRequest } from './ITransport'

export interface HttpTransportConfig {
	/** HTTP endpoint URL */
	url: string
	/** 自定义请求头 */
	headers?: Record<string, string>
	/** 请求超时时间（毫秒） */
	timeout: number
}

export class HttpTransport implements ITransport {
	private started = false
	private inFlightRequests = new Set<symbol>()
	/** Streamable HTTP 会话 ID（服务端返回后需在后续请求中携带） */
	private sessionId: string | null = null

	onMessage: ((msg: JsonRpcMessage) => void) | null = null
	onClose: ((code: number | null) => void) | null = null
	onError: ((error: Error) => void) | null = null

	constructor(private readonly config: HttpTransportConfig) {}

	async start(): Promise<void> {
		this.started = true
		DebugLogger.info(`[MCP:http] 传输层已就绪: ${this.config.url}`)
	}

	send(message: JsonRpcMessage): void {
		if (!this.started) {
			throw new Error('HTTP 传输层未启动，无法发送消息')
		}

		void this.sendInternal(message)
	}

	private async sendInternal(message: JsonRpcMessage): Promise<void> {
		const token = Symbol('http-request')
		this.inFlightRequests.add(token)
		const timeoutMs = this.getTimeout()

		try {
			const response = await this.requestWithTimeout(
				() => requestUrl({
					url: this.config.url,
					method: 'POST',
					headers: this.buildHeaders(),
					body: JSON.stringify(message),
				}),
				timeoutMs,
				`HTTP 请求超时 (${timeoutMs}ms): ${this.config.url}`,
			)
			if (!this.started) return
			this.captureSessionId(response.headers)
			const responseText = typeof response.text === 'string' ? response.text : ''

			if (response.status < 200 || response.status >= 300) {
				const detail = responseText.trim().slice(0, 300)
				if (response.status === 404 && this.sessionId) {
					this.sessionId = null
				}
				const errMsg = detail
					? `HTTP 请求失败 (${response.status}): ${detail}`
					: `HTTP 请求失败 (${response.status})`
				this.reportError(message, new Error(errMsg))
				return
			}

			// 通知/响应-only 请求在 streamable-http 下可返回 202 且无响应体
			if (response.status === 202) {
				return
			}

			const contentType = (this.getHeaderValue(response.headers, 'content-type') || '').toLowerCase()
			if (contentType.includes('text/event-stream')) {
				this.consumeSseText(responseText, message)
				return
			}

			const trimmed = responseText.trim()
			if (!trimmed) {
				return
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(trimmed)
			} catch {
				this.reportError(message, new Error(`HTTP 响应解析失败: ${trimmed.slice(0, 200)}`))
				return
			}

			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (!this.isJsonRpcLike(item)) {
						this.reportError(message, new Error('HTTP 响应批处理中存在无效的 JSON-RPC 消息'))
						return
					}
					this.onMessage?.(item as JsonRpcMessage)
				}
			} else {
				if (!this.isJsonRpcLike(parsed)) {
					this.reportError(message, new Error('HTTP 响应不是有效的 JSON-RPC 消息'))
					return
				}
				this.onMessage?.(parsed as JsonRpcMessage)
			}
		} catch (err) {
			if (!this.started) {
				return
			}

			const rawError = err instanceof Error ? err : new Error(String(err))
			if (
				rawError.message.startsWith('HTTP 请求超时')
				|| rawError.message.startsWith('HTTP 请求失败')
			) {
				this.reportError(message, rawError)
			} else {
				this.reportError(message, new Error(`HTTP 请求失败: ${rawError.message}`))
			}
		} finally {
			this.inFlightRequests.delete(token)
		}
	}

	async stop(): Promise<void> {
		if (!this.started) return

		this.started = false
		this.inFlightRequests.clear()

		const sessionId = this.sessionId
		this.sessionId = null
		if (sessionId) {
			void this.tryDeleteSession(sessionId)
		}

		this.onClose?.(1000)
		DebugLogger.info('[MCP:http] 传输层已停止')
	}

	private getTimeout(): number {
		return this.config.timeout > 0 ? this.config.timeout : 30000
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
			...(this.config.headers ?? {}),
		}
		if (this.sessionId) {
			headers['Mcp-Session-Id'] = this.sessionId
		}
		return headers
	}

	private reportError(message: JsonRpcMessage, error: Error): void {
		DebugLogger.error('[MCP:http] 传输错误', error)
		this.onError?.(error)

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

	private isJsonRpcLike(value: unknown): value is JsonRpcMessage {
		return typeof value === 'object' && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === '2.0'
	}

	private captureSessionId(headers: Record<string, string>): void {
		const sessionId = this.getHeaderValue(headers, 'mcp-session-id')?.trim()
		if (!sessionId) return
		if (this.sessionId !== sessionId) {
			this.sessionId = sessionId
			DebugLogger.info(`[MCP:http] 获取会话 ID: ${sessionId}`)
		}
	}

	private consumeSseText(text: string, message: JsonRpcMessage): void {
		if (!text.trim()) {
			return
		}

		let rest = ''
		const parsed = feedChunk(rest, text)
		rest = parsed.rest
		for (const event of parsed.events) {
			this.handleSseEvent(event, message)
		}

		if (rest.trim()) {
			const flushed = feedChunk(rest, '\n\n')
			for (const event of flushed.events) {
				this.handleSseEvent(event, message)
			}
		}
	}

	private handleSseEvent(
		event: { json?: unknown; data: string; parseError?: string; isDone?: boolean },
		message: JsonRpcMessage,
	): void {
		if (event.isDone) return
		if (event.parseError) {
			this.reportError(message, new Error(`SSE 事件解析失败: ${event.parseError}`))
			return
		}

		let payload: unknown = event.json
		if (!payload) {
			const raw = event.data.trim()
			if (!raw) return
			try {
				payload = JSON.parse(raw)
			} catch {
				this.reportError(message, new Error(`SSE 事件不是有效 JSON: ${raw.slice(0, 200)}`))
				return
			}
		}

		if (Array.isArray(payload)) {
			for (const item of payload) {
				if (this.isJsonRpcLike(item)) {
					this.onMessage?.(item as JsonRpcMessage)
				}
			}
			return
		}

		if (this.isJsonRpcLike(payload)) {
			this.onMessage?.(payload as JsonRpcMessage)
		}
	}

	private async tryDeleteSession(sessionId: string): Promise<void> {
		const timeoutMs = this.getTimeout()
		try {
			await this.requestWithTimeout(
				() => requestUrl({
					url: this.config.url,
					method: 'DELETE',
					headers: {
						Accept: 'application/json, text/event-stream',
						...(this.config.headers ?? {}),
						'Mcp-Session-Id': sessionId,
					},
				}),
				timeoutMs,
				`HTTP 请求超时 (${timeoutMs}ms): ${this.config.url}`,
			)
		} catch {
			// 部分服务端不支持 DELETE/会话终止，忽略即可
		}
	}

	private getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
		const target = name.toLowerCase()
		for (const [key, value] of Object.entries(headers)) {
			if (key.toLowerCase() === target) return value
		}
		return undefined
	}

	private async requestWithTimeout<T>(
		runner: () => Promise<T>,
		timeoutMs: number,
		timeoutMessage: string,
	): Promise<T> {
		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
			runner()
				.then((result) => resolve(result))
				.catch((err) => reject(err))
				.finally(() => clearTimeout(timeoutId))
		})
	}
}
