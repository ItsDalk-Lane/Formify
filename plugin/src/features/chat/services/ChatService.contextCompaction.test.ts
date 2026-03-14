import { ChatService } from './ChatService';
import type { ChatSession } from '../types/chat';
import {
	DEFAULT_CHAT_SETTINGS,
	DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
} from '../types/chat';

const createPlugin = () =>
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
			chat: {
				...DEFAULT_CHAT_SETTINGS,
				messageManagement: {
					...DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
					enabled: true,
					contextBudgetTokens: 80,
					recentTurns: 1,
				},
			},
			tars: {
				settings: {
					providers: [],
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
			getMcpClientManager: () => null,
		},
	}) as any;

describe('ChatService context compaction', () => {
	it('injects a compaction summary into provider messages when history exceeds the budget', async () => {
		const service = new ChatService(createPlugin());
		const session: ChatSession = {
			id: 'session-1',
			title: '压缩测试',
			modelId: '',
			messages: [
				{
					id: 'user-1',
					role: 'user',
					content: '第一轮需求说明'.repeat(20),
					timestamp: 1,
				},
				{
					id: 'assistant-1',
					role: 'assistant',
					content: '第一轮分析回复'.repeat(20),
					timestamp: 2,
				},
				{
					id: 'user-2',
					role: 'user',
					content: '请继续给出最终方案',
					timestamp: 3,
				},
			],
			createdAt: 1,
			updatedAt: 1,
			contextNotes: [],
			selectedImages: [],
			selectedFiles: [],
			selectedFolders: [],
			enableTemplateAsSystemPrompt: false,
			contextCompaction: null,
		};

		const providerMessages = await service.buildProviderMessagesForAgent(
			session.messages,
			session
		);

		expect(providerMessages[0]).toMatchObject({
			role: 'assistant',
		});
		expect(providerMessages[0].content).toContain('[Earlier conversation summary]');
		expect(providerMessages[1]).toMatchObject({
			role: 'user',
			content: '请继续给出最终方案',
		});
		expect(session.contextCompaction).not.toBeNull();
	});

	it('summarizes attached context when the shared budget is exceeded', async () => {
		const service = new ChatService(createPlugin());
		const session: ChatSession = {
			id: 'session-2',
			title: '上下文压缩测试',
			modelId: '',
			messages: [
				{
					id: 'user-1',
					role: 'user',
					content: '基于上下文给我结论',
					timestamp: 1,
				},
			],
			createdAt: 1,
			updatedAt: 1,
			contextNotes: ['背景说明'.repeat(80)],
			selectedImages: [],
			selectedFiles: [],
			selectedFolders: [],
			enableTemplateAsSystemPrompt: false,
			contextCompaction: null,
		};

		const providerMessages = await service.buildProviderMessagesForAgent(
			session.messages,
			session
		);

		expect(providerMessages[0].role).toBe('user');
		expect(providerMessages[0].content).toContain('[Attached context summary]');
		expect(providerMessages[1]).toMatchObject({
			role: 'user',
			content: '基于上下文给我结论',
		});
		expect(session.contextCompaction?.contextSummary).toContain(
			'[Attached context summary]'
		);
	});
});
