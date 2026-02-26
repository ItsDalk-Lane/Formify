import { Message } from '.'

type MessagePayload = {
	role: string
	content: unknown
	reasoning_content?: string
	tool_calls?: unknown
	tool_call_id?: string
}

export const withToolMessageContext = (msg: Message, payload: MessagePayload): MessagePayload => {
	const raw = msg as Message & {
		tool_calls?: unknown
		tool_call_id?: unknown
	}

	if (msg.role === 'assistant') {
		if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
			payload.reasoning_content = msg.reasoning_content
		}
		if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
			payload.tool_calls = raw.tool_calls
		}
	}

	if (msg.role === 'tool') {
		const toolCallId = typeof raw.tool_call_id === 'string' ? raw.tool_call_id.trim() : ''
		if (toolCallId) {
			payload.tool_call_id = toolCallId
		}
	}

	return payload
}
