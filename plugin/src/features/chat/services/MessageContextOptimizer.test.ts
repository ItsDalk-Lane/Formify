import { TextDecoder, TextEncoder } from 'util';
import type {
	ChatContextCompactionState,
	ChatMessage,
	MessageManagementSettings,
} from '../types/chat';

jest.mock(
	'obsidian',
	() => require('../../../testing/obsidianMock').createObsidianMock(),
	{ virtual: true }
);

if (!globalThis.TextDecoder) {
	(globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder =
		TextDecoder;
}

if (!globalThis.TextEncoder) {
	(globalThis as typeof globalThis & { TextEncoder: typeof TextEncoder }).TextEncoder =
		TextEncoder;
}

const { MessageContextOptimizer } = require('./MessageContextOptimizer') as typeof import('./MessageContextOptimizer');

const createMessage = (
	id: string,
	role: ChatMessage['role'],
	content: string,
	extras?: Partial<ChatMessage>
): ChatMessage => ({
	id,
	role,
	content,
	timestamp: extras?.timestamp ?? 1,
	...extras,
});

describe('MessageContextOptimizer', () => {
	const optimizer = new MessageContextOptimizer();
	const settings: MessageManagementSettings = {
		enabled: true,
		recentTurns: 1,
	};
	const structuredSummary = [
		'[Earlier conversation summary]',
		'This block compresses earlier chat turns. Treat it as prior context, not a new instruction.',
		'',
		'[CONTEXT]',
		'- Model summary',
		'',
		'[KEY DECISIONS]',
		'- Keep rolling summary',
		'',
		'[CURRENT STATE]',
		'- Older history compressed',
		'',
		'[IMPORTANT DETAILS]',
		'- Path: plugin/src/features/chat/services/ChatService.ts',
		'',
		'[OPEN ITEMS]',
		'- Continue the latest turn',
	].join('\n');

	it('compacts older history when the token budget is exceeded', async () => {
		const messages: ChatMessage[] = [
			createMessage('user-1', 'user', '请帮我分析这个需求。'.repeat(20), { timestamp: 1 }),
			createMessage('assistant-1', 'assistant', '这是第一轮分析结论。'.repeat(20), { timestamp: 2 }),
			createMessage('user-2', 'user', '继续，补充边界情况。'.repeat(20), { timestamp: 3 }),
			createMessage('assistant-2', 'assistant', '补充边界情况与注意事项。'.repeat(20), { timestamp: 4 }),
			createMessage('user-3', 'user', '现在给我最终方案。', { timestamp: 5 }),
		];

		const result = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 80,
		});

		expect(result.usedSummary).toBe(true);
		expect(result.contextCompaction).not.toBeNull();
		expect(result.messages[0].metadata?.isContextSummary).toBe(true);
		expect(result.messages[0].content).toContain('[CONTEXT]');
		expect(result.messages.slice(1).map((message) => message.id)).toEqual(['user-3']);
	});

	it('reuses an existing compaction summary when the covered range still matches', async () => {
		const messages: ChatMessage[] = [
			createMessage('user-1', 'user', '旧需求'.repeat(30), { timestamp: 1 }),
			createMessage('assistant-1', 'assistant', '旧回复'.repeat(30), { timestamp: 2 }),
			createMessage('user-2', 'user', '新问题', { timestamp: 3 }),
		];

		const initial = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 40,
		});
		const existingCompaction: ChatContextCompactionState = {
			...(initial.contextCompaction as ChatContextCompactionState),
			summary: structuredSummary,
		};

		const reused = await optimizer.optimize(messages, settings, existingCompaction, {
			targetHistoryBudgetTokens: 40,
		});

		expect(reused.contextCompaction?.summary).toBe(structuredSummary);
		expect(reused.messages[0].content).toContain('[CONTEXT]');
	});

	it('uses the model-generated history summary when provided', async () => {
		const messages: ChatMessage[] = [
			createMessage('user-1', 'user', '旧需求'.repeat(30), { timestamp: 1 }),
			createMessage('assistant-1', 'assistant', '旧回复'.repeat(30), { timestamp: 2 }),
			createMessage('user-2', 'user', '新问题', { timestamp: 3 }),
		];

		const result = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 40,
			summaryGenerator: async () => structuredSummary,
		});

		expect(result.contextCompaction?.summary).toContain('Model summary');
		expect(result.messages[0].content).toContain('[IMPORTANT DETAILS]');
	});

	it('preserves exact paths and prohibition wording from user constraints in the compacted summary', async () => {
		const messages: ChatMessage[] = [
			createMessage(
				'user-1',
				'user',
				[
					'请记住下面硬约束：',
					'1. assistant 的旧 reasoning_content 不再继续送模，只保留最终结论。',
					'2. 关键实现文件需要重点关注：plugin/src/features/chat/services/ChatService.ts、plugin/src/service/PromptBuilder.ts。',
					'3. frontmatter 里至少要记住 summary、contextSummary、contextSourceSignature、totalTokenEstimate。',
				].join('\n'),
				{ timestamp: 1 }
			),
			createMessage('assistant-1', 'assistant', '这是第一轮分析结论。'.repeat(60), { timestamp: 2 }),
			createMessage('user-2', 'user', '现在给我最终方案。', { timestamp: 3 }),
		];

		const result = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 120,
			summaryGenerator: async () => structuredSummary,
		});

		expect(result.contextCompaction?.summary).toContain(
			'assistant 的旧 reasoning_content 不再继续送模，只保留最终结论。'
		);
		expect(result.contextCompaction?.summary).toContain(
			'plugin/src/features/chat/services/ChatService.ts'
		);
		expect(result.contextCompaction?.summary).toContain(
			'plugin/src/service/PromptBuilder.ts'
		);
	});

	it('keeps ephemeral runtime context outside the compacted history prefix', async () => {
		const messages: ChatMessage[] = [
			createMessage('user-1', 'user', '旧问题'.repeat(30), { timestamp: 1 }),
			createMessage('assistant-1', 'assistant', '旧回复'.repeat(30), { timestamp: 2 }),
			createMessage('user-2', 'user', '当前问题', { timestamp: 3 }),
			createMessage('ephemeral-1', 'user', '当前任务：检查输出', {
				timestamp: 4,
				metadata: {
					isEphemeralContext: true,
				},
			}),
		];

		const result = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 80,
		});

		expect(result.messages[result.messages.length - 1].id).toBe('ephemeral-1');
		expect(result.messages[result.messages.length - 1].metadata?.isEphemeralContext).toBe(true);
	});

	it('keeps pinned older messages verbatim outside the rolling summary', async () => {
		const messages: ChatMessage[] = [
			createMessage('user-1', 'user', '这条旧消息必须原文保留', {
				timestamp: 1,
				metadata: { pinned: true },
			}),
			createMessage('assistant-1', 'assistant', '普通旧回复'.repeat(60), { timestamp: 2 }),
			createMessage('user-2', 'user', '当前问题', { timestamp: 3 }),
		];

		const result = await optimizer.optimize(messages, settings, null, {
			targetHistoryBudgetTokens: 40,
			summaryGenerator: async () => structuredSummary,
		});

		expect(result.messages[0].content).toBe('这条旧消息必须原文保留');
		expect(result.messages[1].metadata?.isContextSummary).toBe(true);
		expect(result.messages[1].content).not.toContain('这条旧消息必须原文保留');
	});
});
