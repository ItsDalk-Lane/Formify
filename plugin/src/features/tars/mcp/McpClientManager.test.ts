import {
	clonePlanSnapshot,
	type PlanSnapshot,
} from 'src/builtin-mcp/runtime/plan-state';
import {
	BUILTIN_CORE_TOOLS_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_ID,
	BUILTIN_FETCH_SERVER_ID,
	BUILTIN_TIME_SERVER_ID,
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
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

jest.mock('src/builtin-mcp/fetch-mcp-server', () => ({
	createFetchBuiltinRuntime: jest.fn().mockResolvedValue({
		serverId: BUILTIN_FETCH_SERVER_ID,
		serverName: '内置 Fetch 工具',
		client: {} as any,
		callTool: jest.fn(),
		listTools: jest.fn().mockResolvedValue([]),
		close: jest.fn().mockResolvedValue(undefined),
	}),
}));

jest.mock('src/builtin-mcp/time-mcp-server', () => ({
	createTimeBuiltinRuntime: jest.fn().mockResolvedValue({
		serverId: BUILTIN_TIME_SERVER_ID,
		serverName: '内置 Time 工具',
		client: {} as any,
		callTool: jest.fn(),
		listTools: jest.fn().mockResolvedValue([]),
		close: jest.fn().mockResolvedValue(undefined),
	}),
}));

jest.mock('src/builtin-mcp/memory-mcp-server', () => ({
	createMemoryBuiltinRuntime: jest.fn().mockResolvedValue({
		serverId: BUILTIN_MEMORY_SERVER_ID,
		serverName: 'Memory MCP',
		client: {} as any,
		callTool: jest.fn(),
		listTools: jest.fn().mockResolvedValue([]),
		close: jest.fn().mockResolvedValue(undefined),
	}),
}));

jest.mock('src/builtin-mcp/sequentialthinking-mcp-server', () => ({
	createSequentialThinkingBuiltinRuntime: jest.fn().mockResolvedValue({
		serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
		serverName: 'Sequential Thinking MCP',
		client: {} as any,
		callTool: jest.fn(),
		listTools: jest.fn().mockResolvedValue([]),
		close: jest.fn().mockResolvedValue(undefined),
	}),
}));

function createMockCoreToolsRuntime() {
	let currentSnapshot: PlanSnapshot | null = null;
	const listeners = new Set<(snapshot: PlanSnapshot | null) => void>();

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
					name: 'execute_script',
					description: 'execute script',
					inputSchema: {},
					serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
				},
			]),
			close: jest.fn().mockResolvedValue(undefined),
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
		getCurrentSnapshot: () => clonePlanSnapshot(currentSnapshot),
	};
}

describe('McpClientManager', () => {
	const settings: McpSettings = {
		servers: [],
		builtinCoreToolsEnabled: true,
		builtinFilesystemEnabled: false,
		builtinFetchEnabled: false,
		builtinTimeEnabled: false,
		builtinMemoryEnabled: false,
		builtinSequentialThinkingEnabled: false,
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
				name: 'execute_script',
				description: 'execute script',
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
			builtinFetchEnabled: true,
			builtinTimeEnabled: true,
			builtinMemoryEnabled: true,
			builtinSequentialThinkingEnabled: true,
		});

		expect(manager.getEnabledServerSummaries()).toEqual([
			{ id: BUILTIN_CORE_TOOLS_SERVER_ID, name: '内置基础工具' },
			{ id: BUILTIN_FILESYSTEM_SERVER_ID, name: '内置 Filesystem 工具' },
			{ id: BUILTIN_FETCH_SERVER_ID, name: '内置 Fetch 工具' },
			{ id: BUILTIN_TIME_SERVER_ID, name: '内置 Time 工具' },
			{ id: BUILTIN_MEMORY_SERVER_ID, name: '内置 Memory 工具' },
			{
				id: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
				name: '内置 Sequential Thinking 工具',
			},
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
				name: 'execute_script',
				description: 'execute script',
				inputSchema: {},
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			},
		]);
		expect(tools.some((tool) => tool.name === 'quick_search')).toBe(false);
		expect(tools.some((tool) => tool.name === 'read_file')).toBe(false);

		await manager.dispose();
	});
});
