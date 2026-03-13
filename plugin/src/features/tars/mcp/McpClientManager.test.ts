import {
	clonePlanSnapshot,
	type PlanSnapshot,
} from 'src/builtin-mcp/runtime/plan-state';
import {
	BUILTIN_CORE_TOOLS_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_ID,
} from 'src/builtin-mcp/constants';
import { McpClientManager } from './McpClientManager';
import type { McpSettings } from './types';

const createCoreToolsBuiltinRuntimeMock = jest.fn();

jest.mock('src/builtin-mcp/core-tools-mcp-server', () => ({
	createCoreToolsBuiltinRuntime: (...args: unknown[]) =>
		createCoreToolsBuiltinRuntimeMock(...args),
}));

jest.mock('src/builtin-mcp/filesystem-mcp-server', () => ({
	createFilesystemBuiltinRuntime: jest.fn().mockResolvedValue({
		serverId: BUILTIN_FILESYSTEM_SERVER_ID,
		serverName: '内置 Filesystem 工具',
		client: {} as any,
		callTool: jest.fn(),
		listTools: jest.fn().mockResolvedValue([]),
		close: jest.fn().mockResolvedValue(undefined),
	}),
}));

function createMockCoreToolsRuntime() {
	let currentSnapshot: PlanSnapshot | null = null;
	const listeners = new Set<(snapshot: PlanSnapshot | null) => void>();
	const close = jest.fn().mockResolvedValue(undefined);

	const emit = (snapshot: PlanSnapshot | null) => {
		currentSnapshot = clonePlanSnapshot(snapshot);
		for (const listener of listeners) {
			listener(clonePlanSnapshot(currentSnapshot));
		}
	};

	return {
		runtime: {
			serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			serverName: '内置基础工具',
			client: {} as any,
			callTool: jest.fn(),
			listTools: jest.fn().mockResolvedValue([
				{
					name: 'write_plan',
					description: 'create or update plan',
					inputSchema: {},
					serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
				},
				{
					name: 'formify_execute_script',
					description: 'execute script',
					inputSchema: {},
					serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
				},
				{
					name: 'formify_get_time',
					description: 'get current time or convert between timezones',
					inputSchema: {},
					serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
				},
			]),
			close,
			resetState: jest.fn(),
			getPlanSnapshot: jest.fn(() => clonePlanSnapshot(currentSnapshot)),
			syncPlanSnapshot: jest.fn((snapshot: PlanSnapshot | null) => {
				emit(snapshot);
				return clonePlanSnapshot(currentSnapshot);
			}),
			onPlanChange: jest.fn((listener: (snapshot: PlanSnapshot | null) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}),
		},
		emit,
		close,
		getCurrentSnapshot: () => clonePlanSnapshot(currentSnapshot),
	};
}

