import type { PlanSnapshot } from 'src/builtin-mcp/runtime/plan-state';
import { ChatService } from './ChatService';
import { HistoryService } from './HistoryService';
import type { ChatSession } from '../types/chat';

class MockMcpClientManager {
	private snapshot: PlanSnapshot | null = null;
	private listeners = new Set<(snapshot: PlanSnapshot | null) => void>();

	onVaultPlanChange(listener: (snapshot: PlanSnapshot | null) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async syncVaultPlanSnapshot(snapshot: PlanSnapshot | null): Promise<void> {
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

		await manager.syncVaultPlanSnapshot(planSnapshot);
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

		await manager.syncVaultPlanSnapshot(planSnapshot);
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

		await manager.syncVaultPlanSnapshot(planSnapshot);

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

		await manager.syncVaultPlanSnapshot(planSnapshot);
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

	it('should store pending clarification when the intent host asks for clarification', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}

		jest.spyOn(serviceInternal, 'appendHostAssistantMessage').mockResolvedValue(undefined);

		const handled = await serviceInternal.handleIntentHostResponse({
			session,
			userMessage: {
				id: 'user-1',
				role: 'user',
				content: '帮我处理一下',
				timestamp: Date.now(),
				metadata: {},
			},
			currentSelectedFiles: [],
			currentSelectedFolders: [],
			originalUserInput: '帮我处理一下',
			intentRecognitionInput: '帮我处理一下',
			isImageGenerationIntent: false,
			isModelSupportImageGeneration: false,
			triggerSource: 'chat_input',
			pendingClarificationContext: null,
			intentResult: {
				understanding: {
					normalizedRequest: '处理当前请求',
					target: {
						type: 'vault_wide',
					},
				},
				classification: {
					domain: 'conversation',
					intentType: 'clarification',
					confidence: 0.9,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'clarify_first',
					contextPrep: {
						needsActiveFileContent: false,
						needsSelectedText: false,
						needsMemoryLoad: false,
						needsPlanContext: false,
					},
					constraints: {
						readOnly: true,
						allowShell: false,
						allowScript: false,
						maxToolCalls: 0,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
					clarification: {
						reason: '需要明确动作',
						questions: [
							{
								question: '你希望我做什么？',
								options: ['总结', '分析'],
								defaultAssumption: '总结。',
							},
						],
					},
				},
			},
		});

		expect(handled).toBe(true);
		expect(session.pendingIntentClarification?.originalUserMessage).toBe('帮我处理一下');
		expect(session.pendingIntentClarification?.questions[0]?.question).toBe('你希望我做什么？');
	});

	it('should merge clarification replies back into a full recognition input', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}
		session.pendingIntentClarification = {
			originalUserMessage: '给我总结 000 号文件夹中所有文件的内容',
			normalizedRequest: '总结 000 文件夹内容',
			reason: '需要你确认目标',
			questions: [
				{
					question: '你指的是哪一个？',
					options: ['Projects/000', 'Archive/000'],
					defaultAssumption: 'Projects/000',
				},
			],
			createdAt: Date.now(),
			triggerSource: 'chat_input',
			activeFilePath: 'notes/today.md',
			selectedFiles: [],
			selectedFolders: [],
		};

		jest.spyOn(serviceInternal.contextAssembler, 'analyzeMessage').mockReturnValue({
			normalizedActions: [],
			preparatoryActions: [],
			isCompound: false,
			references: [],
			pathResolutions: [],
			resolvedTargets: [],
			preferredTarget: 'none',
			targetStatus: 'none',
			hasClearAction: false,
			hasUniqueResolvedTarget: false,
			ambiguityReasons: ['multiple_target_candidates'],
			summary: 'clarification reply',
		});

		const prepared = {
			session,
			userMessage: {
				id: 'user-2',
				role: 'user',
				content: '第一个',
				timestamp: Date.now(),
				metadata: {},
			},
			currentSelectedFiles: [],
			currentSelectedFolders: [],
			originalUserInput: '第一个',
			intentRecognitionInput: '第一个',
			isImageGenerationIntent: false,
			isModelSupportImageGeneration: false,
			triggerSource: 'chat_input',
			pendingClarificationContext: null,
		};

		serviceInternal.preparePendingIntentClarification(prepared);

		expect(prepared.pendingClarificationContext?.originalUserMessage).toBe('给我总结 000 号文件夹中所有文件的内容');
		expect(prepared.intentRecognitionInput).toContain('给我总结 000 号文件夹中所有文件的内容');
		expect(prepared.intentRecognitionInput).toContain('补充说明：第一个');
	});

	it('should clear pending clarification when the user sends a new independent request', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}
		session.pendingIntentClarification = {
			originalUserMessage: '给我总结 000 号文件夹中所有文件的内容',
			normalizedRequest: '总结 000 文件夹内容',
			reason: '需要你确认目标',
			questions: [],
			createdAt: Date.now(),
			triggerSource: 'chat_input',
			selectedFiles: [],
			selectedFolders: [],
		};

		jest.spyOn(serviceInternal.contextAssembler, 'analyzeMessage').mockReturnValue({
			normalizedActions: ['summarize'],
			primaryAction: 'summarize',
			preparatoryActions: [],
			isCompound: false,
			references: [],
			pathResolutions: [],
			resolvedTargets: [{ path: '111', kind: 'folder' }],
			preferredTarget: 'folder',
			targetStatus: 'unique',
			hasClearAction: true,
			hasUniqueResolvedTarget: true,
			ambiguityReasons: [],
			summary: 'new request',
		});

		const prepared = {
			session,
			userMessage: {
				id: 'user-3',
				role: 'user',
				content: '帮我总结 111 文件夹',
				timestamp: Date.now(),
				metadata: {},
			},
			currentSelectedFiles: [],
			currentSelectedFolders: [],
			originalUserInput: '帮我总结 111 文件夹',
			intentRecognitionInput: '帮我总结 111 文件夹',
			isImageGenerationIntent: false,
			isModelSupportImageGeneration: false,
			triggerSource: 'chat_input',
			pendingClarificationContext: null,
		};

		serviceInternal.preparePendingIntentClarification(prepared);

		expect(session.pendingIntentClarification).toBeNull();
		expect(prepared.intentRecognitionInput).toBe('帮我总结 111 文件夹');
	});

	it('should reuse the previous action for supplemental target-only follow-ups', () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}

		const previousUserMessage = {
			id: 'user-prev',
			role: 'user' as const,
			content: '给我总结 000 文件夹',
			timestamp: Date.now() - 1000,
			metadata: {
				taskUserInput: '给我总结 000 文件夹',
				triggerSource: 'chat_input',
				intentResult: {
					understanding: {
						normalizedRequest: '总结 000 文件夹',
						target: {
							type: 'specific_files',
							paths: ['000'],
						},
					},
					classification: {
						domain: 'reasoning',
						intentType: 'analyze_content',
						confidence: 0.9,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'tool_assisted',
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 4,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: true,
							requiresConfirmation: false,
						},
					},
				},
			},
		};
		const currentUserMessage = {
			id: 'user-current',
			role: 'user' as const,
			content: '补充：Projects/000',
			timestamp: Date.now(),
			metadata: {},
		};
		session.messages.push(previousUserMessage, currentUserMessage);

		jest.spyOn(serviceInternal.contextAssembler, 'analyzeMessage').mockReturnValue({
			normalizedActions: [],
			preparatoryActions: [],
			isCompound: false,
			references: [{ raw: 'Projects/000', type: 'explicit_path', normalized: 'Projects/000', preferredKind: 'folder' }],
			pathResolutions: [],
			resolvedTargets: [{ path: 'Projects/000', kind: 'folder' }],
			preferredTarget: 'folder',
			targetStatus: 'unique',
			hasClearAction: false,
			hasUniqueResolvedTarget: true,
			ambiguityReasons: [],
			summary: 'supplemental target update',
		});

		const prepared = {
			session,
			userMessage: currentUserMessage,
			currentSelectedFiles: [],
			currentSelectedFolders: [],
			originalUserInput: '补充：Projects/000',
			intentRecognitionInput: '补充：Projects/000',
			isImageGenerationIntent: false,
			isModelSupportImageGeneration: false,
			triggerSource: 'chat_input',
			pendingClarificationContext: null,
		};

		serviceInternal.preparePendingIntentClarification(prepared);

		expect(prepared.pendingClarificationContext?.originalUserMessage).toBe('给我总结 000 文件夹');
		expect(prepared.intentRecognitionInput).toContain('给我总结 000 文件夹');
		expect(prepared.intentRecognitionInput).toContain('补充说明：补充：Projects/000');
	});

	it('should inject resolved intent targets into provider context', async () => {
		const manager = new MockMcpClientManager();
		const plugin = createPlugin(manager);
		plugin.app.vault.getAbstractFileByPath = (path: string) => {
			if (path === 'daily/2026-03-10.md') {
				return {
					path,
					name: '2026-03-10.md',
					basename: '2026-03-10',
					extension: 'md',
				};
			}
			return null;
		};
		const service = new ChatService(plugin);
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}

		const currentUserMessage = {
			id: 'user-target',
			role: 'user' as const,
			content: '帮我总结今天的日记',
			timestamp: Date.now(),
			metadata: {
				intentResult: {
					understanding: {
						normalizedRequest: '总结今天的日记',
						target: {
							type: 'specific_files',
							paths: ['daily/2026-03-10.md'],
						},
					},
					classification: {
						domain: 'reasoning',
						intentType: 'analyze_content',
						confidence: 0.9,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'tool_assisted',
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 4,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
					},
				},
			},
		};
		session.messages.push(currentUserMessage);

		const providerSpy = jest
			.spyOn(serviceInternal.messageService, 'toProviderMessages')
			.mockResolvedValue([]);

		await service.buildProviderMessagesForAgent(session.messages, session);

		expect(providerSpy).toHaveBeenCalled();
		const [, options] = providerSpy.mock.calls[0];
		expect(options?.selectedFiles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: 'daily/2026-03-10.md',
					type: 'file',
				}),
			])
		);
	});

	it('should clear pending clarification before entering confirmation flow', async () => {
		const manager = new MockMcpClientManager();
		const service = new ChatService(createPlugin(manager));
		service.initialize();
		const serviceInternal = service as any;
		const session = service.getActiveSession();
		if (!session) {
			throw new Error('active session missing');
		}
		session.pendingIntentClarification = {
			originalUserMessage: '旧的待澄清请求',
			normalizedRequest: '旧请求',
			reason: '待确认',
			questions: [],
			createdAt: Date.now(),
			triggerSource: 'chat_input',
			selectedFiles: [],
			selectedFolders: [],
		};
		jest.spyOn(serviceInternal, 'appendHostAssistantMessage').mockResolvedValue(undefined);

		const handled = await serviceInternal.handleIntentHostResponse({
			session,
			userMessage: {
				id: 'user-4',
				role: 'user',
				content: '删除这些文件',
				timestamp: Date.now(),
				metadata: {},
			},
			currentSelectedFiles: [],
			currentSelectedFolders: [],
			originalUserInput: '删除这些文件',
			intentRecognitionInput: '删除这些文件',
			isImageGenerationIntent: false,
			isModelSupportImageGeneration: false,
			triggerSource: 'chat_input',
			pendingClarificationContext: null,
			intentResult: {
				understanding: {
					normalizedRequest: '删除这些文件',
					target: {
						type: 'specific_files',
						paths: ['a.md', 'b.md'],
					},
				},
				classification: {
					domain: 'vault_write',
					intentType: 'batch_operation',
					confidence: 0.9,
					isCompound: false,
					complexity: 'moderate',
				},
				routing: {
					executionMode: 'tool_assisted',
					contextPrep: {
						needsActiveFileContent: false,
						needsSelectedText: false,
						needsMemoryLoad: false,
						needsPlanContext: false,
					},
					constraints: {
						readOnly: false,
						allowShell: false,
						allowScript: false,
						maxToolCalls: 4,
					},
					safetyFlags: {
						isDestructive: true,
						affectsMultipleFiles: true,
						requiresConfirmation: true,
					},
				},
			},
		});

		expect(handled).toBe(true);
		expect(session.pendingIntentClarification).toBeNull();
		expect(session.pendingIntentConfirmation?.normalizedRequest).toBe('删除这些文件');
	});
});
