import { Message } from '.'

type MessagePayload = {
	role: string
	content: unknown
	tool_calls?: unknown
	reasoning_content?: string
	tool_call_id?: string
}

export const withToolMessageContext = (msg: Message, payload: MessagePayload): MessagePayload => {
	if (msg.role === 'assistant') {
		if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
			payload.tool_calls = msg.tool_calls
		}
		if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
			payload.reasoning_content = msg.reasoning_content
		}
	}

	if (msg.role === 'tool' && typeof msg.tool_call_id === 'string' && msg.tool_call_id.trim()) {
		payload.tool_call_id = msg.tool_call_id
	}

	return payload
}
