/**
 * MCP 进程/连接生命周期管理器
 *
 * 管理所有 MCP 服务器的客户端实例和状态
 * 支持懒启动、崩溃检测、统一清理
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import { McpClient } from './McpClient'
import type { McpServerConfig, McpServerState, McpServerStatus, McpToolInfo } from './types'

export class McpProcessManager {
	/** 服务器 ID → McpClient 实例 */
	private clients = new Map<string, McpClient>()
	/** 服务器 ID → 运行时状态 */
	private states = new Map<string, McpServerState>()
	/** 是否已销毁 */
	private disposed = false

	constructor(
		private readonly onStateChange: (states: McpServerState[]) => void,
	) {}

	/**
	 * 确保指定服务器已连接（懒启动入口）
	 *
	 * 如果服务器已连接则直接返回，否则创建客户端并连接
	 */
	async ensureConnected(config: McpServerConfig): Promise<McpClient> {
		if (this.disposed) {
			throw new Error('McpProcessManager 已销毁')
		}

		const existing = this.clients.get(config.id)
		if (existing && existing.status === 'running') {
			return existing
		}

		// 如果存在旧的非运行状态客户端，先清理
		if (existing) {
			try {
				await existing.disconnect()
			} catch {
				// 忽略清理错误
			}
			this.clients.delete(config.id)
		}

		// 初始化状态
		this.updateState(config.id, {
			serverId: config.id,
			status: 'connecting',
			tools: [],
		})

		const client = new McpClient(
			config,
			(status, error) => this.handleStatusChange(config.id, status, error),
			(tools) => this.handleToolsChange(config.id, tools),
		)

		this.clients.set(config.id, client)

		try {
			await client.connect()
			return client
		} catch (err) {
			// connect 失败时状态已通过回调更新
			throw err
		}
	}

	/** 断开指定服务器连接 */
	async disconnect(serverId: string): Promise<void> {
		const client = this.clients.get(serverId)
		if (!client) return

		try {
			await client.disconnect()
		} catch (err) {
			DebugLogger.warn(`[MCP] 断开连接时出错: ${serverId}`, err)
		}

		this.clients.delete(serverId)
	}

	/** 获取指定服务器的客户端（可能为 null） */
	getClient(serverId: string): McpClient | undefined {
		return this.clients.get(serverId)
	}

	/** 获取指定服务器的状态 */
	getState(serverId: string): McpServerState | undefined {
		return this.states.get(serverId)
	}

	/** 获取所有服务器状态 */
	getAllStates(): McpServerState[] {
		return Array.from(this.states.values())
	}

	/** 销毁所有连接 */
	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true

		DebugLogger.info(`[MCP] 正在关闭所有 MCP 服务器 (${this.clients.size} 个)...`)

		const disconnectTasks = Array.from(this.clients.keys()).map(
			(id) => this.disconnect(id),
		)

		await Promise.allSettled(disconnectTasks)
		this.states.clear()

		DebugLogger.info('[MCP] 所有 MCP 服务器已关闭')
	}

	/** 处理客户端状态变化 */
	private handleStatusChange(serverId: string, status: McpServerStatus, error?: string): void {
		const current = this.states.get(serverId)
		if (!current) return

		this.updateState(serverId, {
			...current,
			status,
			lastError: error,
			pid: this.clients.get(serverId)?.pid,
		})
	}

	/** 处理工具列表变化 */
	private handleToolsChange(serverId: string, tools: McpToolInfo[]): void {
		const current = this.states.get(serverId)
		if (!current) return

		this.updateState(serverId, { ...current, tools })
	}

	/** 更新状态并通知外部 */
	private updateState(serverId: string, state: McpServerState): void {
		this.states.set(serverId, state)
		this.onStateChange(this.getAllStates())
	}
}
