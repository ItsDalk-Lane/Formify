import { EmbedCache } from 'obsidian'

export type MsgRole = 'user' | 'assistant' | 'system'

export interface SaveAttachment {
	(fileName: string, data: ArrayBuffer): Promise<void>
}

export interface ResolveEmbedAsBinary {
	(embed: EmbedCache): Promise<ArrayBuffer>
}

export interface CreatePlainText {
	(filePath: string, text: string): Promise<void>
}

export interface Message {
	readonly role: MsgRole
	readonly content: string
	readonly embeds?: EmbedCache[]
	readonly prefix?: boolean
	/** DeepSeek 推理模式下的推理内容（仅用于 assistant 消息） */
	readonly reasoning_content?: string
}

export type SendRequest = (
	messages: readonly Message[],
	controller: AbortController,
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
	saveAttachment?: SaveAttachment
) => AsyncGenerator<string, void, unknown>

export type Capability =
	| 'Text Generation'
	| 'Image Vision'
	| 'PDF Vision'
	| 'Image Generation'
	| 'Image Editing'
	| 'Web Search'
	| 'Reasoning'
	| 'Structured Output'

export interface Vendor {
	readonly name: string
	readonly defaultOptions: BaseOptions
	readonly sendRequestFunc: (options: BaseOptions) => SendRequest
	readonly models: string[]
	readonly websiteToObtainKey: string
	readonly capabilities: Capability[]
}

export interface BaseOptions {
	apiKey: string
	baseURL: string
	model: string
	parameters: Record<string, unknown>
	enableWebSearch?: boolean
	/** MCP 工具定义列表（可选，由 McpClientManager 注入） */
	mcpTools?: McpToolDefinitionForProvider[]
	/** MCP 工具调用回调（可选，由 McpClientManager 注入） */
	mcpCallTool?: McpCallToolFnForProvider
	/** MCP 工具调用循环最大次数（可选，默认 10） */
	mcpMaxToolCallLoops?: number
}

/** MCP 工具定义（Provider 使用的精简格式） */
export interface McpToolDefinitionForProvider {
	readonly name: string
	readonly description: string
	readonly inputSchema: Record<string, unknown>
	readonly serverId: string
}

/** MCP 工具调用函数（Provider 使用） */
export type McpCallToolFnForProvider = (
	serverId: string,
	toolName: string,
	args: Record<string, unknown>,
) => Promise<string>

export interface ProviderSettings {
	tag: string
	readonly vendor: string
	options: BaseOptions
}

export interface Optional {
	apiSecret: string
	endpoint: string
	apiVersion: string
}
