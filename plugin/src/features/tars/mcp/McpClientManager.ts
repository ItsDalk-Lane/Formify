/**
 * MCP 功能总入口（Facade）
 *
 * 协调 McpProcessManager、McpHealthChecker 等子组件
 * 由 FeatureCoordinator 持有，管理整个 MCP 模块的生命周期
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import { McpHealthChecker } from './McpHealthChecker'
import { McpProcessManager } from './McpProcessManager'
import type {
	McpHealthResult,
	McpServerConfig,
	McpServerState,
	McpSettings,
	McpToolDefinition,
} from './types'

export class McpClientManager {
	private processManager: McpProcessManager
	private healthChecker: McpHealthChecker
	private settings: McpSettings
	/** 状态变更监听器 */
	private stateListeners: Array<(states: McpServerState[]) => void> = []

	constructor(settings: McpSettings) {
		this.settings = settings
		this.processManager = new McpProcessManager(
			(states) => this.notifyStateChange(states),
		)
		this.healthChecker = new McpHealthChecker(this.processManager)
		void this.autoConnectEnabledServers()
	}

	/** 获取当前 MCP 设置 */
	getSettings(): McpSettings {
		return this.settings
	}

	/** 更新设置 */
	async updateSettings(settings: McpSettings): Promise<void> {
		const oldSettings = this.settings
		this.settings = settings

		// MCP 被禁用时，断开所有连接
		if (!settings.enabled && oldSettings.enabled) {
			DebugLogger.info('[MCP] MCP 功能已禁用，正在断开所有连接...')
			await this.processManager.dispose()
			return
		}

		// 检查被移除或禁用的服务器，断开连接
		const newServerIds = new Set(settings.servers.map((s) => s.id))
		const oldStates = this.processManager.getAllStates()

		for (const state of oldStates) {
			const newConfig = settings.servers.find((s) => s.id === state.serverId)

			if (!newConfig || !newConfig.enabled || !newServerIds.has(state.serverId)) {
				await this.processManager.disconnect(state.serverId)
			}
		}

		void this.autoConnectEnabledServers()
	}

	/**
	 * 获取所有已连接服务器的 MCP 工具定义
	 *
	 * 用于注入到 AI Provider 的请求中
	 */
	getAvailableTools(): McpToolDefinition[] {
		if (!this.settings.enabled) return []

		const tools: McpToolDefinition[] = []
		const states = this.processManager.getAllStates()

		for (const state of states) {
			if (state.status !== 'running') continue

			const config = this.settings.servers.find((s) => s.id === state.serverId)
			if (!config?.enabled) continue

			for (const tool of state.tools) {
				tools.push({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					serverId: tool.serverId,
				})
			}
		}

		return tools
	}

	/**
	 * 获取所有已启用服务器的 MCP 工具定义（包括未连接的）
	 *
	 * 会自动懒启动未连接的服务器
	 */
	async getAvailableToolsWithLazyStart(): Promise<McpToolDefinition[]> {
		if (!this.settings.enabled) return []

		const enabledServers = this.settings.servers.filter((s) => s.enabled)

		// 确保所有启用的服务器都已连接
		for (const server of enabledServers) {
			const state = this.processManager.getState(server.id)
			if (!state || state.status !== 'running') {
				try {
					await this.processManager.ensureConnected(server)
				} catch (err) {
					DebugLogger.error(`[MCP] 懒启动服务器失败: ${server.name}`, err)
				}
			}
		}

		return this.getAvailableTools()
	}

	/**
	 * 调用 MCP 工具
	 *
	 * 自动懒启动服务器（如果尚未运行）
	 */
	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<string> {
		if (!this.settings.enabled) {
			throw new Error('MCP 功能未启用')
		}

		const config = this.settings.servers.find((s) => s.id === serverId)
		if (!config) {
			throw new Error(`MCP 服务器不存在: ${serverId}`)
		}

		if (!config.enabled) {
			throw new Error(`MCP 服务器已禁用: ${config.name}`)
		}

		// 懒启动
		const client = await this.processManager.ensureConnected(config)
		return await client.callTool(toolName, args)
	}

	/** 手动连接指定服务器 */
	async connectServer(serverId: string): Promise<void> {
		const config = this.settings.servers.find((s) => s.id === serverId)
		if (!config) {
			throw new Error(`MCP 服务器不存在: ${serverId}`)
		}
		await this.processManager.ensureConnected(config)
	}

	/** 手动断开指定服务器 */
	async disconnectServer(serverId: string): Promise<void> {
		await this.processManager.disconnect(serverId)
	}

	/** 执行健康检测 */
	async checkHealth(serverId?: string): Promise<McpHealthResult[]> {
		const servers = serverId
			? this.settings.servers.filter((s) => s.id === serverId)
			: this.settings.servers.filter((s) => s.enabled)

		return await this.healthChecker.check(servers)
	}

	/** 获取所有服务器状态 */
	getAllStates(): McpServerState[] {
		return this.processManager.getAllStates()
	}

	/** 获取指定服务器状态 */
	getState(serverId: string): McpServerState | undefined {
		return this.processManager.getState(serverId)
	}

	/** 注册状态变更监听器 */
	onStateChange(listener: (states: McpServerState[]) => void): () => void {
		this.stateListeners.push(listener)
		return () => {
			const idx = this.stateListeners.indexOf(listener)
			if (idx >= 0) this.stateListeners.splice(idx, 1)
		}
	}

	/** 销毁所有资源 */
	async dispose(): Promise<void> {
		this.stateListeners = []
		await this.processManager.dispose()
	}

	/** 通知所有监听器状态变更 */
	private notifyStateChange(states: McpServerState[]): void {
		for (const listener of this.stateListeners) {
			try {
				listener(states)
			} catch (err) {
				DebugLogger.error('[MCP] 状态监听器执行出错', err)
			}
		}
	}

	/** 自动连接所有已启用服务器 */
	private async autoConnectEnabledServers(): Promise<void> {
		if (!this.settings.enabled) return

		const enabledServers = this.settings.servers.filter((s) => s.enabled)
		if (enabledServers.length === 0) return

		const tasks = enabledServers.map(async (server) => {
			const state = this.processManager.getState(server.id)
			if (state?.status === 'running' || state?.status === 'connecting') return

			try {
				await this.processManager.ensureConnected(server)
			} catch (err) {
				DebugLogger.error(`[MCP] 自动连接服务器失败: ${server.name}`, err)
			}
		})

		await Promise.allSettled(tasks)
	}
}
