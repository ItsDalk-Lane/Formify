/**
 * MCP 功能总入口（Facade）
 *
 * 协调 McpProcessManager、McpHealthChecker 等子组件
 * 由 FeatureCoordinator 持有，管理整个 MCP 模块的生命周期
 */

import { App } from 'obsidian';
import {
	BUILTIN_CORE_TOOLS_SERVER_ID,
	BUILTIN_CORE_TOOLS_SERVER_NAME,
	BUILTIN_FILESYSTEM_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	createCoreToolsBuiltinRuntime,
	type CoreToolsBuiltinRuntime,
} from 'src/builtin-mcp/core-tools-mcp-server';
import {
	createFilesystemBuiltinRuntime,
	type FilesystemBuiltinRuntime,
} from 'src/builtin-mcp/filesystem-mcp-server';
import {
	clonePlanSnapshot,
	type PlanSnapshot,
} from 'src/builtin-mcp/runtime/plan-state';
import { DebugLogger } from 'src/utils/DebugLogger';
import { McpHealthChecker } from './McpHealthChecker';
import { McpProcessManager } from './McpProcessManager';
import type {
	McpHealthResult,
	McpServerConfig,
	McpServerState,
	McpSettings,
	McpToolDefinition,
	McpToolInfo,
} from './types';

type BuiltinRuntime =
	| CoreToolsBuiltinRuntime
	| FilesystemBuiltinRuntime;

interface BuiltinDescriptor {
	serverId: string;
	serverName: string;
	isEnabled: (settings: McpSettings) => boolean;
	createRuntime: (app: App, settings: McpSettings) => Promise<BuiltinRuntime>;
	initErrorLogMessage: string;
}

const EXTERNAL_CONNECT_RETRY_COOLDOWN_MS = 15_000;
const BUILTIN_FILESYSTEM_ROUTING_HINT =
	'全局文件工具路由规则：只知道名称或路径片段时先用 find_paths；已经知道 directory_path 才用 list_directory；已经知道 file_path 要读内容时用 read_file；搜索正文内容用 search_content；查询标签、任务、属性或文件统计用 query_index。';

export class McpClientManager {
	private processManager: McpProcessManager;
	private healthChecker: McpHealthChecker;
	private settings: McpSettings;
	private builtinRuntimes = new Map<string, BuiltinRuntime>();
	private builtinRuntimePromises = new Map<string, Promise<void>>();
	private builtinStates = new Map<string, McpServerState>();
	private externalConnectCooldownUntil = new Map<string, number>();
	private disposed = false;
	/** 状态变更监听器 */
	private stateListeners: Array<(states: McpServerState[]) => void> = [];
	private livePlanSnapshot: PlanSnapshot | null = null;
	private livePlanListeners = new Set<(snapshot: PlanSnapshot | null) => void>();
	private livePlanRuntimeUnsubscribe: (() => void) | null = null;

	constructor(
		private readonly app: App,
		settings: McpSettings,
	) {
		this.settings = settings;
		this.processManager = new McpProcessManager(
			(states) => this.notifyStateChange(states)
		);
		this.healthChecker = new McpHealthChecker(this.processManager);

		for (const descriptor of this.getBuiltinDescriptors()) {
			this.builtinStates.set(descriptor.serverId, {
				serverId: descriptor.serverId,
				status: 'idle',
				tools: [],
			});
		}

		for (const descriptor of this.getEnabledBuiltinDescriptors(settings)) {
			void this.ensureBuiltinRuntime(descriptor.serverId);
		}

		void this.autoConnectEnabledServers();
	}

	/** 获取当前 MCP 设置 */
	getSettings(): McpSettings {
		return this.settings;
	}

	/** MCP 兼容开关：仅当 enabled === false 时禁用 */
	private isMcpEnabled(settings: McpSettings = this.settings): boolean {
		return settings.enabled !== false;
	}

