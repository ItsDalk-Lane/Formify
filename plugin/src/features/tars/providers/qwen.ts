import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl } from './utils'

// Qwen 扩展选项接口
export interface QwenOptions extends BaseOptions {
	enableThinking?: boolean // 是否启用思考模式
}

// 已知支持思考模式的模型列表（根据官方文档，用于UI提示）
const KNOWN_THINKING_MODELS = [
	'qwen3-max-preview', // 通义千问Max系列（混合思考模式）
	'qwen-plus',
	'qwen-plus-latest',
	'qwen-plus-2025-04-28',
	'qwen-flash',
	'qwen-flash-2025-07-28',
	'qwen-turbo',
	'qwen-turbo-latest',
	'qwen-turbo-2025-04-28'
]

// 完整的模型列表（包含所有已知模型）
const models = [
	'qwen-turbo',
	'qwen-plus',
	'qwen-max',
	'qwen-vl-max',
	'qwen3-max-preview',
	'qwen-plus-latest',
	'qwen-plus-2025-04-28',
	'qwen-flash',
	'qwen-flash-2025-07-28',
	'qwen-turbo-latest',
	'qwen-turbo-2025-04-28'
]

// 检查模型是否已知支持思考模式
const isKnownThinkingModel = (model: string): boolean => {
	return KNOWN_THINKING_MODELS.includes(model)
}

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters } as QwenOptions
		const { apiKey, baseURL, model, enableThinking, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))

		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		const client = new OpenAI({
			apiKey,
			baseURL,
			dangerouslyAllowBrowser: true
		})

		// 构建请求参数
		const requestParams: any = {
			model,
			messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
			stream: true,
			stream_options: {
				include_usage: true
			},
			...remains
		}

		// 如果启用思考模式，添加思考参数（允许所有模型尝试）
		if (enableThinking) {
			requestParams.enable_thinking = true
		}

		try {
			const stream = await client.chat.completions.create(requestParams, {
				signal: controller.signal
			})

		// 状态管理
			let thinkingActive = false
			let thinkingStartMs: number | null = null
			const isThinkingEnabled = enableThinking ?? false

			try {
				for await (const part of stream as any) {
					
					const delta = part.choices[0]?.delta

					// 处理推理内容
					const reasoningContent = (delta as any)?.reasoning_content
					if (reasoningContent && isThinkingEnabled) {
						if (!thinkingActive) {
							thinkingActive = true
							thinkingStartMs = Date.now()
							yield buildReasoningBlockStart(thinkingStartMs)
						}
						yield reasoningContent // 直接输出，不加任何前缀
						continue
					}

					// 处理普通内容
					const content = delta?.content
					if (content) {
						if (thinkingActive) {
							thinkingActive = false
							const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
							thinkingStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
						yield content
						continue
					}

					// 处理完成状态
					const finishReason = part.choices[0]?.finish_reason
					if (finishReason) {
						console.log('[Qwen] 流结束，原因:', finishReason)
						if (thinkingActive) {
							thinkingActive = false
							const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
							thinkingStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
					}
				}
			} finally {
				// 确保在异常情况下也能正确结束思考块
				if (thinkingActive) {
					thinkingActive = false
					const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
					thinkingStartMs = null
					yield buildReasoningBlockEnd(durationMs)
				}
			}
		} catch (error: any) {
			if (error.name === "AbortError") {
				throw new Error(t('Generation cancelled'))
			}

			// 检查是否是思考模式相关的错误
			if (enableThinking && error.message?.includes('enable_thinking')) {
				console.warn(`[Qwen] 思考模式参数错误，尝试不使用思考模式重试: ${error.message}`)
				// 这里可以实现降级逻辑，但为了避免复杂性，我们直接抛出原始错误
			}

			throw error
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


export const qwenVendor: Vendor = {
	name: 'Qwen',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		model: models[0],
		parameters: {}
	},
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://dashscope.console.aliyun.com',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning']
}

