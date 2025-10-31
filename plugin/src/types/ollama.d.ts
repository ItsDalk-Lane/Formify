declare module "ollama/browser" {
	type ChatParams = {
		model: string
		messages: unknown[]
		stream?: boolean
		[key: string]: unknown
	}

	export class Ollama {
		constructor(options?: { host?: string })
		chat(params: ChatParams): AsyncIterable<{ message: { content: string } }>
		abort(): void
	}
}
