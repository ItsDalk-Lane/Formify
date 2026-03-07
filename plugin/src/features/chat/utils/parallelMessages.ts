import type { ChatMessage } from '../types/chat';
import type { ParallelResponseGroup } from '../types/multiModel';

function buildParallelResponseMessages(group: ParallelResponseGroup): ChatMessage[] {
	const baseTimestamp = Date.now();

	return group.responses.map((response, index) => ({
		id: response.messageId ?? `parallel-response-${group.groupId}-${response.modelTag}`,
		role: 'assistant',
		content: response.content,
		timestamp: baseTimestamp + index,
		isError: response.isError,
		modelTag: response.modelTag,
		modelName: response.modelName,
		parallelGroupId: group.groupId,
		metadata: {
			transient: true
		}
	}));
}

export function isTransientParallelMessage(message: ChatMessage): boolean {
	return message.metadata?.transient === true;
}

export function mergeMessagesWithParallelResponses(
	messages: ChatMessage[],
	parallelResponses?: ParallelResponseGroup
): ChatMessage[] {
	if (!parallelResponses) {
		return messages;
	}

	const alreadyRendered = messages.some(
		(message) =>
			message.role === 'assistant' &&
			message.parallelGroupId === parallelResponses.groupId
	);
	if (alreadyRendered) {
		return messages;
	}

	const parallelMessages = buildParallelResponseMessages(parallelResponses);
	if (parallelMessages.length === 0) {
		return messages;
	}

	const targetIndex = messages.findIndex(
		(message) => message.id === parallelResponses.userMessageId
	);
	if (targetIndex === -1) {
		return [...messages, ...parallelMessages];
	}

	const nextMessages = [...messages];
	nextMessages.splice(targetIndex + 1, 0, ...parallelMessages);
	return nextMessages;
}
