declare module "ollama/browser" {
	type ThinkLevel = 'low' | 'medium' | 'high'

	// Ollama 消息接口（支持图像）
	interface OllamaMessage {
		role: 'user' | 'assistant' | 'system'
		content: string
		images?: string[] // base64 字符串数组，不包含 data URL 前缀
	}

	type ChatParams = {
		model: string
		messages: OllamaMessage[]
		stream?: boolean
		think?: boolean | ThinkLevel
		[key: string]: unknown
	}

	type ChatResponsePart = {
		message: {
			content: string
			thinking?: string
		}
	}

	export class Ollama {
		constructor(options?: { host?: string })
		chat(params: ChatParams): AsyncIterable<ChatResponsePart>
		abort(): void
	}
}
