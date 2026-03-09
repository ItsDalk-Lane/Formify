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

	interface ToolCall {
		function: {
			name: string
			arguments: Record<string, unknown>
		}
	}

	interface Tool {
		type: 'function'
		function: {
			name?: string
			description?: string
			type?: string
			parameters?: JSONSchema
		}
	}

	// Ollama 消息接口（支持图像与原生工具调用）
	interface OllamaMessage {
		role: 'user' | 'assistant' | 'system' | 'tool'
		content: string
		images?: string[] // base64 字符串数组，不包含 data URL 前缀
		tool_calls?: ToolCall[]
		tool_name?: string
	}

	type ChatParams = {
		model: string
		messages: OllamaMessage[]
		stream?: boolean
		think?: boolean | ThinkLevel
		format?: StructuredOutputFormat // 支持结构化输出
		tools?: Tool[]
		[key: string]: unknown
	}

	type ChatResponse = {
		message: {
			content: string
			thinking?: string
			tool_calls?: ToolCall[]
		}
	}

	export class Ollama {
		constructor(options?: { host?: string })
		chat(params: ChatParams & { stream: true }): Promise<AsyncIterable<ChatResponse>>
		chat(params: ChatParams & { stream?: false }): Promise<ChatResponse>
		abort(): void
	}
}
