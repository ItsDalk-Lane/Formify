import axios from 'axios'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl } from './utils'
import { feedChunk, ParsedSSEEvent } from './sse'
import { withOpenAIMcpToolCallSupport } from '../mcp/mcpToolCallHandler'

// Kimi选项接口，扩展基础选项以支持推理功能
export interface KimiOptions extends BaseOptions {
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
		let sseRest = ''
		let startReasoning = false
		let reasoningStartMs: number | null = null
		const kimiOptions = settings as KimiOptions
		const isReasoningEnabled = kimiOptions.enableReasoning ?? false

		const processEvents = async function* (events: ParsedSSEEvent[]) {
			for (const event of events) {
				if (event.isDone) {
					reading = false
					break
				}
				if (event.parseError) {
					console.warn('[Kimi] Failed to parse SSE JSON:', event.parseError)
				}
				const payload = event.json as any
				if (!payload || !payload.choices || !payload.choices[0]?.delta) {
					continue
				}
				const delta = payload.choices[0].delta
				const reasonContent = delta.reasoning_content

				if (reasonContent && isReasoningEnabled) {
					if (!startReasoning) {
						startReasoning = true
						reasoningStartMs = Date.now()
						yield buildReasoningBlockStart(reasoningStartMs)
					}
					yield reasonContent
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
		
		while (reading) {
			const { done, value } = await reader.read()
			if (done) {
				const flushed = feedChunk(sseRest, '\n\n')
				sseRest = flushed.rest
				for await (const text of processEvents(flushed.events)) {
					yield text
				}
				reading = false
				break
			}
			const parsed = feedChunk(sseRest, value)
			sseRest = parsed.rest
			for await (const text of processEvents(parsed.events)) {
				yield text
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

export const kimiVendor: Vendor = {
	name: 'Kimi',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.moonshot.cn/v1/chat/completions',
		model: '',
		parameters: {},
		enableReasoning: false // 默认关闭推理功能
	} as KimiOptions,
	sendRequestFunc: withOpenAIMcpToolCallSupport(sendRequestFunc),
	models: [],
	websiteToObtainKey: 'https://www.moonshot.cn',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning']
}
