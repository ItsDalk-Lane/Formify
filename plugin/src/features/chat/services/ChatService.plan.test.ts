import type { PlanSnapshot } from 'src/builtin-mcp/runtime/plan-state';
import { ChatService } from './ChatService';
import { HistoryService } from './HistoryService';
import type { ChatSession } from '../types/chat';

class MockMcpClientManager {
	private snapshot: PlanSnapshot | null = null;
	private listeners = new Set<(snapshot: PlanSnapshot | null) => void>();

	onLivePlanChange(listener: (snapshot: PlanSnapshot | null) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async syncLivePlanSnapshot(snapshot: PlanSnapshot | null): Promise<void> {
		this.snapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
		for (const listener of this.listeners) {
			listener(this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : null);
		}
	}

	getSnapshot(): PlanSnapshot | null {
		return this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : null;
	}
}

const flushAsync = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const createPlugin = (manager: MockMcpClientManager) =>
	({
		app: {
			workspace: {
				getActiveViewOfType: () => null,
				getActiveFile: () => null,
			},
			vault: {
				getAbstractFileByPath: () => null,
			},
		},
		settings: {
			aiDataFolder: 'System/formify',
			chat: {},
			tars: {
				settings: {
					providers: [],
					tools: {
						enabled: false,
						globalTools: [],
						executionMode: 'manual',
					},
					internalLinkParsing: {
						enabled: false,
						parseInTemplates: false,
						maxDepth: 0,
						timeout: 0,
					},
				},
			},
		},
		featureCoordinator: {
			getMcpClientManager: () => manager,
		},
	}) as any;

describe('ChatService live plan sync', () => {
	const planSnapshot: PlanSnapshot = {
		title: '会话任务',
		tasks: [
			{
				name: '实现实时刷新',
				status: 'in_progress',
				acceptance_criteria: ['write_plan 后自动显示'],
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

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should clear live plan when creating a new session', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();

		await manager.syncLivePlanSnapshot(planSnapshot);
		expect(service.getActiveSession()?.livePlan).toEqual(planSnapshot);

		service.createNewSession();
		await flushAsync();

		expect(service.getActiveSession()?.livePlan).toBeNull();
		expect(manager.getSnapshot()).toBeNull();
	});

	it('should restore previous live plan when restoring saved session state', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();

		await manager.syncLivePlanSnapshot(planSnapshot);
		const savedState = service.saveSessionState();

		service.createNewSession();
		await flushAsync();
		service.restoreSessionState(savedState);
		await flushAsync();

		expect(service.getActiveSession()?.livePlan).toEqual(planSnapshot);
		expect(manager.getSnapshot()).toEqual(planSnapshot);
	});

	it('should restore live plan when loading history session', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();

		await manager.syncLivePlanSnapshot(planSnapshot);

		const historySession: ChatSession = {
			id: 'history-1',
			title: '历史会话',
			modelId: '',
			messages: [],
			createdAt: 1,
			updatedAt: 1,
			selectedImages: [],
			enableTemplateAsSystemPrompt: false,
			livePlan: planSnapshot,
		};

		jest
			.spyOn(HistoryService.prototype, 'loadSession')
			.mockResolvedValue(historySession);

		await service.loadHistory('history.md');
		await flushAsync();

		expect(service.getActiveSession()?.id).toBe('history-1');
		expect(service.getActiveSession()?.livePlan).toEqual(planSnapshot);
		expect(manager.getSnapshot()).toEqual(planSnapshot);
	});

	it('should persist live plan to history frontmatter when it changes', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();

		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}
		session.filePath = 'history.md';

		const updateFrontmatterSpy = jest
			.spyOn(HistoryService.prototype, 'updateSessionFrontmatter')
			.mockResolvedValue(undefined);

		await manager.syncLivePlanSnapshot(planSnapshot);
		await flushAsync();

		expect(updateFrontmatterSpy).toHaveBeenCalledWith('history.md', {
			livePlan: planSnapshot,
		});
	});

	it('should always inject live plan guidance when a session already has a plan', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		const serviceInternal = service as any;

		const guidance = serviceInternal.buildLivePlanGuidance(planSnapshot);
		const context = serviceInternal.buildLivePlanUserContext(planSnapshot);

		expect(guidance).toContain('你需要根据最新用户消息自行判断');
		expect(context).toContain('请结合最新用户消息自己判断');
		expect(context).toContain('1. [in_progress] 实现实时刷新');
	});

	it('should treat structural write_plan changes as an explicit plan rewrite', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		const serviceInternal = service as any;

		expect(
			serviceInternal.isPlanRewriteRequest(planSnapshot, {
				title: '重排后的任务',
				tasks: [
					{
						name: '重新拆分任务',
						status: 'todo',
						acceptance_criteria: ['新标准'],
					},
				],
			})
		).toBe(true);
	});

	it('should reject batched write_plan completion during continue flow', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		const serviceInternal = service as any;
		const sequentialPlan: PlanSnapshot = {
			title: '顺序计划',
			tasks: [
				{
					name: '任务 1',
					status: 'in_progress',
					acceptance_criteria: ['完成第一步'],
				},
				{
					name: '任务 2',
					status: 'todo',
					acceptance_criteria: ['完成第二步'],
				},
				{
					name: '任务 3',
					status: 'todo',
					acceptance_criteria: ['完成第三步'],
				},
			],
			summary: {
				total: 3,
				todo: 2,
				inProgress: 1,
				done: 0,
				skipped: 0,
			},
		};

		expect(() =>
			serviceInternal.validatePlanContinuationWritePlanArgs(sequentialPlan, {
				title: '顺序计划',
				tasks: [
					{
						name: '任务 1',
						status: 'done',
						acceptance_criteria: ['完成第一步'],
						outcome: '已完成',
					},
					{
						name: '任务 2',
						status: 'done',
						acceptance_criteria: ['完成第二步'],
						outcome: '也被批量完成',
					},
					{
						name: '任务 3',
						status: 'todo',
						acceptance_criteria: ['完成第三步'],
					},
				],
			})
		).toThrow('一次 write_plan 只能完成或跳过一个任务');
	});

});
