import { Message } from '.'

type MessagePayload = {
	role: string
	content: unknown
	reasoning_content?: string
}

export const withToolMessageContext = (msg: Message, payload: MessagePayload): MessagePayload => {
	if (msg.role === 'assistant') {
		if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
			payload.reasoning_content = msg.reasoning_content
		}
	}

	return payload
}
