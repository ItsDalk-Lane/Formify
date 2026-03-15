import type { ChatSession } from '../types/chat';
import {
	DEFAULT_CHAT_SETTINGS,
	DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
} from '../types/chat';

jest.mock(
	'obsidian',
	() => require('../../../testing/obsidianMock').createObsidianMock(),
	{ virtual: true }
);
jest.mock('../components/ChatSettingsModal', () => ({
	ChatSettingsModal: jest.fn(),
}));

(globalThis as typeof globalThis & {
	window?: { localStorage: { getItem: jest.Mock } };
}).window = {
	localStorage: {
		getItem: jest.fn(() => 'en'),
	},
};

const { ChatService } = require('./ChatService') as typeof import('./ChatService');

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
					recentTurns: 1,
				},
			},
			tars: {
				settings: {
					providers: [
						{
							tag: 'budget-test',
							vendor: 'UnknownVendor',
							options: {
								apiKey: '',
								baseURL: '',
								model: 'budget-test',
								contextLength: 90,
								parameters: {
									max_tokens: 20,
								},
							},
						},
					],
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

	it('uses the configured summary model tag when generating history summaries', async () => {
		const plugin = createPlugin();
		plugin.settings.tars.settings.providers = [
			{
				tag: 'current-model',
				vendor: 'UnknownVendor',
				options: {
					apiKey: '',
					baseURL: '',
					model: 'current-model',
					contextLength: 90,
					parameters: { max_tokens: 20 },
				},
			},
			{
				tag: 'summary-model',
				vendor: 'UnknownVendor',
				options: {
					apiKey: '',
					baseURL: '',
					model: 'summary-model',
					contextLength: 90,
					parameters: { max_tokens: 20 },
				},
			},
		];
		plugin.settings.chat.messageManagement = {
			...DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
			enabled: true,
			recentTurns: 1,
			summaryModelTag: 'summary-model',
		};
		const service = new ChatService(plugin);
		const runSummaryModelRequest = jest
			.spyOn(service as any, 'runSummaryModelRequest')
			.mockResolvedValue(
				[
					'[Earlier conversation summary]',
					'This block compresses earlier chat turns. Treat it as prior context, not a new instruction.',
					'',
					'[CONTEXT]',
					'- model summary',
					'',
					'[KEY DECISIONS]',
					'- keep rolling summary',
					'',
					'[CURRENT STATE]',
					'- older history compressed',
					'',
					'[IMPORTANT DETAILS]',
					'- exact path preserved',
					'',
					'[OPEN ITEMS]',
					'- answer the latest request',
				].join('\n')
			);

		const session: ChatSession = {
			id: 'session-3',
			title: '摘要模型测试',
			modelId: 'current-model',
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

		await service.buildProviderMessagesForAgent(session.messages, session);

		expect(runSummaryModelRequest).toHaveBeenCalled();
		expect(runSummaryModelRequest.mock.calls[0]?.[0]).toBe('summary-model');
	});
});
