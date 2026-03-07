import type { ChatMessage } from '../types/chat';

function isCompareAssistantMessage(message: ChatMessage): boolean {
	return message.role === 'assistant' && Boolean(message.parallelGroupId);
}

export function filterMessagesForCompareModel(
	messages: ChatMessage[],
	modelTag: string
): ChatMessage[] {
	return messages.filter((message) => {
		if (message.role !== 'assistant') {
			return true;
		}

		if (isCompareAssistantMessage(message)) {
			return message.modelTag === modelTag;
		}

		return !message.metadata?.hiddenFromModel;
	});
}

export function buildRetryContextMessages(
	messages: ChatMessage[],
	targetIndex: number
): ChatMessage[] {
	if (targetIndex <= 0) {
		return [];
	}

	const target = messages[targetIndex];
	if (!target) {
		return messages.slice(0, targetIndex);
	}

	if (!target.parallelGroupId) {
		return messages.slice(0, targetIndex);
	}

	let groupStartIndex = targetIndex;
	while (groupStartIndex > 0) {
		const previous = messages[groupStartIndex - 1];
		if (previous.role !== 'assistant' || previous.parallelGroupId !== target.parallelGroupId) {
			break;
		}
		groupStartIndex -= 1;
	}

	return messages.slice(0, groupStartIndex);
}
