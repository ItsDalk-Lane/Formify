declare module "ollama/browser" {
	type ThinkLevel = 'low' | 'medium' | 'high'

	type ChatParams = {
		model: string
		messages: unknown[]
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
