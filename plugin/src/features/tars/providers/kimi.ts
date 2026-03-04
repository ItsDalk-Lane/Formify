import axios from 'axios'
import OpenAI from 'openai'
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
	sendRequestFunc: withOpenAIMcpToolCallSupport(sendRequestFunc, {
		// 使用流式工具调用循环：Moonshot 官方推荐思考模型使用流式输出（stream=true），
		// 以获得更好的用户体验（实时推理内容与回复内容）并避免网络超时
		// 使用自定义客户端工厂，避免 OpenAI SDK v5 附加的非标准 HTTP 头部
		// （x-stainless-*、User-Agent: OpenAI/JS）导致 Moonshot API 拒绝请求
		createClient: (allOptions: Record<string, unknown>) => {
			const apiKey = typeof allOptions.apiKey === 'string' ? allOptions.apiKey : ''
			let baseURL = typeof allOptions.baseURL === 'string' ? allOptions.baseURL : ''
			if (baseURL.endsWith('/chat/completions')) {
				baseURL = baseURL.replace(/\/chat\/completions$/, '')
			}
			const cleanFetch: typeof globalThis.fetch = (input, init) => {
				if (init?.headers) {
					const headersInit = init.headers as HeadersInit
					const cleanedHeaders: Record<string, string> = {}
					// 将 HeadersInit 转换为普通对象以便处理
					if (headersInit instanceof Headers) {
						headersInit.forEach((value, key) => {
							cleanedHeaders[key] = value
						})
					} else if (Array.isArray(headersInit)) {
						for (const [key, value] of headersInit) {
							cleanedHeaders[key] = String(value)
						}
					} else {
						Object.assign(cleanedHeaders, headersInit)
					}
					// 剥离 SDK 自动附加的非标准头部
					for (const key of Object.keys(cleanedHeaders)) {
						if (key.startsWith('x-stainless-')) {
							delete cleanedHeaders[key]
						}
					}
					// 替换 SDK 默认的 User-Agent
					if ('user-agent' in cleanedHeaders) {
						cleanedHeaders['user-agent'] = 'Formify/1.0'
					}
					return globalThis.fetch(input, { ...init, headers: cleanedHeaders })
				}
				return globalThis.fetch(input, init)
			}
			return new OpenAI({
				apiKey,
				baseURL,
				dangerouslyAllowBrowser: true,
				fetch: cleanFetch,
			})
		},
		transformApiParams: (apiParams, allOptions) => {
			const mapped: Record<string, unknown> = { ...apiParams }
			// 清理非 Moonshot API 标准参数，避免干扰工具调用
			delete mapped.enableThinking
			delete mapped.enableWebSearch
			// Kimi 需要显式声明 tool_choice 才会稳定触发工具调用
			if (mapped.tool_choice === undefined) {
				mapped.tool_choice = 'auto'
			}
			const isReasoningEnabled = allOptions.enableReasoning === true
			// Moonshot 官方文档：思考模型推荐 temperature=1.0 以获得最佳性能
			// kimi-k2.5 固定使用 temperature=1.0
			if (isReasoningEnabled) {
				mapped.temperature = 1.0
			}
			// Moonshot 思考模型多步工具调用官方示例要求较高 max_tokens（文档建议 >= 16000）
			const hasMcpTools = Array.isArray(allOptions.mcpTools) && allOptions.mcpTools.length > 0
			const currentMaxTokens = typeof mapped.max_tokens === 'number' ? mapped.max_tokens : undefined
			if (hasMcpTools && isReasoningEnabled && (currentMaxTokens === undefined || currentMaxTokens < 16000)) {
				mapped.max_tokens = 16000
			}
			return mapped
		}
	}),
	models: [],
	websiteToObtainKey: 'https://www.moonshot.cn',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning']
}
