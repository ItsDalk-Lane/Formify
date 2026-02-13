import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import {
	buildReasoningBlockEnd,
	buildReasoningBlockStart,
	convertEmbedToImageUrl
} from './utils'
import { withToolMessageContext } from './messageFormat'
import { normalizeProviderError } from './errors'
import { withRetry } from './retry'

export interface OpenAIOptions extends BaseOptions {
	enableReasoning?: boolean
}

export const openAIUseResponsesAPI = (options: OpenAIOptions) => options.enableReasoning === true
export const openAIMapResponsesParams = (params: Record<string, unknown>) => {
	const mapped = { ...params }
	if (typeof mapped.max_tokens === 'number') {
		mapped.max_output_tokens = mapped.max_tokens
		delete mapped.max_tokens
	}
	return mapped
}

const sendRequestFunc = (settings: OpenAIOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		try {
			const { parameters, ...optionsExcludingParams } = settings
			const options = { ...optionsExcludingParams, ...parameters }
			const { apiKey, baseURL, model, enableReasoning = false, ...remains } = options
			if (!apiKey) throw new Error(t('API key is required'))
			const client = new OpenAI({
				apiKey,
				baseURL,
				dangerouslyAllowBrowser: true
			})

			if (openAIUseResponsesAPI({ ...options, enableReasoning })) {
				const responseInput = await Promise.all(messages.map((msg) => formatMsgForResponses(msg, resolveEmbedAsBinary)))
				const responseData: Record<string, unknown> = {
					model,
					stream: true,
					input: responseInput
				}
				const responseParams = openAIMapResponsesParams(remains as Record<string, unknown>)
				Object.assign(responseData, responseParams)
				if (enableReasoning && responseData.reasoning === undefined) {
					responseData.reasoning = { effort: 'medium' }
				}

				const stream = await withRetry(
					() =>
						client.responses.create(responseData as any, {
							signal: controller.signal
						}),
					{ signal: controller.signal }
				)
				let reasoningActive = false
				let reasoningStartMs: number | null = null
				for await (const event of stream as any) {
					if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') {
						if (!enableReasoning) continue
						const text = String(event.delta ?? '')
						if (!text) continue
						if (!reasoningActive) {
							reasoningActive = true
							reasoningStartMs = Date.now()
							yield buildReasoningBlockStart(reasoningStartMs)
						}
						yield text
						continue
					}

					if (event.type === 'response.output_text.delta') {
						const text = String(event.delta ?? '')
						if (!text) continue
						if (reasoningActive) {
							reasoningActive = false
							const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
							reasoningStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
						yield text
						continue
					}

					if (event.type === 'response.completed' && reasoningActive) {
						reasoningActive = false
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						reasoningStartMs = null
						yield buildReasoningBlockEnd(durationMs)
					}
				}
				if (reasoningActive) {
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					yield buildReasoningBlockEnd(durationMs)
				}
				return
			}

			const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
			const stream = await withRetry(
				() =>
					client.chat.completions.create(
						{
							model,
							messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
							stream: true,
							...remains
						},
						{ signal: controller.signal }
					),
				{ signal: controller.signal }
			)

			for await (const part of stream) {
				const delta: any = part.choices[0]?.delta
				const text = delta?.content
				if (text) {
					yield text
				}
			}
		} catch (error) {
			throw normalizeProviderError(error, 'OpenAI request failed')
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
	return withToolMessageContext(msg, {
		role: msg.role,
		content
	})
}

const formatMsgForResponses = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const base = await formatMsg(msg, resolveEmbedAsBinary)
	const content = Array.isArray(base.content) ? base.content : [{ type: 'text' as const, text: String(base.content ?? '') }]
	return {
		role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
		content: content.map((part) => {
			if ((part as any).type === 'image_url') {
				return {
					type: 'input_image',
					image_url: (part as any).image_url?.url
				}
			}
			return {
				type: 'input_text',
				text: String((part as any).text ?? '')
			}
		})
	}
}

export const openAIVendor: Vendor = {
	name: 'OpenAI',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.openai.com/v1',
		model: 'gpt-4.1',
		enableReasoning: false,
		parameters: {}
	} as OpenAIOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://platform.openai.com/api-keys',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning']
}
