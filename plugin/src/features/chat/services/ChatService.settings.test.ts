jest.mock(
	'obsidian',
	() => require('../../../testing/obsidianMock').createObsidianMock(),
	{ virtual: true }
);

(globalThis as typeof globalThis & {
	window?: { localStorage: { getItem: jest.Mock } };
}).window = {
	localStorage: {
		getItem: jest.fn(() => 'en'),
	},
};

jest.mock('../components/ChatSettingsModal', () => ({
	ChatSettingsModal: jest.fn().mockImplementation(function (
		_app: unknown,
		_service: unknown,
		onRequestClose?: () => void
	) {
		return {
			open: jest.fn(),
			close: jest.fn(() => {
				onRequestClose?.();
			}),
		};
	}),
}));

import {
	DEFAULT_CHAT_SETTINGS,
	DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
} from '../types/chat';
import { DEFAULT_MCP_SETTINGS } from 'src/features/tars/mcp';
import {
	DEFAULT_TOOL_EXECUTION_SETTINGS,
} from 'src/features/tars/settings';

const { Notice } = require('obsidian') as typeof import('obsidian');
const { ChatSettingsModal } = require('../components/ChatSettingsModal') as typeof import('../components/ChatSettingsModal');
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
		saveSettings: jest.fn(async () => undefined),
		settings: {
			aiDataFolder: 'System/formify',
			chat: {
				...DEFAULT_CHAT_SETTINGS,
				messageManagement: {
					...DEFAULT_MESSAGE_MANAGEMENT_SETTINGS,
				},
			},
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
					enableGlobalSystemPrompts: false,
					mcp: {
						...DEFAULT_MCP_SETTINGS,
					},
					toolExecution: {
						...DEFAULT_TOOL_EXECUTION_SETTINGS,
					},
					toolAgent: {
						modelTag: 'legacy-tool',
						enabled: true,
						defaultConstraints: {
							maxToolCalls: 3,
							timeoutMs: 4000,
							allowShell: true,
							allowScript: false,
						},
					},
					intentAgent: {
						modelTag: 'legacy-intent',
						enabled: true,
						timeoutMs: 3000,
					},
				},
			},
		},
		featureCoordinator: {
			getMcpClientManager: () => null,
		},
	}) as any;

describe('ChatService settings integration', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('opens the chat settings modal as a single instance and clears it on close', () => {
		const plugin = createPlugin();
		const service = new ChatService(plugin);

		service.openChatSettingsModal();
		service.openChatSettingsModal();

		expect(ChatSettingsModal).toHaveBeenCalledTimes(1);

		const modalInstance = (ChatSettingsModal as jest.Mock).mock.results[0]?.value;
		expect(modalInstance?.open).toHaveBeenCalledTimes(1);

		service.closeChatSettingsModal();
		expect(modalInstance?.close).toHaveBeenCalledTimes(1);

		service.openChatSettingsModal();
		expect(ChatSettingsModal).toHaveBeenCalledTimes(2);
	});

	it('persists chat settings successfully', async () => {
		const plugin = createPlugin();
		const service = new ChatService(plugin);

		await service.persistChatSettings({ autosaveChat: false, chatModalWidth: 900 });

		expect(plugin.settings.chat.autosaveChat).toBe(false);
		expect(plugin.settings.chat.chatModalWidth).toBe(900);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(service.getChatSettingsSnapshot().autosaveChat).toBe(false);
	});

	it('persists nested message management settings with defaults', async () => {
		const plugin = createPlugin();
		const service = new ChatService(plugin);

		await service.persistChatSettings({
			messageManagement: {
				enabled: false,
				recentTurns: 4,
				summaryModelTag: 'summary-model',
			},
		});

		expect(plugin.settings.chat.messageManagement).toEqual({
			enabled: false,
			recentTurns: 4,
			summaryModelTag: 'summary-model',
		});
		expect(service.getChatSettingsSnapshot().messageManagement).toEqual({
			enabled: false,
			recentTurns: 4,
			summaryModelTag: 'summary-model',
		});
	});

	it('drops legacy token budget fields when persisting message management settings', async () => {
		const plugin = createPlugin();
		plugin.settings.chat.messageManagement = {
			enabled: true,
			recentTurns: 2,
			contextBudgetTokens: 9000,
			historyBudgetTokens: 8000,
		};
		const service = new ChatService(plugin);

		await service.persistChatSettings({
			messageManagement: {
				enabled: true,
				recentTurns: 3,
			},
		});

		expect(plugin.settings.chat.messageManagement).toEqual({
			enabled: true,
			recentTurns: 3,
			summaryModelTag: undefined,
		});
	});

	it('rolls back chat settings when save fails and surfaces a notice', async () => {
		const plugin = createPlugin();
		plugin.saveSettings.mockRejectedValueOnce(new Error('boom'));
		const service = new ChatService(plugin);

		await expect(
			service.persistChatSettings({ autosaveChat: false })
		).rejects.toThrow('boom');

		expect(plugin.settings.chat.autosaveChat).toBe(true);
		expect(Notice).toHaveBeenCalled();
		expect(service.getChatSettingsSnapshot().autosaveChat).toBe(true);
	});

	it('cleans legacy sub-agent fields when persisting MCP settings', async () => {
		const plugin = createPlugin();
		plugin.settings.tars.settings.toolExecution = {
			maxToolCalls: 22,
			timeoutMs: 61000,
		};
		const service = new ChatService(plugin);

		await service.persistMcpSettings({
			...plugin.settings.tars.settings.mcp,
			maxToolCallLoops: 5,
		});

		expect(plugin.settings.tars.settings.toolExecution).toEqual({
			maxToolCalls: 22,
			timeoutMs: 61000,
		});
		expect(plugin.settings.tars.settings.mcp.maxToolCallLoops).toBe(22);
		expect('toolAgent' in plugin.settings.tars.settings).toBe(false);
		expect('intentAgent' in plugin.settings.tars.settings).toBe(false);
	});

	it('persists builtin time default timezone inside MCP settings', async () => {
		const plugin = createPlugin();
		const service = new ChatService(plugin);

		await service.persistMcpSettings({
			...plugin.settings.tars.settings.mcp,
			builtinTimeDefaultTimezone: 'America/New_York',
		});

		expect(plugin.settings.tars.settings.mcp.builtinTimeDefaultTimezone).toBe(
			'America/New_York'
		);
	});
});
