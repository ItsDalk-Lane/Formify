/**
 * MCP 协议客户端
 *
 * 管理与单个 MCP 服务器的 JSON-RPC 2.0 通信
 * 实现 MCP 协议握手、工具列表获取、工具调用等功能
 */

import { Notice } from 'obsidian'
import { DebugLogger } from 'src/utils/DebugLogger'
import type { McpServerConfig, McpServerStatus, McpToolInfo } from './types'
import type { ITransport, JsonRpcMessage, JsonRpcResponse } from './transport/ITransport'
import { isJsonRpcResponse, isJsonRpcNotification } from './transport/ITransport'
import { StdioTransport } from './transport/StdioTransport'
import { WebSocketTransport } from './transport/WebSocketTransport'
import { HttpTransport } from './transport/HttpTransport'
import { RemoteSseTransport } from './transport/RemoteSseTransport'

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05'
/** tools/call 的可重试次数（不含首次） */
const MCP_TOOL_CALL_MAX_RETRIES = 2
/** tools/call 重试退避（毫秒） */
const MCP_TOOL_CALL_RETRY_DELAYS_MS = [600, 1500]

/**
 * JSON-RPC 错误（附带错误码），用于区分业务错误和通信故障
 *
 * 业务级错误（如 -400 ~ -499，表示参数/资源不存在等）不应触发 Notice 弹窗，
 * 而应作为工具结果返回给 AI 继续推理。
 */
class McpJsonRpcError extends Error {
	readonly code: number
	constructor(message: string, code: number) {
		super(message)
		this.name = 'McpJsonRpcError'
		this.code = code
	}
}

/**
 * 判断 MCP JSON-RPC 错误码是否属于业务级错误
 *
 * 业务级错误：工具调用的远端 API 返回的语义性错误，如 "repo not found"、"permission denied"。
 * 这些错误应作为工具结果文本返回给 AI，而非作为系统级失败弹窗通知用户。
 */
function isBusinessLevelMcpError(err: unknown): boolean {
	if (!(err instanceof McpJsonRpcError)) return false
	const code = err.code
	// 通常负值的 4xx 范围或自定义业务码视为业务级错误
	// MCP 规范中常见的业务错误码：-400（参数/资源问题）
	return (code <= -400 && code > -500) || (code >= 400 && code < 500)
}

/** 待处理请求 */
interface PendingRequest {
	resolve: (result: unknown) => void
	reject: (error: Error) => void
	timer: ReturnType<typeof setTimeout>
}

export class McpClient {
	private transport: ITransport | null = null
	private requestId = 0
	private pendingRequests = new Map<number, PendingRequest>()
	private _status: McpServerStatus = 'idle'
	private _tools: McpToolInfo[] = []
	private lastToolCallNoticeAt = 0

	constructor(
		private readonly config: McpServerConfig,
		private readonly onStatusChange: (status: McpServerStatus, error?: string) => void,
		private readonly onToolsChange: (tools: McpToolInfo[]) => void,
	) {}

	/** 当前状态 */
	get status(): McpServerStatus {
		return this._status
	}

	/** 当前可用工具 */
	get tools(): McpToolInfo[] {
		return this._tools
	}

	/** 传输层 PID（仅 stdio） */
	get pid(): number | undefined {
		if (this.transport instanceof StdioTransport) {
			return this.transport.pid
		}
		return undefined
	}

