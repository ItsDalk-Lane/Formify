/**
 * MCP 协议客户端
 *
 * 管理与单个 MCP 服务器的 JSON-RPC 2.0 通信
 * 实现 MCP 协议握手、工具列表获取、工具调用等功能
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import type { McpServerConfig, McpServerStatus, McpToolInfo } from './types'
import type { ITransport, JsonRpcMessage, JsonRpcResponse } from './transport/ITransport'
import { isJsonRpcResponse, isJsonRpcNotification } from './transport/ITransport'
import { StdioTransport } from './transport/StdioTransport'
import { WebSocketTransport } from './transport/WebSocketTransport'

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05'

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
			throw new Error(`MCP 工具调用失败 [${name}]: ${text}`)
		}

		DebugLogger.debug(`[MCP] 工具调用完成: ${name}, 返回 ${text.length} 字符`)
		return text
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
		case 'sse':
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
			pending.reject(new Error(
				`MCP 错误 [${response.error.code}]: ${response.error.message}`
			))
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
}
