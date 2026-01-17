declare module "ollama/browser" {
	type ThinkLevel = 'low' | 'medium' | 'high'

	// JSON Schema 类型定义（用于 Structured Outputs）
	type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'

	interface JSONSchemaProperty {
		type?: JSONSchemaType | JSONSchemaType[]
		description?: string
		items?: JSONSchema
		properties?: Record<string, JSONSchema>
		required?: string[]
		enum?: (string | number | boolean | null)[]
		[key: string]: unknown
	}

	interface JSONSchema {
		type?: JSONSchemaType | JSONSchemaType[]
		properties?: Record<string, JSONSchemaProperty>
		required?: string[]
		items?: JSONSchemaProperty
		description?: string
		[key: string]: unknown
	}

	// Structured Output Format 类型
	type StructuredOutputFormat = 'json' | JSONSchema

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
		format?: StructuredOutputFormat // 支持结构化输出
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
