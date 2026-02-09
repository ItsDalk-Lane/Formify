import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl } from './utils'
import { withToolMessageContext } from './messageFormat'

// SiliconFlow选项接口，扩展基础选项以支持推理功能
export interface SiliconFlowOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
}

type DeepSeekDelta = OpenAI.ChatCompletionChunk.Choice.Delta & {
	reasoning_content?: string
} // hack, deepseek-reasoner added a reasoning_content field

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

		let startReasoning = false
		let reasoningStartMs: number | null = null
		const siliconFlowOptions = settings as SiliconFlowOptions
		const isReasoningEnabled = siliconFlowOptions.enableReasoning ?? false
		for await (const part of stream) {
			const delta = part.choices[0]?.delta as DeepSeekDelta
			const reasonContent = delta?.reasoning_content

			if (reasonContent && isReasoningEnabled) {
				if (!startReasoning) {
					startReasoning = true
					reasoningStartMs = Date.now()
					yield buildReasoningBlockStart(reasoningStartMs)
				}
				yield reasonContent // 直接输出，不加任何前缀
			} else {
				if (startReasoning) {
					startReasoning = false
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					reasoningStartMs = null
					yield buildReasoningBlockEnd(durationMs)
				}
				if (delta?.content) yield delta.content
			}
		}

		if (startReasoning) {
			const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
			yield buildReasoningBlockEnd(durationMs)
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

export const siliconFlowVendor: Vendor = {
	name: 'SiliconFlow',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.siliconflow.cn/v1',
		model: '',
		parameters: {},
		enableReasoning: false // 默认关闭推理功能
	} as SiliconFlowOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://siliconflow.cn',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning']
}
