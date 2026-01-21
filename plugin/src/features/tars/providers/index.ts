import { EmbedCache } from 'obsidian'

export type MsgRole = 'user' | 'assistant' | 'system' | 'tool'

export interface SaveAttachment {
	(fileName: string, data: ArrayBuffer): Promise<void>
}

export interface ResolveEmbedAsBinary {
	(embed: EmbedCache): Promise<ArrayBuffer>
}

export interface CreatePlainText {
	(filePath: string, text: string): Promise<void>
}

/**
 * DeepSeek 工具调用格式（兼容 OpenAI）
 */
export interface MessageToolCall {
	readonly id: string
	readonly type: 'function'
	readonly function: {
		readonly name: string
		readonly arguments: string
	}
}

export interface Message {
	readonly role: MsgRole
	readonly content: string
	readonly embeds?: EmbedCache[]
	readonly prefix?: boolean
	/** DeepSeek 推理模式下的推理内容（仅用于 assistant 消息） */
	readonly reasoning_content?: string
	/** DeepSeek 推理模式下的工具调用（仅用于 assistant 消息） */
	readonly tool_calls?: MessageToolCall[]
	/** 工具调用 ID（仅用于 tool 角色消息） */
	readonly tool_call_id?: string
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
	| 'Tool Calling'
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
}

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
