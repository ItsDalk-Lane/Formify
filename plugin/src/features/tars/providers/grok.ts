import axios from 'axios'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl } from './utils'

// Grok选项接口，扩展基础选项以支持推理功能
export interface GrokOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
}

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		const data = {
			model,
			messages: formattedMessages,
			stream: true,
			...remains
		}
		const response = await axios.post(baseURL, data, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			adapter: 'fetch',
			responseType: 'stream',
			withCredentials: false,
			signal: controller.signal
		})

		const reader = response.data.pipeThrough(new TextDecoderStream()).getReader()

		let reading = true
		let startReasoning = false
		let reasoningStartMs: number | null = null
		const grokOptions = settings as GrokOptions
		const isReasoningEnabled = grokOptions.enableReasoning ?? false
		
		while (reading) {
			const { done, value } = await reader.read()
			if (done) {
				reading = false
				break
			}

			const parts = value.split('\n')

			for (const part of parts) {
				if (part.includes('data: [DONE]')) {
					reading = false
					break
				}

				const trimmedPart = part.replace(/^data: /, '').trim()
				if (trimmedPart) {
					const data = JSON.parse(trimmedPart)
					if (data.choices && data.choices[0].delta) {
						const delta = data.choices[0].delta
						const reasonContent = delta.reasoning_content

						// 只有在启用推理功能时才显示推理内容
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
							if (delta.content) {
								yield delta.content
							}
						}
					}
				}
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

	// If there are no embeds/images, return a simple text message format
	if (content.length === 0) {
		return {
			role: msg.role,
			content: msg.content
		}
	}
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

export const grokVendor: Vendor = {
	name: 'Grok',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.x.ai/v1/chat/completions',
		model: '',
		parameters: {},
		enableReasoning: false // 默认关闭推理功能
	} as GrokOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://x.ai',
	capabilities: ['Text Generation', 'Reasoning', 'Image Vision']
}

