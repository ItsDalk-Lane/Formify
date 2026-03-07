import type { ChatMessage } from '../types/chat';

function getTaskUserInput(message: ChatMessage): string | null {
	const value = message.metadata?.taskUserInput;
	return typeof value === 'string' ? value : null;
}

export function getEditableUserMessageContent(message: ChatMessage): string {
	return getTaskUserInput(message) ?? message.content;
}

export function buildEditedUserMessage(
	message: ChatMessage,
	nextInput: string
): Pick<ChatMessage, 'content' | 'metadata'> {
	const trimmedInput = nextInput.trim();
	const previousTaskUserInput = getTaskUserInput(message);
	const metadata = {
		...(message.metadata ?? {}),
		taskUserInput: trimmedInput
	};

	if (!previousTaskUserInput) {
		return {
			content: trimmedInput,
			metadata
		};
	}

	const markerIndex = message.content.indexOf(previousTaskUserInput);
	if (markerIndex === -1) {
		return {
			content: trimmedInput,
			metadata
		};
	}

	return {
		content: `${message.content.slice(0, markerIndex)}${trimmedInput}${message.content.slice(markerIndex + previousTaskUserInput.length)}`.trim(),
		metadata
	};
}
