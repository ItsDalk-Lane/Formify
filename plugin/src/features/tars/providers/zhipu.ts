import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { DebugLogger } from '../../../utils/DebugLogger'
import { buildReasoningBlockStart, buildReasoningBlockEnd } from './utils'

export type ZhipuThinkingType = 'enabled' | 'disabled' | 'auto'

export const ZHIPU_THINKING_TYPE_OPTIONS: { value: ZhipuThinkingType; label: string; description: string }[] = [
	{ value: 'disabled', label: '禁用', description: '禁用推理，直接回答' },
	{ value: 'enabled', label: '启用', description: '始终启用深度推理' },
	{ value: 'auto', label: '自动', description: '模型自动判断是否使用推理' }
]

export const DEFAULT_ZHIPU_THINKING_TYPE: ZhipuThinkingType = 'auto'

export const ZHIPU_REASONING_MODELS = ['glm-4.6', 'glm-4.5', 'glm-4.5v']

export const isReasoningModel = (model: string): boolean => {
	return ZHIPU_REASONING_MODELS.includes(model)
}

export interface ZhipuOptions extends BaseOptions {
	enableWebSearch: boolean
	enableReasoning: boolean
	thinkingType: ZhipuThinkingType
}

const sendRequestFunc = (settings: ZhipuOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, _resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, enableWebSearch, enableReasoning, thinkingType, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		DebugLogger.debug('zhipu options', { baseURL, apiKey, model, enableWebSearch, enableReasoning, thinkingType })

		const client = new OpenAI({
			apiKey: apiKey,
			baseURL,
			dangerouslyAllowBrowser: true
		})

		const tools = (enableWebSearch
			? [
					{
						type: 'web_search',
						web_search: {
							enable: true
						}
					}
				]
			: []) as object[] as OpenAI.Chat.Completions.ChatCompletionTool[] // hack, because the zhipu-ai function call type definition is different from openai's type definition

		// 构建请求参数
		const requestParams: any = {
			model,
			messages,
			stream: true,
			tools: tools,
			...remains
		}

		// 添加推理配置
		if (enableReasoning && isReasoningModel(model) && thinkingType !== 'disabled') {
			requestParams.thinking = {
				type: thinkingType
			}
		}

		const stream = await client.chat.completions.create(requestParams, {
			signal: controller.signal
		})

		let reasoningActive = false
		let blockStarted = false
		let reasoningStartMs: number | null = null

		for await (const part of stream as any) {
			const delta = part.choices[0]?.delta

			// 处理推理内容（参考官方文档的 reasoning_content 字段）
			// 只有在用户启用推理功能时才处理推理内容
			if (enableReasoning && thinkingType !== 'disabled' && delta?.reasoning_content) {
				const reasoningText = delta.reasoning_content
				if (reasoningText) {
					if (!reasoningActive) {
						reasoningActive = true
						reasoningStartMs = Date.now()
						yield buildReasoningBlockStart(reasoningStartMs)
						blockStarted = true
					}
					yield reasoningText // 直接输出，不加任何前缀
				}
				continue
			}

			// 处理普通文本内容
			const text = delta?.content
			if (text) {
				if (reasoningActive) {
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					yield buildReasoningBlockEnd(durationMs)
					reasoningActive = false
					reasoningStartMs = null
					blockStarted = false
				}
				yield text
			}
		}

		// 处理剩余的推理内容（流结束时推理还在进行）
		if (reasoningActive) {
			const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
			yield buildReasoningBlockEnd(durationMs)
			reasoningStartMs = null
		}
	}


const models = ['glm-4-plus', 'glm-4-air', 'glm-4-airx', 'glm-4-long', 'glm-4-flash', 'glm-4-flashx', 'glm-4.6', 'glm-4.5', 'glm-4.5v']

export const zhipuVendor: Vendor = {
	name: 'Zhipu',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
		model: models[0],
		enableWebSearch: false,
		enableReasoning: false,
		thinkingType: DEFAULT_ZHIPU_THINKING_TYPE,
		parameters: {}
	} as ZhipuOptions,
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://open.bigmodel.cn/',
	capabilities: ['Text Generation', 'Web Search', 'Reasoning']
}