describe('McpClientManager', () => {
	const settings: McpSettings = {
		servers: [],
		builtinCoreToolsEnabled: true,
		builtinFilesystemEnabled: false,
		builtinTimeDefaultTimezone: 'Asia/Shanghai',
		maxToolCallLoops: 10,
	};

	const planSnapshot: PlanSnapshot = {
		title: '同步任务计划',
		tasks: [
			{
				name: '监听 write_plan',
				status: 'in_progress',
				acceptance_criteria: ['收到更新事件'],
			},
		],
		summary: {
			total: 1,
			todo: 0,
			inProgress: 1,
			done: 0,
			skipped: 0,
		},
	};

	beforeEach(() => {
		createCoreToolsBuiltinRuntimeMock.mockReset();
	});

	it('should broadcast live plan changes from core tools runtime', async () => {
		const mockRuntime = createMockCoreToolsRuntime();
		createCoreToolsBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		await manager.getToolsForServer(BUILTIN_CORE_TOOLS_SERVER_ID);

		const received: Array<PlanSnapshot | null> = [];
		const unsubscribe = manager.onLivePlanChange((snapshot) => {
			received.push(snapshot);
		});

		mockRuntime.emit(planSnapshot);

		expect(received[received.length - 1]).toEqual(planSnapshot);

		unsubscribe();
		await manager.dispose();
	});

	it('should sync session plan snapshot into core tools runtime', async () => {
		const mockRuntime = createMockCoreToolsRuntime();
		createCoreToolsBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		await manager.getToolsForServer(BUILTIN_CORE_TOOLS_SERVER_ID);
		await manager.syncLivePlanSnapshot(planSnapshot);

		expect(mockRuntime.getCurrentSnapshot()).toEqual(planSnapshot);
		expect(manager.getLivePlanSnapshot()).toEqual(planSnapshot);

		await manager.dispose();
	});

	it('should discover core tools builtin tools when enabled', async () => {
		const mockRuntime = createMockCoreToolsRuntime();
		createCoreToolsBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		const tools = await manager.getToolsForServer(BUILTIN_CORE_TOOLS_SERVER_ID);

		expect(createCoreToolsBuiltinRuntimeMock).toHaveBeenCalledTimes(1);
		expect(tools).toEqual([
			{
				name: 'write_plan',
				description: 'create or update plan',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
			{
				name: 'formify_execute_script',
				description: 'execute script',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
			{
				name: 'formify_get_time',
				description: 'get current time or convert between timezones',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
		]);
		expect(manager.getState(BUILTIN_CORE_TOOLS_SERVER_ID)?.status).toBe('running');

		await manager.dispose();
	});

	it('should keep core tools builtin stopped when disabled', async () => {
		const manager = new McpClientManager({} as any, {
			...settings,
			builtinCoreToolsEnabled: false,
		});
		const tools = await manager.getToolsForServer(BUILTIN_CORE_TOOLS_SERVER_ID);

		expect(tools).toEqual([]);
		expect(createCoreToolsBuiltinRuntimeMock).not.toHaveBeenCalled();
		expect(manager.getState(BUILTIN_CORE_TOOLS_SERVER_ID)?.status).toBe('stopped');

		await manager.dispose();
	});

	it('should expose all enabled builtin server summaries in the configured order', async () => {
		const mockRuntime = createMockCoreToolsRuntime();
		createCoreToolsBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, {
			...settings,
			builtinFilesystemEnabled: true,
		});

		expect(manager.getEnabledServerSummaries()).toEqual([
			{ id: BUILTIN_CORE_TOOLS_SERVER_ID, name: '内置基础工具' },
			{ id: BUILTIN_FILESYSTEM_SERVER_ID, name: '内置 Filesystem 工具' },
		]);

		await manager.dispose();
	});

	it('should expose core tools to the model context without removed search or vault tools', async () => {
		const mockRuntime = createMockCoreToolsRuntime();
		createCoreToolsBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		const tools = await manager.getToolsForModelContext();

		expect(tools).toEqual([
			{
				name: 'write_plan',
				description: 'create or update plan',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
			{
				name: 'formify_execute_script',
				description: 'execute script',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
			{
				name: 'formify_get_time',
				description: 'get current time or convert between timezones',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
		]);
		expect(tools.some((tool) => tool.name === 'quick_search')).toBe(false);
		expect(tools.some((tool) => tool.name === 'read_file')).toBe(false);

		await manager.dispose();
	});

	it('should rebuild core tools runtime when builtin time default timezone changes', async () => {
		const firstRuntime = createMockCoreToolsRuntime();
		const secondRuntime = createMockCoreToolsRuntime();
		const app = {} as any;
		createCoreToolsBuiltinRuntimeMock
			.mockResolvedValueOnce(firstRuntime.runtime)
			.mockResolvedValueOnce(secondRuntime.runtime);

		const manager = new McpClientManager(app, settings);
		await manager.getToolsForServer(BUILTIN_CORE_TOOLS_SERVER_ID);
		await manager.syncLivePlanSnapshot(planSnapshot);

		await manager.updateSettings({
			...settings,
			builtinTimeDefaultTimezone: 'America/New_York',
		});

		expect(firstRuntime.close).toHaveBeenCalledTimes(1);
		expect(secondRuntime.getCurrentSnapshot()).toEqual(planSnapshot);
		expect(createCoreToolsBuiltinRuntimeMock).toHaveBeenCalledTimes(2);
		expect(createCoreToolsBuiltinRuntimeMock).toHaveBeenNthCalledWith(
			1,
			app,
			settings
		);
		expect(createCoreToolsBuiltinRuntimeMock).toHaveBeenNthCalledWith(
			2,
			app,
			{
				...settings,
				builtinTimeDefaultTimezone: 'America/New_York',
			}
		);

		await manager.dispose();
	});
});