	private getBuiltinDescriptors(): BuiltinDescriptor[] {
		return [
			{
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
				serverName: BUILTIN_CORE_TOOLS_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) && settings.builtinCoreToolsEnabled !== false,
				createRuntime: async (app, settings) =>
					await createCoreToolsBuiltinRuntime(app, settings),
				initErrorLogMessage: '[MCP] 初始化内置基础工具 MCP Server 失败',
			},
			{
				serverId: BUILTIN_FILESYSTEM_SERVER_ID,
				serverName: BUILTIN_FILESYSTEM_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) && settings.builtinFilesystemEnabled !== false,
				createRuntime: async (app) => await createFilesystemBuiltinRuntime(app),
				initErrorLogMessage: '[MCP] 初始化内置 Filesystem MCP Server 失败',
			},
		];
	}

	private getBuiltinDescriptor(serverId: string): BuiltinDescriptor | undefined {
		return this.getBuiltinDescriptors().find(
			(descriptor) => descriptor.serverId === serverId
		);
	}

	private getEnabledBuiltinDescriptors(
		settings: McpSettings = this.settings
	): BuiltinDescriptor[] {
		return this.getBuiltinDescriptors().filter((descriptor) =>
			descriptor.isEnabled(settings)
		);
	}

	private isBuiltinServerId(serverId: string): boolean {
		return !!this.getBuiltinDescriptor(serverId);
	}

	private isBuiltinServerEnabled(
		serverId: string,
		settings: McpSettings = this.settings
	): boolean {
		const descriptor = this.getBuiltinDescriptor(serverId);
		if (!descriptor) return false;
		return descriptor.isEnabled(settings);
	}

	/** 更新设置 */
	async updateSettings(settings: McpSettings): Promise<void> {
		const oldSettings = this.settings;
		const oldEnabled = this.isMcpEnabled(oldSettings);
		const oldEnabledBuiltinIds = new Set(
			this.getEnabledBuiltinDescriptors(oldSettings).map(
				(descriptor) => descriptor.serverId
			)
		);
		this.settings = settings;

		const newEnabled = this.isMcpEnabled(settings);
		const newEnabledBuiltinIds = new Set(
			this.getEnabledBuiltinDescriptors(settings).map(
				(descriptor) => descriptor.serverId
			)
		);

		// MCP 被禁用时，断开所有连接（外部 + 内置）
		if (!newEnabled && oldEnabled) {
			DebugLogger.info('[MCP] MCP 功能已禁用，正在断开所有连接...');
			const states = this.processManager.getAllStates();
			for (const state of states) {
				await this.processManager.disconnect(state.serverId);
			}
			await this.closeAllBuiltinRuntimes();
			return;
		}

		for (const descriptor of this.getBuiltinDescriptors()) {
			const wasEnabled = oldEnabledBuiltinIds.has(descriptor.serverId);
			const isEnabled = newEnabledBuiltinIds.has(descriptor.serverId);
			if (wasEnabled && !isEnabled) {
				await this.closeBuiltinRuntime(descriptor.serverId);
				continue;
			}
			if (!wasEnabled && isEnabled) {
				await this.ensureBuiltinRuntime(descriptor.serverId);
				continue;
			}
		}

		const shouldRefreshCoreToolsRuntime =
			oldEnabled
			&& newEnabled
			&& oldSettings.builtinCoreToolsEnabled !== false
			&& settings.builtinCoreToolsEnabled !== false
			&& oldSettings.builtinTimeDefaultTimezone
				!== settings.builtinTimeDefaultTimezone;

		if (shouldRefreshCoreToolsRuntime) {
			await this.closeBuiltinRuntime(BUILTIN_CORE_TOOLS_SERVER_ID);
			await this.ensureBuiltinRuntime(BUILTIN_CORE_TOOLS_SERVER_ID);
		}

		// 检查被移除或禁用的服务器，断开连接
		const newServerIds = new Set(settings.servers.map((server) => server.id));
		const oldStates = this.processManager.getAllStates();

		for (const state of oldStates) {
			const newConfig = settings.servers.find(
				(server) => server.id === state.serverId
			);

			if (
				!newConfig ||
				!newConfig.enabled ||
				!newServerIds.has(state.serverId)
			) {
				await this.processManager.disconnect(state.serverId);
				this.externalConnectCooldownUntil.delete(state.serverId);
			}
		}

		if (newEnabled) {
			for (const descriptor of this.getEnabledBuiltinDescriptors(settings)) {
				await this.ensureBuiltinRuntime(descriptor.serverId);
			}
			void this.autoConnectEnabledServers();
		}
	}

	/**
	 * 获取所有已连接服务器的 MCP 工具定义
	 *
	 * 用于注入到 AI Provider 的请求中
	 */
	async getAvailableTools(): Promise<McpToolDefinition[]> {
		if (!this.isMcpEnabled()) return [];

		const externalTools: McpToolDefinition[] = [];
		const states = this.processManager.getAllStates();

		for (const state of states) {
			if (state.status !== 'running') continue;

			const config = this.settings.servers.find(
				(server) => server.id === state.serverId
			);
			if (!config?.enabled) continue;

			for (const tool of state.tools) {
				externalTools.push({
					name: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema,
					annotations: tool.annotations,
					serverId: tool.serverId,
				});
			}
		}

		const builtinTools = await this.getBuiltinTools();
		return this.mergeToolsPreferBuiltin(builtinTools, externalTools);
	}

	/**
	 * 获取所有已启用服务器的 MCP 工具定义（包括未连接的）
	 *
	 * 会自动懒启动未连接的服务器
	 */
	async getAvailableToolsWithLazyStart(): Promise<McpToolDefinition[]> {
		if (!this.isMcpEnabled()) return [];

		await Promise.allSettled(
			this.getEnabledBuiltinDescriptors().map((descriptor) =>
				this.ensureBuiltinRuntime(descriptor.serverId)
			)
		);

		const enabledServers = this.settings.servers.filter((server) => server.enabled);

		// 并行懒启动外部服务，避免单点失败拖慢全部 MCP
		const tasks = enabledServers.map(async (server) => {
			const state = this.processManager.getState(server.id);
			if (state?.status === 'running' || state?.status === 'connecting') return;
			await this.tryEnsureExternalConnected(server, 'lazy');
		});

		await Promise.allSettled(tasks);

		return await this.getAvailableTools();
	}

	/**
	 * 获取注入到模型上下文中的 MCP 工具定义。
	 */
	async getToolsForModelContext(): Promise<McpToolDefinition[]> {
		if (!this.isMcpEnabled()) return [];
		const tools = await this.getAvailableToolsWithLazyStart();
		return tools.map((tool) => {
			if (tool.serverId !== BUILTIN_FILESYSTEM_SERVER_ID) {
				return tool;
			}
			return {
				...tool,
				description: `${BUILTIN_FILESYSTEM_ROUTING_HINT}\n\n${tool.description}`,
			};
		});
	}

	/**
	 * 调用 MCP 工具
	 *
	 * 自动懒启动服务器（如果尚未运行）
	 */
	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<string> {
		return await this.callActualTool(serverId, toolName, args);
	}

	async callActualTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<string> {
		if (!this.isMcpEnabled()) {
			throw new Error('MCP 功能未启用');
		}

		if (this.isBuiltinServerId(serverId)) {
			if (!this.isBuiltinServerEnabled(serverId)) {
				throw new Error('内置 MCP Server 已禁用');
			}
			const runtime = await this.ensureBuiltinRuntime(serverId);
			if (!runtime) {
				throw new Error('内置 MCP Server 未就绪');
			}
			return await runtime.callTool(toolName, args);
		}

		const config = this.settings.servers.find((server) => server.id === serverId);
		if (!config) {
			throw new Error(`MCP 服务器不存在: ${serverId}`);
		}

		if (!config.enabled) {
			throw new Error(`MCP 服务器已禁用: ${config.name}`);
		}

		// 懒启动
		const client = await this.processManager.ensureConnected(config);
		return await client.callTool(toolName, args);
	}

	/** 手动连接指定服务器 */
	async connectServer(serverId: string): Promise<void> {
		if (this.isBuiltinServerId(serverId)) {
			if (!this.isBuiltinServerEnabled(serverId)) {
				throw new Error('内置 MCP Server 已禁用');
			}
			await this.ensureBuiltinRuntime(serverId);
			return;
		}

		const config = this.settings.servers.find((server) => server.id === serverId);
		if (!config) {
			throw new Error(`MCP 服务器不存在: ${serverId}`);
		}
		await this.processManager.ensureConnected(config);
		this.externalConnectCooldownUntil.delete(serverId);
	}

	/** 手动断开指定服务器 */
	async disconnectServer(serverId: string): Promise<void> {
		if (this.isBuiltinServerId(serverId)) {
			await this.closeBuiltinRuntime(serverId);
			return;
		}
		await this.processManager.disconnect(serverId);
	}

	/** 执行健康检测 */
	async checkHealth(serverId?: string): Promise<McpHealthResult[]> {
		if (serverId && this.isBuiltinServerId(serverId)) {
			return await this.checkBuiltinHealth(serverId);
		}

		const servers = serverId
			? this.settings.servers.filter((server) => server.id === serverId)
			: this.settings.servers.filter((server) => server.enabled);

		return await this.healthChecker.check(servers);
	}

	getEnabledServerSummaries(): Array<{ id: string; name: string }> {
		const enabledExternal = this.settings.servers
			.filter((server) => server.enabled)
			.map((server) => ({ id: server.id, name: server.name }));

		const enabledBuiltin = this.getEnabledBuiltinDescriptors().map(
			(descriptor) => ({
				id: descriptor.serverId,
				name: descriptor.serverName,
			})
		);

		return [...enabledExternal, ...enabledBuiltin];
	}

	/** 获取所有服务器状态 */
	getAllStates(): McpServerState[] {
		const externalStates = this.processManager.getAllStates();
		const builtinStates = this.getEnabledBuiltinDescriptors().map((descriptor) =>
			this.getBuiltinStateSnapshot(descriptor.serverId)
		);
		return [...externalStates, ...builtinStates];
	}

	/** 获取指定服务器状态 */
	getState(serverId: string): McpServerState | undefined {
		if (this.isBuiltinServerId(serverId)) {
			return this.getBuiltinStateSnapshot(serverId);
		}
		return this.processManager.getState(serverId);
	}

	async getToolsForServer(serverId: string): Promise<McpToolInfo[]> {
		if (!this.isMcpEnabled()) return [];

		if (this.isBuiltinServerId(serverId)) {
			if (!this.isBuiltinServerEnabled(serverId)) return [];
			const runtime = await this.ensureBuiltinRuntime(serverId);
			if (!runtime) return [];
			const tools = await runtime.listTools();
			const mappedTools = tools.map((tool) => ({
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				outputSchema: tool.outputSchema,
				annotations: tool.annotations,
				serverId,
			}));
			this.builtinStates.set(serverId, {
				serverId,
				status: 'running',
				lastError: undefined,
				tools: mappedTools,
			});
			return mappedTools;
		}

		const state = this.processManager.getState(serverId);
		if (state?.status === 'running') {
			return [...state.tools];
		}

		const config = this.settings.servers.find((server) => server.id === serverId);
		if (!config || !config.enabled) return [];

		try {
			await this.processManager.ensureConnected(config);
		} catch (error) {
			DebugLogger.warn(`[MCP] 获取服务器工具失败: ${serverId}`, error);
		}

		return this.processManager.getState(serverId)?.tools ?? [];
	}

	/** 注册状态变更监听器 */
	onStateChange(listener: (states: McpServerState[]) => void): () => void {
		this.stateListeners.push(listener);
		return () => {
			const idx = this.stateListeners.indexOf(listener);
			if (idx >= 0) this.stateListeners.splice(idx, 1);
		};
	}

	getLivePlanSnapshot(): PlanSnapshot | null {
		return clonePlanSnapshot(this.livePlanSnapshot);
	}

	onLivePlanChange(
		listener: (snapshot: PlanSnapshot | null) => void
	): () => void {
		this.livePlanListeners.add(listener);
		listener(this.getLivePlanSnapshot());
		return () => {
			this.livePlanListeners.delete(listener);
		};
	}

	async syncLivePlanSnapshot(snapshot: PlanSnapshot | null): Promise<void> {
		this.setLivePlanSnapshot(snapshot);
		if (
			!this.isMcpEnabled()
			|| !this.isBuiltinServerEnabled(BUILTIN_CORE_TOOLS_SERVER_ID)
		) {
			return;
		}

		const runtime = await this.ensureBuiltinRuntime(BUILTIN_CORE_TOOLS_SERVER_ID);
		if (!runtime) {
			return;
		}

		const coreToolsRuntime = runtime as CoreToolsBuiltinRuntime;
		coreToolsRuntime.syncPlanSnapshot(snapshot);
		this.setLivePlanSnapshot(coreToolsRuntime.getPlanSnapshot());
	}

	/** 销毁所有资源 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.stateListeners = [];
		this.livePlanListeners.clear();
		this.detachLivePlanRuntime();
		await Promise.allSettled([
			this.processManager.dispose(),
			this.closeAllBuiltinRuntimes(),
		]);
	}

	/** 通知所有监听器状态变更 */
	private notifyStateChange(states: McpServerState[]): void {
		const builtinStates = this.getEnabledBuiltinDescriptors().map((descriptor) =>
			this.getBuiltinStateSnapshot(descriptor.serverId)
		);
		const mergedStates = [...states, ...builtinStates];
		for (const listener of this.stateListeners) {
			try {
				listener(mergedStates);
			} catch (err) {
				DebugLogger.error('[MCP] 状态监听器执行出错', err);
			}
		}
	}

	private attachLivePlanRuntime(runtime: CoreToolsBuiltinRuntime): void {
		this.detachLivePlanRuntime();
		this.livePlanRuntimeUnsubscribe = runtime.onPlanChange((snapshot) => {
			this.setLivePlanSnapshot(snapshot);
		});
	}

	private detachLivePlanRuntime(): void {
		this.livePlanRuntimeUnsubscribe?.();
		this.livePlanRuntimeUnsubscribe = null;
	}

	private setLivePlanSnapshot(snapshot: PlanSnapshot | null): void {
		const nextSnapshot = clonePlanSnapshot(snapshot);
		const previousKey = JSON.stringify(this.livePlanSnapshot);
		const nextKey = JSON.stringify(nextSnapshot);

		this.livePlanSnapshot = nextSnapshot;
		if (previousKey === nextKey) {
			return;
		}

		for (const listener of this.livePlanListeners) {
			try {
				listener(this.getLivePlanSnapshot());
			} catch (error) {
				DebugLogger.error('[MCP] Live Plan 监听器执行出错', error);
			}
		}
	}

	/** 自动连接所有已启用服务器 */
	private async autoConnectEnabledServers(): Promise<void> {
		if (!this.isMcpEnabled()) return;

		await Promise.allSettled(
			this.getEnabledBuiltinDescriptors().map((descriptor) =>
				this.ensureBuiltinRuntime(descriptor.serverId)
			)
		);

		const enabledServers = this.settings.servers.filter((server) => server.enabled);
		if (enabledServers.length === 0) return;

		const tasks = enabledServers.map(async (server) => {
			const state = this.processManager.getState(server.id);
			if (state?.status === 'running' || state?.status === 'connecting') return;
			await this.tryEnsureExternalConnected(server, 'auto');
		});

		await Promise.allSettled(tasks);
	}

	private shouldSkipExternalConnect(serverId: string): boolean {
		const blockedUntil = this.externalConnectCooldownUntil.get(serverId);
		return typeof blockedUntil === 'number' && blockedUntil > Date.now();
	}

	private markExternalConnectFailure(serverId: string): void {
		this.externalConnectCooldownUntil.set(
			serverId,
			Date.now() + EXTERNAL_CONNECT_RETRY_COOLDOWN_MS
		);
	}

	private clearExternalConnectFailure(serverId: string): void {
		this.externalConnectCooldownUntil.delete(serverId);
	}

	private async tryEnsureExternalConnected(
		server: McpServerConfig,
		reason: 'lazy' | 'auto'
	): Promise<void> {
		if (this.shouldSkipExternalConnect(server.id)) {
			DebugLogger.debug(
				`[MCP] 跳过 ${reason === 'lazy' ? '懒启动' : '自动连接'}（冷却中）: ${server.name}`
			);
			return;
		}

		try {
			await this.processManager.ensureConnected(server);
			this.clearExternalConnectFailure(server.id);
		} catch (err) {
			this.markExternalConnectFailure(server.id);
			DebugLogger.error(
				`[MCP] ${reason === 'lazy' ? '懒启动' : '自动连接'}服务器失败: ${server.name}`,
				err
			);
		}
	}

	private async getBuiltinTools(): Promise<McpToolDefinition[]> {
		const mappedTools: McpToolDefinition[] = [];

		for (const descriptor of this.getEnabledBuiltinDescriptors()) {
			const runtime = await this.ensureBuiltinRuntime(descriptor.serverId);
			if (!runtime) continue;

			try {
				const tools = await runtime.listTools();
				const toolDefinitions = tools.map((tool) => ({
					name: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema,
					annotations: tool.annotations,
					serverId: descriptor.serverId,
				}));
				mappedTools.push(...toolDefinitions);
				this.builtinStates.set(descriptor.serverId, {
					serverId: descriptor.serverId,
					status: 'running',
					lastError: undefined,
					tools: toolDefinitions,
				});
			} catch (error) {
				this.builtinStates.set(descriptor.serverId, {
					serverId: descriptor.serverId,
					status: 'error',
					lastError:
						error instanceof Error ? error.message : String(error),
					tools: [],
				});
				DebugLogger.warn(
					`[MCP] 读取内置工具列表失败: ${descriptor.serverName}`,
					error
				);
			}
		}

		return mappedTools;
	}

	private getBuiltinStateSnapshot(serverId: string): McpServerState {
		const current = this.builtinStates.get(serverId) ?? {
			serverId,
			status: 'idle' as const,
			tools: [],
		};

		if (!this.isBuiltinServerEnabled(serverId)) {
			return {
				serverId,
				status: 'stopped',
				tools: [],
				lastError: current.lastError,
			};
		}

		return {
			serverId,
			status: current.status,
			tools: [...current.tools],
			lastError: current.lastError,
		};
	}

	private mergeToolsPreferBuiltin(
		builtinTools: McpToolDefinition[],
		externalTools: McpToolDefinition[]
	): McpToolDefinition[] {
		const merged: McpToolDefinition[] = [];
		const seen = new Map<string, string>();

		// 先放内置工具：同名时内置优先
		for (const tool of builtinTools) {
			if (seen.has(tool.name)) continue;
			seen.set(tool.name, tool.serverId);
			merged.push(tool);
		}

		for (const tool of externalTools) {
			const existedServer = seen.get(tool.name);
			if (existedServer) {
				DebugLogger.warn(
					`[MCP] 检测到同名工具，已跳过外部工具并保留内置优先: ${tool.name}（跳过=${tool.serverId}，保留=${existedServer}）`
				);
				continue;
			}
			seen.set(tool.name, tool.serverId);
			merged.push(tool);
		}

		return merged;
	}

	private async ensureBuiltinRuntime(
		serverId: string
	): Promise<BuiltinRuntime | null> {
		if (this.disposed) return null;
		const descriptor = this.getBuiltinDescriptor(serverId);
		if (!descriptor) return null;
		if (!descriptor.isEnabled(this.settings)) return null;

		const existing = this.builtinRuntimes.get(serverId);
		if (existing) return existing;

		const pending = this.builtinRuntimePromises.get(serverId);
		if (pending) {
			await pending;
			return this.builtinRuntimes.get(serverId) ?? null;
		}

		const current = this.builtinStates.get(serverId) ?? {
			serverId,
			status: 'idle' as const,
			tools: [],
		};
		this.builtinStates.set(serverId, {
			...current,
			status: 'connecting',
			lastError: undefined,
			tools: [],
		});
		this.notifyStateChange(this.processManager.getAllStates());

		const promise = (async () => {
			try {
				const runtime = await descriptor.createRuntime(this.app, this.settings);
				if (this.disposed || !descriptor.isEnabled(this.settings)) {
					await runtime.close();
					return;
				}

				this.builtinRuntimes.set(serverId, runtime);
				if (serverId === BUILTIN_CORE_TOOLS_SERVER_ID) {
					const coreToolsRuntime = runtime as CoreToolsBuiltinRuntime;
					this.attachLivePlanRuntime(coreToolsRuntime);
					coreToolsRuntime.syncPlanSnapshot(this.livePlanSnapshot);
					this.setLivePlanSnapshot(coreToolsRuntime.getPlanSnapshot());
				}

				const tools = await runtime.listTools();
				this.builtinStates.set(serverId, {
					serverId,
					status: 'running',
					lastError: undefined,
					tools: tools.map((tool) => ({
						name: tool.name,
						title: tool.title,
						description: tool.description,
						inputSchema: tool.inputSchema,
						outputSchema: tool.outputSchema,
						annotations: tool.annotations,
						serverId,
					})),
				});
			} catch (error) {
				this.builtinStates.set(serverId, {
					serverId,
					status: 'error',
					lastError:
						error instanceof Error ? error.message : String(error),
					tools: [],
				});
				DebugLogger.error(descriptor.initErrorLogMessage, error);
			} finally {
				this.notifyStateChange(this.processManager.getAllStates());
			}
		})();

		this.builtinRuntimePromises.set(serverId, promise);
		try {
			await promise;
		} finally {
			this.builtinRuntimePromises.delete(serverId);
		}

		return this.builtinRuntimes.get(serverId) ?? null;
	}

	private async closeBuiltinRuntime(serverId: string): Promise<void> {
		const descriptor = this.getBuiltinDescriptor(serverId);
		if (!descriptor) return;

		const pending = this.builtinRuntimePromises.get(serverId);
		if (pending) {
			try {
				await pending;
			} catch {
				// ignore
			}
		}

		const runtime = this.builtinRuntimes.get(serverId) ?? null;
		this.builtinRuntimes.delete(serverId);
		if (serverId === BUILTIN_CORE_TOOLS_SERVER_ID) {
			this.detachLivePlanRuntime();
		}

		const current = this.builtinStates.get(serverId) ?? {
			serverId,
			status: 'idle' as const,
			tools: [],
		};
		this.builtinStates.set(serverId, {
			...current,
			status: runtime ? 'stopping' : 'stopped',
			tools: [],
		});
		this.notifyStateChange(this.processManager.getAllStates());
		if (!runtime) return;

		try {
			if ('resetState' in runtime && typeof runtime.resetState === 'function') {
				runtime.resetState();
			}
			await runtime.close();
			this.builtinStates.set(serverId, {
				...current,
				serverId,
				status: 'stopped',
				lastError: undefined,
				tools: [],
			});
		} catch (error) {
			this.builtinStates.set(serverId, {
				...current,
				serverId,
				status: 'error',
				lastError:
					error instanceof Error ? error.message : String(error),
				tools: [],
			});
			DebugLogger.warn(`[MCP] 关闭内置 MCP Server 失败: ${descriptor.serverName}`, error);
		} finally {
			this.notifyStateChange(this.processManager.getAllStates());
		}
	}

	private async closeAllBuiltinRuntimes(): Promise<void> {
		const tasks = this.getBuiltinDescriptors().map((descriptor) =>
			this.closeBuiltinRuntime(descriptor.serverId)
		);
		await Promise.allSettled(tasks);
	}

	private async checkBuiltinHealth(
		serverId: string
	): Promise<McpHealthResult[]> {
		const descriptor = this.getBuiltinDescriptor(serverId);
		if (!descriptor) {
			return [];
		}

		if (!this.isBuiltinServerEnabled(serverId)) {
			return [
				{
					serverId,
					serverName: descriptor.serverName,
					success: false,
					toolCount: 0,
					responseTimeMs: 0,
					error: '内置 MCP Server 已禁用',
				},
			];
		}

		const runtime = await this.ensureBuiltinRuntime(serverId);
		if (!runtime) {
			return [
				{
					serverId,
					serverName: descriptor.serverName,
					success: false,
					toolCount: 0,
					responseTimeMs: 0,
					error: '内置 MCP Server 初始化失败',
				},
			];
		}

		const start = Date.now();
		try {
			const tools = await runtime.listTools();
			return [
				{
					serverId,
					serverName: descriptor.serverName,
					success: true,
					toolCount: tools.length,
					responseTimeMs: Date.now() - start,
				},
			];
		} catch (err) {
			return [
				{
					serverId,
					serverName: descriptor.serverName,
					success: false,
					toolCount: 0,
					responseTimeMs: Date.now() - start,
					error: err instanceof Error ? err.message : String(err),
				},
			];
		}
	}
}
