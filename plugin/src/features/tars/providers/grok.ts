import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl } from './utils'
import { feedChunk } from './sse'

// Grok选项接口，扩展基础选项以支持推理功能
export interface GrokOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
}

export const grokUseResponsesAPI = (options: GrokOptions) => options.enableReasoning === true
export const grokResolveEndpoint = (baseURL: string, useResponsesAPI: boolean) =>
	useResponsesAPI && baseURL.includes('/chat/completions') ? baseURL.replace('/chat/completions', '/responses') : baseURL
export const grokMapResponsesParams = (params: Record<string, unknown>) => {
	const mapped = { ...params }
	if (typeof mapped.max_tokens === 'number') {
		mapped.max_output_tokens = mapped.max_tokens
		delete mapped.max_tokens
	}
	return mapped
}

const sendRequestFunc = (settings: GrokOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, enableReasoning = false, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		const useResponsesAPI = grokUseResponsesAPI({ ...options, enableReasoning })
		const endpoint = grokResolveEndpoint(baseURL, useResponsesAPI)

		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		const requestData: Record<string, unknown> = {
			model,
			stream: true
		}
		if (useResponsesAPI) {
			requestData.input = formattedMessages.map((message) => ({
				role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
				content: Array.isArray(message.content)
					? message.content.map((part) =>
							(part as any).type === 'image_url'
								? {
										type: 'input_image',
										image_url: (part as any).image_url?.url
									}
								: {
										type: 'input_text',
										text: String((part as any).text ?? '')
									}
					  )
					: [{ type: 'input_text', text: String(message.content ?? '') }]
			}))
			const responseParams = grokMapResponsesParams(remains as Record<string, unknown>)
			Object.assign(requestData, responseParams)
			if (requestData.reasoning === undefined) {
				requestData.reasoning = { effort: 'medium' }
			}
		} else {
			requestData.messages = formattedMessages
			Object.assign(requestData, remains)
		}

		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestData),
			signal: controller.signal
		})
		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Grok API error (${response.status}): ${errorText}`)
		}
		const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
		if (!reader) throw new Error('Grok response body is not readable')

		let reading = true
		let sseRest = ''
		let startReasoning = false
		let reasoningStartMs: number | null = null
		const isReasoningEnabled = enableReasoning

		const processEvents = async function* (events: any[]) {
			for (const event of events) {
				if (event.isDone) {
					reading = false
					break
				}
				if (event.parseError) {
					console.warn('[Grok] Failed to parse SSE JSON:', event.parseError)
				}
				const payload = event.json as any
				if (!payload) continue

				if (useResponsesAPI) {
					const eventType = String(payload.type ?? '')
					let reasonContent = ''
					if (eventType === 'response.reasoning_text.delta' || eventType === 'response.reasoning_summary_text.delta') {
						reasonContent = String(payload.delta ?? '')
					} else if (typeof payload.reasoning_content === 'string') {
						reasonContent = payload.reasoning_content
					} else if (typeof payload?.delta?.reasoning_content === 'string') {
						reasonContent = payload.delta.reasoning_content
					}

					if (reasonContent && isReasoningEnabled) {
						if (!startReasoning) {
							startReasoning = true
							reasoningStartMs = Date.now()
							yield buildReasoningBlockStart(reasoningStartMs)
						}
						yield reasonContent
						continue
					}

					const outputText = eventType === 'response.output_text.delta' ? String(payload.delta ?? '') : ''
					if (outputText) {
						if (startReasoning) {
							startReasoning = false
							const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
							reasoningStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
						yield outputText
					}
					continue
				}

				if (!payload.choices || !payload.choices[0]?.delta) {
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
