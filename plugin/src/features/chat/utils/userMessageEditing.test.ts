import type { ChatMessage } from '../types/chat';
import {
	buildEditedUserMessage,
	getEditableUserMessageContent,
} from './userMessageEditing';

describe('userMessageEditing', () => {
	it('should prefer taskUserInput as editable draft content', () => {
		const message: ChatMessage = {
			id: 'user-1',
			role: 'user',
			content: '旧问题\n\n[[模板A]]',
			timestamp: 1,
			metadata: {
				taskUserInput: '旧问题',
				taskTemplate: '模板内容'
			}
		};

		expect(getEditableUserMessageContent(message)).toBe('旧问题');
	});

	it('should update taskUserInput and preserve serialized suffix content', () => {
		const message: ChatMessage = {
			id: 'user-1',
			role: 'user',
			content: '旧问题\n\n[[模板A]]',
			timestamp: 1,
			metadata: {
				taskUserInput: '旧问题',
				taskTemplate: '模板内容'
			}
		};

		const edited = buildEditedUserMessage(message, '新问题');

		expect(edited.content).toBe('新问题\n\n[[模板A]]');
		expect(edited.metadata?.taskUserInput).toBe('新问题');
		expect(edited.metadata?.taskTemplate).toBe('模板内容');
	});

	it('should fall back to raw content when message has no task metadata', () => {
		const message: ChatMessage = {
			id: 'user-1',
			role: 'user',
			content: '直接输入的问题',
			timestamp: 1,
		};

		const edited = buildEditedUserMessage(message, '修改后问题');

		expect(getEditableUserMessageContent(message)).toBe('直接输入的问题');
		expect(edited.content).toBe('修改后问题');
		expect(edited.metadata?.taskUserInput).toBe('修改后问题');
	});
});
