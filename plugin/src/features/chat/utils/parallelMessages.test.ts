import type { ChatMessage } from '../types/chat';
import type { ParallelResponseGroup } from '../types/multiModel';
import {
	isTransientParallelMessage,
	mergeMessagesWithParallelResponses,
} from './parallelMessages';

describe('parallelMessages', () => {
	it('should insert active parallel responses after the matching user message', () => {
		const messages: ChatMessage[] = [
			{
				id: 'user-1',
				role: 'user',
				content: 'hello',
				timestamp: 1,
			},
			{
				id: 'user-2',
				role: 'user',
				content: 'compare this',
				timestamp: 2,
			},
		];
		const parallelResponses: ParallelResponseGroup = {
			groupId: 'compare-1',
			userMessageId: 'user-2',
			responses: [
				{
					modelTag: 'openai/gpt-4.1',
					modelName: 'GPT-4.1',
					content: 'streaming a',
					isComplete: false,
					isError: false,
				},
				{
					modelTag: 'anthropic/claude',
					modelName: 'Claude',
					content: 'streaming b',
					isComplete: false,
					isError: false,
				},
			],
		};

		const merged = mergeMessagesWithParallelResponses(messages, parallelResponses);

		expect(merged).toHaveLength(4);
		expect(merged[2]).toMatchObject({
			role: 'assistant',
			content: 'streaming a',
			modelTag: 'openai/gpt-4.1',
			parallelGroupId: 'compare-1',
		});
		expect(merged[3]).toMatchObject({
			role: 'assistant',
			content: 'streaming b',
			modelTag: 'anthropic/claude',
			parallelGroupId: 'compare-1',
		});
		expect(isTransientParallelMessage(merged[2]!)).toBe(true);
		expect(isTransientParallelMessage(merged[3]!)).toBe(true);
	});

	it('should not duplicate a compare group that already exists in session messages', () => {
		const messages: ChatMessage[] = [
			{
				id: 'user-1',
				role: 'user',
				content: 'compare this',
				timestamp: 1,
			},
			{
				id: 'assistant-1',
				role: 'assistant',
				content: 'final answer',
				timestamp: 2,
				modelTag: 'openai/gpt-4.1',
				modelName: 'GPT-4.1',
				parallelGroupId: 'compare-1',
			},
		];
		const parallelResponses: ParallelResponseGroup = {
			groupId: 'compare-1',
			userMessageId: 'user-1',
			responses: [
				{
					modelTag: 'openai/gpt-4.1',
					modelName: 'GPT-4.1',
					content: 'streaming answer',
					isComplete: true,
					isError: false,
					messageId: 'assistant-1',
				},
			],
		};

		const merged = mergeMessagesWithParallelResponses(messages, parallelResponses);

		expect(merged).toBe(messages);
	});
});