	/** 连接到 MCP 服务器并完成协议握手 */
	async connect(): Promise<void> {
		if (this._status === 'running') return

		this.updateStatus('connecting')

		try {
			this.transport = this.createTransport()
			this.transport.onMessage = (msg) => this.handleMessage(msg)
			this.transport.onClose = (code) => this.handleClose(code)
			this.transport.onError = (err) => this.handleError(err)

			await this.transport.start()

			// MCP 协议握手: initialize
			const initResult = await this.sendRequest('initialize', {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: 'formify', version: '1.0.0' },
			}) as { protocolVersion: string; capabilities: Record<string, unknown>; serverInfo?: { name: string; version?: string } }

			DebugLogger.info(
				`[MCP] 服务器握手成功: ${this.config.name}`,
				`协议版本=${initResult.protocolVersion}`,
				initResult.serverInfo ? `服务器=${initResult.serverInfo.name}` : '',
			)

			// 发送 initialized 通知
			this.sendNotification('notifications/initialized')

			// 获取工具列表
			await this.refreshTools()

			this.updateStatus('running')
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)
			DebugLogger.error(`[MCP] 连接失败: ${this.config.name}`, err)
			new Notice(`MCP 连接失败 (${this.config.name}): ${errorMsg}`, 5000)
			this.updateStatus('error', errorMsg)
			throw err
		}
	}

	/** 获取/刷新工具列表 */
	async refreshTools(): Promise<McpToolInfo[]> {
		const result = await this.sendRequest('tools/list', {}) as {
			tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
		}

		this._tools = (result.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? '',
			inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
			serverId: this.config.id,
		}))

		DebugLogger.info(`[MCP] ${this.config.name}: 获取到 ${this._tools.length} 个工具`)
		this.onToolsChange(this._tools)
		return this._tools
	}

	/** 调用 MCP 工具 */
	async callTool(name: string, args: Record<string, unknown>): Promise<string> {
		DebugLogger.debug(`[MCP] 调用工具: ${this.config.name}/${name}`, args)
		let lastError: unknown = null

		for (let attempt = 0; attempt <= MCP_TOOL_CALL_MAX_RETRIES; attempt++) {
			try {
				const result = await this.sendRequest('tools/call', {
					name,
					arguments: args,
				}) as {
					content: Array<{ type: string; text?: string }>
					isError?: boolean
				}

				// 合并所有 text 类型的 content
				const textParts = (result.content ?? [])
					.filter((c) => c.type === 'text' && c.text)
					.map((c) => c.text as string)

				const text = textParts.join('\n')

				if (result.isError) {
					// MCP 协议层面的 isError 标记：工具执行本身返回了错误信息
					// 这属于业务级反馈，直接返回错误文本给调用方（AI 可据此推理）
					DebugLogger.warn(`[MCP] 工具返回业务错误: ${name}: ${text.slice(0, 200)}`)
					return `[工具执行错误] ${text}`
				}

				DebugLogger.debug(`[MCP] 工具调用完成: ${name}, 返回 ${text.length} 字符`)
				return text
			} catch (err) {
				lastError = err

				// 业务级错误（如 -400: repo not found）不重试、不弹 Notice，
				// 直接返回错误信息作为工具结果让 AI 继续推理
				if (isBusinessLevelMcpError(err)) {
					const msg = err instanceof Error ? err.message : String(err)
					DebugLogger.warn(`[MCP] 工具业务级错误（不重试）: ${name}: ${msg}`)
					return `[工具执行错误] ${msg}`
				}

				const canRetry =
					attempt < MCP_TOOL_CALL_MAX_RETRIES && this.isRetryableToolCallError(err)

				if (!canRetry) {
					this.reportToolCallFailure(name, args, err)
					throw err
				}

				if (this.shouldReconnectBeforeRetry(err, attempt)) {
					try {
						DebugLogger.warn(`[MCP] 工具调用失败，尝试重连后重试: ${name}`)
						await this.reconnectForToolCallRetry()
					} catch (reconnectErr) {
						DebugLogger.warn('[MCP] tools/call 重连恢复失败，继续按重试策略执行', reconnectErr)
					}
				}

				const delayMs =
					MCP_TOOL_CALL_RETRY_DELAYS_MS[
						Math.min(attempt, MCP_TOOL_CALL_RETRY_DELAYS_MS.length - 1)
					]
				DebugLogger.warn(
					`[MCP] 工具调用失败，准备重试 (${attempt + 1}/${MCP_TOOL_CALL_MAX_RETRIES}): ${name}`,
					err,
				)
				await this.wait(delayMs)
			}
		}

		this.reportToolCallFailure(name, args, lastError)
		throw lastError instanceof Error ? lastError : new Error(`MCP 工具调用失败 [${name}]`)
	}

	/** 断开连接 */
	async disconnect(): Promise<void> {
		if (!this.transport) return

		this.updateStatus('stopping')

		// 拒绝所有待处理请求
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(new Error('MCP 客户端断开连接'))
			this.pendingRequests.delete(id)
		}

		try {
			await this.transport.stop()
		} catch (err) {
			DebugLogger.warn(`[MCP] 停止传输层时出错`, err)
		}

		this.transport = null
		this._tools = []
		this.updateStatus('stopped')
	}

	/** 创建传输层实例 */
	private createTransport(): ITransport {
		switch (this.config.transportType) {
		case 'stdio':
		case 'sse': // legacy: 兼容旧配置，继续使用本地 stdio 传输
			if (!this.config.command) {
				throw new Error(`MCP 服务器 "${this.config.name}" 未配置启动命令`)
			}
			return new StdioTransport({
				command: this.config.command,
				args: this.config.args ?? [],
				env: this.config.env,
				cwd: this.config.cwd,
			})
		case 'websocket':
			if (!this.config.url) {
				throw new Error(`MCP 服务器 "${this.config.name}" 未配置 WebSocket URL`)
			}
			return new WebSocketTransport({ url: this.config.url })
		case 'http':
			if (!this.config.url) {
				throw new Error(`MCP 服务器 "${this.config.name}" 未配置 HTTP URL`)
			}
			return new HttpTransport({
				url: this.config.url,
				headers: this.config.headers,
				timeout: this.config.timeout,
			})
		case 'remote-sse':
			if (!this.config.url) {
				throw new Error(`MCP 服务器 "${this.config.name}" 未配置 Remote SSE URL`)
			}
			return new RemoteSseTransport({
				url: this.config.url,
				headers: this.config.headers,
				timeout: this.config.timeout,
			})
		default:
			throw new Error(`不支持的传输类型: ${this.config.transportType}`)
		}
	}

	/** 发送 JSON-RPC 请求并等待响应 */
	private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.transport) {
				reject(new Error('传输层未初始化'))
				return
			}

			const id = ++this.requestId
			const timeout = this.config.timeout || 30000

			const timer = setTimeout(() => {
				this.pendingRequests.delete(id)
				reject(new Error(`MCP 请求超时 (${timeout}ms): ${method}`))
			}, timeout)

			this.pendingRequests.set(id, { resolve, reject, timer })

			const message: JsonRpcMessage = {
				jsonrpc: '2.0',
				id,
				method,
				...(params !== undefined ? { params } : {}),
			}

			try {
				this.transport.send(message)
			} catch (err) {
				clearTimeout(timer)
				this.pendingRequests.delete(id)
				reject(err)
			}
		})
	}

	/** 发送 JSON-RPC 通知（无响应） */
	private sendNotification(method: string, params?: Record<string, unknown>): void {
		if (!this.transport) return

		const message: JsonRpcMessage = {
			jsonrpc: '2.0',
			method,
			...(params !== undefined ? { params } : {}),
		}

		try {
			this.transport.send(message)
		} catch (err) {
			DebugLogger.warn(`[MCP] 发送通知失败: ${method}`, err)
		}
	}

	/** 处理传输层收到的消息 */
	private handleMessage(msg: JsonRpcMessage): void {
		// 某些可恢复错误（如 remote-sse 重连）在收到新消息后自动恢复为 running
		if (this._status === 'error') {
			this.updateStatus('running')
		}

		if (isJsonRpcResponse(msg)) {
			this.handleResponse(msg)
		} else if (isJsonRpcNotification(msg)) {
			this.handleNotification(msg)
		}
		// 忽略请求类消息（MCP 客户端不处理服务器发起的请求）
	}

	/** 处理 JSON-RPC 响应 */
	private handleResponse(response: JsonRpcResponse): void {
		const pending = this.pendingRequests.get(response.id)
		if (!pending) {
			DebugLogger.warn(`[MCP] 收到未知请求 ID 的响应: ${response.id}`)
			return
		}

		clearTimeout(pending.timer)
		this.pendingRequests.delete(response.id)

		if (response.error) {
			const err = new McpJsonRpcError(
				`MCP error ${response.error.code}: ${response.error.message}`,
				response.error.code,
			)
			pending.reject(err)
		} else {
			pending.resolve(response.result)
		}
	}

	/** 处理 JSON-RPC 通知 */
	private handleNotification(msg: JsonRpcMessage): void {
		if (!('method' in msg)) return

		switch (msg.method) {
		case 'notifications/tools/list_changed':
			DebugLogger.info(`[MCP] ${this.config.name}: 工具列表已更新，正在重新获取...`)
			this.refreshTools().catch((err) => {
				DebugLogger.error(`[MCP] 刷新工具列表失败`, err)
			})
			break
		default:
			DebugLogger.debug(`[MCP] 收到通知: ${msg.method}`)
			break
		}
	}

	/** 处理传输层关闭 */
	private handleClose(code: number | null): void {
		// 如果不是主动停止，标记为错误
		if (this._status !== 'stopping' && this._status !== 'stopped') {
			this.updateStatus('error', `MCP 服务器进程意外退出 (code=${code})`)
		}
	}

	/** 处理传输层错误 */
	private handleError(err: Error): void {
		if (this._status !== 'stopping' && this._status !== 'stopped') {
			this.updateStatus('error', err.message)
		}
	}

	/** 更新状态并通知外部 */
	private updateStatus(status: McpServerStatus, error?: string): void {
		this._status = status
		this.onStatusChange(status, error)
	}

	/** 判断 tools/call 错误是否可重试 */
	private isRetryableToolCallError(err: unknown): boolean {
		const text = (err instanceof Error ? err.message : String(err)).toLowerCase()

		const hasServerCode = /mcp 错误 \[-?5\d\d\]/i.test(text) || /\b5\d\d\b/.test(text)
		const hasTransientHint =
			/(timeout|timed out|temporar|try again later|service unavailable|network|fetch failed|econnreset|socket hang up)/i.test(
				text,
			)

		return hasServerCode || hasTransientHint
	}

	/** 失败后是否应先重连再重试（主要用于远程会话传输） */
	private shouldReconnectBeforeRetry(err: unknown, attempt: number): boolean {
		// 仅在首次失败后重连一次，避免频繁抖动
		if (attempt !== 0) return false

		if (!this.isRemoteTransport()) return false

		const text = (err instanceof Error ? err.message : String(err)).toLowerCase()
		return (
			this.isRetryableToolCallError(err) ||
			/session|expired|invalid|reset|closed|broken pipe|econnreset|socket/i.test(text)
		)
	}

	private isRemoteTransport(): boolean {
		return (
			this.config.transportType === 'http'
			|| this.config.transportType === 'remote-sse'
			|| this.config.transportType === 'websocket'
		)
	}

	/**
	 * tools/call 重试前的连接恢复：
	 * 断开并重建连接，触发 initialize + tools/list，刷新远端会话状态。
	 */
	private async reconnectForToolCallRetry(): Promise<void> {
		try {
			await this.disconnect()
		} catch (err) {
			DebugLogger.warn('[MCP] 重试前断开连接失败，忽略并继续重连', err)
		}
		await this.connect()
	}

	private wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/** 工具调用最终失败时，记录关键日志并向用户提示（节流） */
	private reportToolCallFailure(toolName: string, args: Record<string, unknown>, err: unknown): void {
		const msg = err instanceof Error ? err.message : String(err)
		const argsPreview = this.previewArgs(args)
		DebugLogger.error(`[MCP] 工具调用最终失败: ${this.config.name}/${toolName}: ${msg}; args=${argsPreview}`)

		const now = Date.now()
		if (now - this.lastToolCallNoticeAt < 10000) return
		this.lastToolCallNoticeAt = now
		new Notice(`MCP 工具调用失败 (${this.config.name}/${toolName}): ${msg}\nargs: ${argsPreview}`, 7000)
	}

	private previewArgs(args: Record<string, unknown>): string {
		try {
			const text = JSON.stringify(args)
			return text.length > 220 ? `${text.slice(0, 220)}...` : text
		} catch {
			const text = String(args)
			return text.length > 220 ? `${text.slice(0, 220)}...` : text
		}
	}
}
