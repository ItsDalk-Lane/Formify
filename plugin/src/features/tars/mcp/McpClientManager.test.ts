import {
	clonePlanSnapshot,
	type PlanSnapshot,
} from 'src/builtin-mcp/runtime/plan-state';
import { BUILTIN_VAULT_SERVER_ID } from 'src/builtin-mcp/constants';
import { McpClientManager } from './McpClientManager';
import type { McpSettings } from './types';

const createVaultBuiltinRuntimeMock = jest.fn();

jest.mock('src/builtin-mcp/vault-mcp-server', () => ({
	createVaultBuiltinRuntime: (...args: unknown[]) =>
		createVaultBuiltinRuntimeMock(...args),
}));

jest.mock('src/builtin-mcp/memory-mcp-server', () => ({
	createMemoryBuiltinRuntime: jest.fn(),
}));

jest.mock('src/builtin-mcp/sequentialthinking-mcp-server', () => ({
	createSequentialThinkingBuiltinRuntime: jest.fn(),
}));

function createMockVaultRuntime() {
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
			serverId: BUILTIN_VAULT_SERVER_ID,
			serverName: 'Vault MCP',
			client: {} as any,
			callTool: jest.fn(),
			listTools: jest.fn().mockResolvedValue([
				{
					name: 'write_plan',
					description: 'create or update plan',
					inputSchema: {},
					serverId: BUILTIN_VAULT_SERVER_ID,
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
		builtinVaultEnabled: true,
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
		createVaultBuiltinRuntimeMock.mockReset();
	});

	it('should broadcast vault plan changes from runtime', async () => {
		const mockRuntime = createMockVaultRuntime();
		createVaultBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		await manager.getToolsForServer(BUILTIN_VAULT_SERVER_ID);

		const received: Array<PlanSnapshot | null> = [];
		const unsubscribe = manager.onVaultPlanChange((snapshot) => {
			received.push(snapshot);
		});

		mockRuntime.emit(planSnapshot);

		expect(received[received.length - 1]).toEqual(planSnapshot);

		unsubscribe();
		await manager.dispose();
	});

	it('should sync session plan snapshot into vault runtime', async () => {
		const mockRuntime = createMockVaultRuntime();
		createVaultBuiltinRuntimeMock.mockResolvedValue(mockRuntime.runtime);

		const manager = new McpClientManager({} as any, settings);
		await manager.getToolsForServer(BUILTIN_VAULT_SERVER_ID);
		await manager.syncVaultPlanSnapshot(planSnapshot);

		expect(mockRuntime.getCurrentSnapshot()).toEqual(planSnapshot);
		expect(manager.getVaultPlanSnapshot()).toEqual(planSnapshot);

		await manager.dispose();
	});
});
