/**
 * MCP 功能总入口（Facade）
 *
 * 协调 McpProcessManager、McpHealthChecker 等子组件
 * 由 FeatureCoordinator 持有，管理整个 MCP 模块的生命周期
 */

import { App } from 'obsidian';
import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	createMemoryBuiltinRuntime,
	type MemoryBuiltinRuntime,
} from 'src/builtin-mcp/memory-mcp-server';
import {
	createObsidianSearchBuiltinRuntime,
	type ObsidianSearchBuiltinRuntime,
} from 'src/builtin-mcp/obsidian-search-mcp-server';
import {
	createToolSearchBuiltinRuntime,
	type ToolSearchBuiltinRuntime,
} from 'src/builtin-mcp/tool-search-mcp-server';
import { ToolLibraryManager } from 'src/builtin-mcp/tool-library-manager';
import type {
	ToolLibraryEntry,
	ToolLibrarySearchOptions,
	ToolLibrarySearchResult,
} from 'src/builtin-mcp/tool-library-types';
import {
	createSequentialThinkingBuiltinRuntime,
	type SequentialThinkingBuiltinRuntime,
} from 'src/builtin-mcp/sequentialthinking-mcp-server';
import {
	createVaultBuiltinRuntime,
	type VaultBuiltinRuntime,
} from 'src/builtin-mcp/vault-mcp-server';
import type {
	Message as ProviderMessage,
	ResolveEmbedAsBinary,
	Vendor,
} from 'src/features/tars/providers';
import {
	DEFAULT_TOOL_AGENT_SETTINGS,
	TOOL_AGENT_SERVER_ID,
	TOOL_AGENT_TOOL_NAME,
	ToolCallAgent,
	type ToolAgentProviderResolverResult,
	type ToolAgentRequest,
	type ToolAgentRuntimeTool,
	type ToolAgentSettings,
	type ToolExecutionStep,
} from 'src/features/tool-agent';
import type { ToolExecutionSettings } from 'src/features/tars/settings';
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
import { DEFAULT_BUILTIN_MEMORY_FILE_PATH } from './types';

type BuiltinRuntime =
	| VaultBuiltinRuntime
	| MemoryBuiltinRuntime
	| ObsidianSearchBuiltinRuntime
	| ToolSearchBuiltinRuntime
	| SequentialThinkingBuiltinRuntime;

interface BuiltinDescriptor {
	serverId: string;
	serverName: string;
	isEnabled: (settings: McpSettings) => boolean;
	createRuntime: (app: App, settings: McpSettings) => Promise<BuiltinRuntime>;
	initErrorLogMessage: string;
}

interface McpClientManagerOptions {
	getToolAgentSettings?: () => ToolAgentSettings;
	getToolExecutionSettings?: () => ToolExecutionSettings;
	resolveToolAgentProviderByTag?: (
		tag: string
	) => ToolAgentProviderResolverResult | null;
	getVendorByName?: (vendorName: string) => Vendor | undefined;
	getProtectedPathPrefixes?: () => string[];
}

