import type { ChatMessage } from '../types/chat';
import {
	buildRetryContextMessages,
	filterMessagesForCompareModel,
} from './compareContext';

describe('compareContext', () => {
	it('should keep user messages and only the matching model assistant history', () => {
		const messages: ChatMessage[] = [
			{
				id: 'user-1',
				role: 'user',
				content: '问题 1',
				timestamp: 1,
			},
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '模型 A 回复',
				timestamp: 2,
				modelTag: 'model-a',
				parallelGroupId: 'compare-1',
				metadata: {
					hiddenFromModel: true,
				},
			},
			{
				id: 'assistant-b',
				role: 'assistant',
				content: '模型 B 回复',
				timestamp: 3,
				modelTag: 'model-b',
				parallelGroupId: 'compare-1',
				metadata: {
					hiddenFromModel: true,
				},
			},
			{
				id: 'user-2',
				role: 'user',
				content: '问题 2',
				timestamp: 4,
			},
		];

		const filtered = filterMessagesForCompareModel(messages, 'model-a');

		expect(filtered.map((message) => message.id)).toEqual([
			'user-1',
			'assistant-a',
			'user-2',
		]);
	});

	it('should still isolate compare assistants after history reload without hiddenFromModel metadata', () => {
		const messages: ChatMessage[] = [
			{
				id: 'user-1',
				role: 'user',
				content: '问题 1',
				timestamp: 1,
			},
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '模型 A 回复',
				timestamp: 2,
				modelTag: 'model-a',
				parallelGroupId: 'compare-1',
			},
			{
				id: 'assistant-b',
				role: 'assistant',
				content: '模型 B 回复',
				timestamp: 3,
				modelTag: 'model-b',
				parallelGroupId: 'compare-1',
			},
			{
				id: 'single-answer',
				role: 'assistant',
				content: '单模型阶段回复',
				timestamp: 4,
				modelTag: 'single-model',
			},
			{
				id: 'user-2',
				role: 'user',
				content: '问题 2',
				timestamp: 5,
			},
		];

		const filtered = filterMessagesForCompareModel(messages, 'model-a');

		expect(filtered.map((message) => message.id)).toEqual([
			'user-1',
			'assistant-a',
			'single-answer',
			'user-2',
		]);
	});

	it('should trim retry context to the user turn before the compare group', () => {
		const messages: ChatMessage[] = [
			{
				id: 'user-1',
				role: 'user',
				content: '问题 1',
				timestamp: 1,
			},
			{
				id: 'assistant-a',
				role: 'assistant',
				content: '模型 A 回复',
				timestamp: 2,
				modelTag: 'model-a',
				parallelGroupId: 'compare-1',
			},
			{
				id: 'assistant-b',
				role: 'assistant',
				content: '模型 B 回复',
				timestamp: 3,
				modelTag: 'model-b',
				parallelGroupId: 'compare-1',
			},
			{
				id: 'user-2',
				role: 'user',
				content: '问题 2',
				timestamp: 4,
			},
		];

		const trimmed = buildRetryContextMessages(messages, 2);

		expect(trimmed.map((message) => message.id)).toEqual(['user-1']);
	});
});
