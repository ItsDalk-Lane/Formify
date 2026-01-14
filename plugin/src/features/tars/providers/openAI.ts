import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildToolCallsBlock, convertEmbedToImageUrl } from './utils'

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		const client = new OpenAI({
			apiKey,
			baseURL,
			dangerouslyAllowBrowser: true
		})

		const stream = await client.chat.completions.create(
			{
				model,
				messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
				stream: true,
				...remains
			},
			{ signal: controller.signal }
		)

		const toolCalls: Array<{ id: string; name: string; argumentsText: string }> = []
		const ensureToolCall = (id: string, name: string) => {
			let existing = toolCalls.find((t) => t.id === id)
			if (!existing) {
				existing = { id, name, argumentsText: '' }
				toolCalls.push(existing)
			}
			return existing
		}

		for await (const part of stream) {
			const delta: any = part.choices[0]?.delta
			const text = delta?.content
			if (text) {
				yield text
			}

			const deltaToolCalls: any[] | undefined = delta?.tool_calls
			if (Array.isArray(deltaToolCalls)) {
				for (const tc of deltaToolCalls) {
					const id = String(tc?.id ?? '')
					const name = String(tc?.function?.name ?? '')
					const argsChunk = String(tc?.function?.arguments ?? '')
					if (!id || !name) continue
					const acc = ensureToolCall(id, name)
					acc.argumentsText += argsChunk
				}
			}
		}

		if (toolCalls.length > 0) {
			const payload = toolCalls.map((tc) => {
				let parsed: any = null
				try {
					parsed = tc.argumentsText ? JSON.parse(tc.argumentsText) : {}
				} catch {
					parsed = { __raw: tc.argumentsText }
				}
				return {
					id: tc.id,
					name: tc.name,
					arguments: parsed
				}
			})
			yield buildToolCallsBlock(payload)
		}
	}

type ContentItem =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| { type: 'text'; text: string }

const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const content: ContentItem[] = msg.embeds
		? await Promise.all(msg.embeds.map((embed) => convertEmbedToImageUrl(embed, resolveEmbedAsBinary)))
		: []

	if (msg.content.trim()) {
		content.push({
			type: 'text' as const,
			text: msg.content
		})
	}
	return {
		role: msg.role,
		content
	}
}

export const openAIVendor: Vendor = {
	name: 'OpenAI',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.openai.com/v1',
		model: 'gpt-4.1',
		parameters: {}
	},
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://platform.openai.com/api-keys',
	capabilities: ['Text Generation', 'Image Vision', 'Tool Calling']
}

