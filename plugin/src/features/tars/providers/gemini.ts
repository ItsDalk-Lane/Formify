import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { arrayBufferToBase64, getMimeTypeFromFilename } from './utils'
import { withOpenAIMcpToolCallSupport } from '../mcp/mcpToolCallHandler'

type GeminiContentItem = { text?: string; inlineData?: { mimeType?: string; data?: string } }
type GeminiContent = { role: 'user' | 'model'; parts: GeminiContentItem[] }

export const geminiNormalizeOpenAIBaseURL = (baseURL: string) => {
	const trimmed = (baseURL || '').trim().replace(/\/+$/, '')
	if (!trimmed) return 'https://generativelanguage.googleapis.com/v1beta/openai'
	if (trimmed.includes('/openai')) return trimmed
	if (trimmed.endsWith('/v1beta')) return `${trimmed}/openai`
	return `${trimmed}/v1beta/openai`
}

export const geminiBuildConfig = (parameters: Record<string, unknown>) => {
	const config: Record<string, unknown> = { ...parameters }
	if (typeof config.max_tokens === 'number') {
		config.maxOutputTokens = config.max_tokens
		delete config.max_tokens
	}
	return config
}

export const geminiIsAuthError = (error: unknown) => {
	const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? 0)
	if (status === 401 || status === 403) return true
	const message = String((error as any)?.message ?? '').toLowerCase()
	return (
		message.includes('api key') ||
		message.includes('unauthorized') ||
		message.includes('forbidden') ||
		message.includes('permission') ||
		message.includes('authentication')
	)
}

const toGeminiRole = (role: Message['role']): 'user' | 'model' => (role === 'assistant' ? 'model' : 'user')

const buildGeminiContents = async (messages: Message[], resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const systemParts: string[] = []
	const contents: GeminiContent[] = []

	for (const message of messages) {
		if (message.role === 'system') {
			if (message.content?.trim()) {
				systemParts.push(message.content)
			}
			continue
		}

		const parts: GeminiContentItem[] = []
		if (message.content?.trim()) {
			parts.push({ text: message.content })
		}

		if (message.embeds && message.embeds.length > 0) {
			for (const embed of message.embeds) {
				const mimeType = getMimeTypeFromFilename(embed.link)
				if (!mimeType.startsWith('image/')) continue
				const binary = await resolveEmbedAsBinary(embed)
				const base64 = arrayBufferToBase64(binary)
				parts.push({
					inlineData: {
						mimeType,
						data: base64
					}
				})
			}
		}

		if (parts.length === 0) {
			parts.push({ text: '' })
		}
		contents.push({
			role: toGeminiRole(message.role),
			parts
		})
	}

	return {
		systemInstruction: systemParts.join('\n\n').trim() || undefined,
		contents
	}
}
export const geminiBuildContents = buildGeminiContents

type OpenAIMessagePart =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| { type: 'text'; text: string }

const formatOpenAICompatibleMessage = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const content: OpenAIMessagePart[] = []

	if (msg.content?.trim()) {
		content.push({ type: 'text', text: msg.content })
	}

	if (msg.embeds && msg.embeds.length > 0) {
		for (const embed of msg.embeds) {
			const mimeType = getMimeTypeFromFilename(embed.link)
			if (!mimeType.startsWith('image/')) continue
			const binary = await resolveEmbedAsBinary(embed)
			content.push({
				type: 'image_url',
				image_url: {
					url: `data:${mimeType};base64,${arrayBufferToBase64(binary)}`
				}
			})
		}
	}

	if (content.length === 0) {
		content.push({ type: 'text', text: '' })
	}

	return {
		role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
		content
	}
}

const sendViaOpenAICompatible = async function* (
	apiKey: string,
	baseURL: string,
	model: string,
	remains: Record<string, unknown>,
	messages: Message[],
	controller: AbortController,
	resolveEmbedAsBinary: ResolveEmbedAsBinary
) {
	const client = new OpenAI({
		apiKey,
		baseURL: geminiNormalizeOpenAIBaseURL(baseURL),
		dangerouslyAllowBrowser: true
	})
	const formattedMessages = await Promise.all(messages.map((msg) => formatOpenAICompatibleMessage(msg, resolveEmbedAsBinary)))
	const stream = await client.chat.completions.create(
		{
			model,
			messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
			stream: true,
			...remains
		},
		{ signal: controller.signal }
	)
	for await (const part of stream) {
		const text = part.choices[0]?.delta?.content
		if (text) {
			yield text
		}
	}
}

const sendRequestFuncBase = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		try {
			const sdk = await import('@google/genai')
			const GoogleGenAI = (sdk as any).GoogleGenAI
			if (!GoogleGenAI) {
				throw new Error('GoogleGenAI export not found')
			}
			const ai = new GoogleGenAI({ apiKey })
			const { systemInstruction, contents } = await buildGeminiContents(messages, resolveEmbedAsBinary)
			const config = geminiBuildConfig(remains as Record<string, unknown>)
			if (systemInstruction) {
				config.systemInstruction = systemInstruction
			}

			const stream = await ai.models.generateContentStream({
				model,
				contents,
				config
			})

			for await (const chunk of stream) {
				if (controller.signal.aborted) {
					throw new DOMException('Operation was aborted', 'AbortError')
				}
				const chunkText =
					typeof (chunk as any).text === 'function' ? (chunk as any).text() : (chunk as any).text
				if (chunkText) {
					yield chunkText
				}
			}
			return
		} catch (error) {
			if (geminiIsAuthError(error)) {
				throw new Error('Gemini authentication failed. Please verify your API key and project permissions.')
			}
			console.warn('[Gemini] @google/genai path failed, falling back to OpenAI-compatible endpoint:', error)
		}

		try {
			for await (const text of sendViaOpenAICompatible(
				apiKey,
				baseURL,
				model,
				remains as Record<string, unknown>,
				messages,
				controller,
				resolveEmbedAsBinary
			)) {
				yield text
			}
		} catch (error) {
			if (geminiIsAuthError(error)) {
				throw new Error('Gemini authentication failed. Please verify your API key and project permissions.')
			}
			throw error
		}
	}

/** Gemini 的 OpenAI 兼容端点通过 geminiNormalizeOpenAIBaseURL 规范化，支持 MCP 工具调用 */
const sendRequestFunc = withOpenAIMcpToolCallSupport(
	sendRequestFuncBase,
	{ transformBaseURL: geminiNormalizeOpenAIBaseURL },
)

export const geminiVendor: Vendor = {
	name: 'Gemini',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://generativelanguage.googleapis.com',
		model: 'gemini-2.5-flash',
		parameters: {}
	},
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://makersuite.google.com/app/apikey',
	capabilities: ['Text Generation']
}