const EXTERNAL_CONNECT_RETRY_COOLDOWN_MS = 15_000;

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
	private vaultPlanSnapshot: PlanSnapshot | null = null;
	private vaultPlanListeners = new Set<(snapshot: PlanSnapshot | null) => void>();
	private vaultPlanRuntimeUnsubscribe: (() => void) | null = null;
	private toolCallAgent: ToolCallAgent | null = null;

	constructor(
		private readonly app: App,
		settings: McpSettings,
		private readonly toolLibraryManager: ToolLibraryManager | null = null,
		private readonly options: McpClientManagerOptions = {}
	) {
		this.settings = settings;
		this.processManager = new McpProcessManager(
			(states) => this.notifyStateChange(states)
		);
		this.healthChecker = new McpHealthChecker(this.processManager);
		this.toolCallAgent = this.createToolCallAgent();

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

	private resolveMemoryFilePath(settings: McpSettings = this.settings): string {
		const configured = (settings.builtinMemoryFilePath ?? '').trim();
		return configured || DEFAULT_BUILTIN_MEMORY_FILE_PATH;
	}

	private resolveDisableThoughtLogging(
		settings: McpSettings = this.settings
	): boolean {
		return settings.builtinSequentialThinkingDisableThoughtLogging !== false;
	}

	private getBuiltinDescriptors(): BuiltinDescriptor[] {
		return [
			{
				serverId: BUILTIN_VAULT_SERVER_ID,
				serverName: BUILTIN_VAULT_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) && settings.builtinVaultEnabled !== false,
				createRuntime: async (app) => await createVaultBuiltinRuntime(app),
				initErrorLogMessage: '[MCP] 初始化内置 Vault MCP Server 失败',
			},
			{
				serverId: BUILTIN_MEMORY_SERVER_ID,
				serverName: BUILTIN_MEMORY_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) && settings.builtinMemoryEnabled !== false,
				createRuntime: async (app, settings) =>
					await createMemoryBuiltinRuntime(app, {
						filePath: this.resolveMemoryFilePath(settings),
					}),
				initErrorLogMessage: '[MCP] 初始化内置 Memory MCP Server 失败',
			},
			{
				serverId: BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
				serverName: BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) &&
					settings.builtinObsidianSearchEnabled !== false,
				createRuntime: async (app) =>
					await createObsidianSearchBuiltinRuntime(app),
				initErrorLogMessage: '[MCP] 初始化内置 Obsidian Search MCP Server 失败',
			},
			{
				serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
				serverName: BUILTIN_TOOL_SEARCH_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) &&
					settings.builtinToolSearchEnabled !== false,
				createRuntime: async (app) => {
					if (!this.toolLibraryManager) {
						throw new Error('ToolLibraryManager 未初始化');
					}
					await this.toolLibraryManager.initialize();
					return await createToolSearchBuiltinRuntime(
						app,
						this.toolLibraryManager
					);
				},
				initErrorLogMessage: '[MCP] 初始化内置 Tool Search MCP Server 失败',
			},
			{
				serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
				serverName: BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
				isEnabled: (settings) =>
					this.isMcpEnabled(settings) &&
					settings.builtinSequentialThinkingEnabled !== false,
				createRuntime: async (app, settings) =>
					await createSequentialThinkingBuiltinRuntime(app, {
						disableThoughtLogging:
							this.resolveDisableThoughtLogging(settings),
					}),
				initErrorLogMessage:
					'[MCP] 初始化内置 Sequential Thinking MCP Server 失败',
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

	private shouldRestartBuiltinRuntime(
		serverId: string,
		oldSettings: McpSettings,
		newSettings: McpSettings
	): boolean {
		if (serverId === BUILTIN_MEMORY_SERVER_ID) {
			return (
				this.resolveMemoryFilePath(oldSettings) !==
				this.resolveMemoryFilePath(newSettings)
			);
		}
		if (serverId === BUILTIN_SEQUENTIAL_THINKING_SERVER_ID) {
			return (
				this.resolveDisableThoughtLogging(oldSettings) !==
				this.resolveDisableThoughtLogging(newSettings)
			);
		}
		return false;
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
		this.toolCallAgent = this.createToolCallAgent();

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
			if (
				wasEnabled &&
				isEnabled &&
				this.shouldRestartBuiltinRuntime(
					descriptor.serverId,
					oldSettings,
					settings
				)
			) {
				await this.closeBuiltinRuntime(descriptor.serverId);
				await this.ensureBuiltinRuntime(descriptor.serverId);
			}
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
					description: tool.description,
					inputSchema: tool.inputSchema,
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
	 *
	 * 当前只暴露 Tool Search 内置服务的 3 个工具，避免把全部内置工具描述
	 * 直接塞进模型上下文。
	 */
	async getToolsForModelContext(): Promise<McpToolDefinition[]> {
		if (!this.isMcpEnabled()) return [];
		if (this.isToolAgentEnabled()) {
			return [this.getToolAgentToolDefinition()];
		}
		if (!this.isBuiltinServerEnabled(BUILTIN_TOOL_SEARCH_SERVER_ID)) {
			return [];
		}

		const tools = await this.getToolsForServer(BUILTIN_TOOL_SEARCH_SERVER_ID);
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			serverId: tool.serverId,
		}));
	}

	async searchToolLibrary(
		options: ToolLibrarySearchOptions
	): Promise<ToolLibrarySearchResult[]> {
		if (!this.toolLibraryManager) {
			return [];
		}

		await this.toolLibraryManager.initialize();
		return await this.toolLibraryManager.searchTools(options);
	}

	async getToolLibraryEntry(name: string): Promise<ToolLibraryEntry | null> {
		if (!this.toolLibraryManager) {
			return null;
		}

		await this.toolLibraryManager.initialize();
		return await this.toolLibraryManager.getEntry(name);
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
		return await this.callToolWithContext(serverId, toolName, args);
	}

	async callToolWithContext(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		requestContext?: Omit<ToolAgentRequest, 'task'>
	): Promise<string> {
		if (!this.isMcpEnabled()) {
			throw new Error('MCP 功能未启用');
		}

		if (serverId === TOOL_AGENT_SERVER_ID && toolName === TOOL_AGENT_TOOL_NAME) {
			if (!this.isToolAgentEnabled() || !this.toolCallAgent) {
				throw new Error('Tool agent is not available');
			}

			const task =
				typeof args.task === 'string' ? args.task.trim() : '';
			if (!task) {
				throw new Error('execute_task requires a non-empty task');
			}

			try {
				const response = await this.toolCallAgent.execute({
					task,
					...requestContext,
				});
				return JSON.stringify(response);
			} catch (error) {
				DebugLogger.error('[MCP] Tool agent execution failed, trying legacy fallback', error);
				return await this.executeTaskWithLegacyTwoPhase(
					task,
					requestContext,
					error
				);
			}
		}

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

	isToolAgentEnabled(): boolean {
		if (!this.toolCallAgent) {
			return false;
		}

		const settings =
			this.options.getToolAgentSettings?.()
			?? DEFAULT_TOOL_AGENT_SETTINGS;
		if (!this.toolCallAgent.isEnabled()) {
			return false;
		}
		if (!settings.modelTag.trim()) {
			return false;
		}
		return (
			this.options.resolveToolAgentProviderByTag?.(settings.modelTag) ?? null
		) !== null;
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
				description: tool.description,
				inputSchema: tool.inputSchema,
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

	getVaultPlanSnapshot(): PlanSnapshot | null {
		return clonePlanSnapshot(this.vaultPlanSnapshot);
	}

	onVaultPlanChange(
		listener: (snapshot: PlanSnapshot | null) => void
	): () => void {
		this.vaultPlanListeners.add(listener);
		listener(this.getVaultPlanSnapshot());
		return () => {
			this.vaultPlanListeners.delete(listener);
		};
	}

	async syncVaultPlanSnapshot(snapshot: PlanSnapshot | null): Promise<void> {
		this.setVaultPlanSnapshot(snapshot);
		if (
			!this.isMcpEnabled()
			|| !this.isBuiltinServerEnabled(BUILTIN_VAULT_SERVER_ID)
		) {
			return;
		}

		const runtime = await this.ensureBuiltinRuntime(BUILTIN_VAULT_SERVER_ID);
		if (!runtime) {
			return;
		}

		const vaultRuntime = runtime as VaultBuiltinRuntime;
		vaultRuntime.syncPlanSnapshot(snapshot);
		this.setVaultPlanSnapshot(vaultRuntime.getPlanSnapshot());
	}

	/** 销毁所有资源 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.stateListeners = [];
		this.vaultPlanListeners.clear();
		this.detachVaultPlanRuntime();
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

	private attachVaultPlanRuntime(runtime: VaultBuiltinRuntime): void {
		this.detachVaultPlanRuntime();
		this.vaultPlanRuntimeUnsubscribe = runtime.onPlanChange((snapshot) => {
			this.setVaultPlanSnapshot(snapshot);
		});
	}

	private detachVaultPlanRuntime(): void {
		this.vaultPlanRuntimeUnsubscribe?.();
		this.vaultPlanRuntimeUnsubscribe = null;
	}

	private setVaultPlanSnapshot(snapshot: PlanSnapshot | null): void {
		const nextSnapshot = clonePlanSnapshot(snapshot);
		const previousKey = JSON.stringify(this.vaultPlanSnapshot);
		const nextKey = JSON.stringify(nextSnapshot);

		this.vaultPlanSnapshot = nextSnapshot;
		if (previousKey === nextKey) {
			return;
		}

		for (const listener of this.vaultPlanListeners) {
			try {
				listener(this.getVaultPlanSnapshot());
			} catch (error) {
				DebugLogger.error('[MCP] Vault 计划监听器执行出错', error);
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
					description: tool.description,
					inputSchema: tool.inputSchema,
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

	private createToolCallAgent(): ToolCallAgent | null {
		if (
			!this.options.getToolAgentSettings
			|| !this.options.resolveToolAgentProviderByTag
			|| !this.options.getVendorByName
		) {
			return null;
		}

		return new ToolCallAgent({
			getSettings: () =>
				this.options.getToolAgentSettings?.()
				?? DEFAULT_TOOL_AGENT_SETTINGS,
			resolveProviderByTag: (tag) =>
				this.options.resolveToolAgentProviderByTag?.(tag) ?? null,
			getVendorByName: (vendorName) =>
				this.options.getVendorByName?.(vendorName),
			callTool: async (serverId, toolName, args) =>
				await this.callActualTool(serverId, toolName, args),
			getAvailableTools: async (): Promise<ToolAgentRuntimeTool[]> =>
				await this.getAvailableToolsWithLazyStart(),
			protectedPathPrefixes: this.options.getProtectedPathPrefixes?.() ?? [],
		});
	}

	private getToolAgentToolDefinition(): McpToolDefinition {
		return {
			name: TOOL_AGENT_TOOL_NAME,
			description:
				'Use this tool when you need Vault access, search, memory operations, or any multi-step MCP task. Describe the task in natural language and the tool agent will choose and execute the right tools.',
			inputSchema: {
				type: 'object',
				properties: {
					task: {
						type: 'string',
						description: 'Natural-language task description for the tool execution agent.',
					},
				},
				required: ['task'],
			},
			serverId: TOOL_AGENT_SERVER_ID,
		};
	}

	private async executeTaskWithLegacyTwoPhase(
		task: string,
		requestContext?: Omit<ToolAgentRequest, 'task'>,
		cause?: unknown
	): Promise<string> {
		if (!this.isBuiltinServerEnabled(BUILTIN_TOOL_SEARCH_SERVER_ID)) {
			throw cause instanceof Error ? cause : new Error(String(cause ?? 'Tool agent failed'));
		}

		const settings =
			this.options.getToolAgentSettings?.()
			?? DEFAULT_TOOL_AGENT_SETTINGS;
		const providerConfig = settings.modelTag.trim()
			? this.options.resolveToolAgentProviderByTag?.(settings.modelTag) ?? null
			: null;
		const vendor = providerConfig
			? this.options.getVendorByName?.(providerConfig.vendorName)
			: undefined;
		if (!providerConfig || !vendor) {
			throw cause instanceof Error ? cause : new Error(String(cause ?? 'Tool agent failed'));
		}

		const toolSearchTools = (await this.getToolsForServer(BUILTIN_TOOL_SEARCH_SERVER_ID))
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				serverId: tool.serverId,
			}));
		if (toolSearchTools.length === 0) {
			throw cause instanceof Error ? cause : new Error(String(cause ?? 'Tool agent failed'));
		}

		const trace: ToolExecutionStep[] = [];
		const startedAt = Date.now();
		const actualToolCall =
			requestContext?.runtime?.callTool
			?? (async (serverId: string, toolName: string, args: Record<string, unknown>) =>
				await this.callActualTool(serverId, toolName, args));
		const tracedActualToolCall = async (
			serverId: string,
			toolName: string,
			args: Record<string, unknown>
		): Promise<string> => {
			const stepStartedAt = Date.now();
			try {
				const result = await actualToolCall(serverId, toolName, args);
				trace.push({
					stepIndex: trace.length + 1,
					toolName,
					serverId,
					arguments: args,
					result,
					status: 'success',
					durationMs: Date.now() - stepStartedAt,
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				trace.push({
					stepIndex: trace.length + 1,
					toolName,
					serverId,
					arguments: args,
					result: message,
					status: 'failed',
					error: message,
					durationMs: Date.now() - stepStartedAt,
				});
				throw error;
			}
		};

		const { createChatTwoPhaseToolController } = await import('./chatTwoPhaseToolController');
		const toolController = createChatTwoPhaseToolController({
			manager: this,
			callTool: tracedActualToolCall,
			initialTools: toolSearchTools,
			latestUserRequest: task,
			allowedServerIds: requestContext?.hints?.likelyServerIds,
		});
		const tracedControllerCall = async (
			serverId: string,
			toolName: string,
			args: Record<string, unknown>
		): Promise<string> => {
			const stepStartedAt = Date.now();
			try {
				const result = await toolController.callTool(serverId, toolName, args);
				trace.push({
					stepIndex: trace.length + 1,
					toolName,
					serverId,
					arguments: args,
					result,
					status: 'success',
					durationMs: Date.now() - stepStartedAt,
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				trace.push({
					stepIndex: trace.length + 1,
					toolName,
					serverId,
					arguments: args,
					result: message,
					status: 'failed',
					error: message,
					durationMs: Date.now() - stepStartedAt,
				});
				throw error;
			}
		};

		const sharedToolExecutionSettings = this.options.getToolExecutionSettings?.();
		const sendRequest = vendor.sendRequestFunc({
			...providerConfig.options,
			mcpTools: toolSearchTools,
			mcpGetTools: toolController.getCurrentTools,
			mcpCallTool: tracedControllerCall,
			mcpMaxToolCallLoops:
				sharedToolExecutionSettings?.maxToolCalls
				?? this.settings.maxToolCallLoops
				?? 10,
		});
		const controller = new AbortController();
		const timeoutMs =
			requestContext?.constraints?.timeoutMs
			?? sharedToolExecutionSettings?.timeoutMs
			?? settings.defaultConstraints.timeoutMs;
		const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
		const messages: ProviderMessage[] = [
			{
				role: 'system',
				content:
					'You are a legacy MCP execution fallback agent. Use the available tools to complete the task. Return JSON only in the format {"status":"success|partial|failed|needs_clarification","summary":"...","data":...,"clarificationNeeded":"..."} and do not explain the fallback.',
			},
			{
				role: 'user',
				content: this.buildLegacyToolAgentUserPrompt(task, requestContext),
			},
		];

		try {
			let content = '';
			const resolveEmbed: ResolveEmbedAsBinary = async () => new ArrayBuffer(0);
			for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
				content += chunk;
			}
			return this.normalizeToolAgentResponsePayload(content, trace, Date.now() - startedAt);
		} finally {
			globalThis.clearTimeout(timeoutId);
		}
	}

	private buildLegacyToolAgentUserPrompt(
		task: string,
		requestContext?: Omit<ToolAgentRequest, 'task'>
	): string {
		return [
			`Task: ${task}`,
			requestContext?.hints?.likelyServerIds?.length
				? `Allowed servers: ${requestContext.hints.likelyServerIds.join(', ')}`
				: '',
			requestContext?.context?.activeFilePath
				? `Active file: ${requestContext.context.activeFilePath}`
				: '',
			requestContext?.context?.selectedText
				? `Selected text:\n${requestContext.context.selectedText}`
				: '',
			requestContext?.context?.relevantPaths?.length
				? `Relevant paths: ${requestContext.context.relevantPaths.join(', ')}`
				: '',
		]
			.filter(Boolean)
			.join('\n\n');
	}

	private normalizeToolAgentResponsePayload(
		content: string,
		trace: ToolExecutionStep[],
		durationMs: number
	): string {
		const trimmed = content.trim();
		const firstBrace = trimmed.indexOf('{');
		const lastBrace = trimmed.lastIndexOf('}');
		const candidates = [
			trimmed,
			firstBrace >= 0 && lastBrace > firstBrace
				? trimmed.slice(firstBrace, lastBrace + 1)
				: '',
		].filter(Boolean);

		for (const candidate of candidates) {
			try {
				const parsed = JSON.parse(candidate) as Record<string, unknown>;
				const status =
					parsed.status === 'success'
					|| parsed.status === 'partial'
					|| parsed.status === 'failed'
					|| parsed.status === 'needs_clarification'
						? parsed.status
						: 'success';
				return JSON.stringify({
					status,
					summary:
						typeof parsed.summary === 'string' && parsed.summary.trim()
							? parsed.summary.trim()
							: trimmed || 'Legacy tool fallback completed.',
					...(Object.prototype.hasOwnProperty.call(parsed, 'data')
						? { data: parsed.data }
						: {}),
					...(typeof parsed.clarificationNeeded === 'string'
						&& parsed.clarificationNeeded.trim()
						? { clarificationNeeded: parsed.clarificationNeeded.trim() }
						: {}),
					trace,
					metrics: {
						toolCallCount: trace.length,
						totalTokens: 0,
						durationMs,
					},
				});
			} catch {
				continue;
			}
		}

		return JSON.stringify({
			status: 'success',
			summary: trimmed || 'Legacy tool fallback completed.',
			trace,
			metrics: {
				toolCallCount: trace.length,
				totalTokens: 0,
				durationMs,
			},
		});
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
				if (serverId === BUILTIN_VAULT_SERVER_ID) {
					const vaultRuntime = runtime as VaultBuiltinRuntime;
					this.attachVaultPlanRuntime(vaultRuntime);
					vaultRuntime.syncPlanSnapshot(this.vaultPlanSnapshot);
					this.setVaultPlanSnapshot(vaultRuntime.getPlanSnapshot());
				}

				const tools = await runtime.listTools();
				this.builtinStates.set(serverId, {
					serverId,
					status: 'running',
					lastError: undefined,
					tools: tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
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
		if (serverId === BUILTIN_VAULT_SERVER_ID) {
			this.detachVaultPlanRuntime();
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
