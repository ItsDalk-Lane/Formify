import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { CALLOUT_BLOCK_END, CALLOUT_BLOCK_START } from './utils'
import { DebugLogger } from '../../../utils/DebugLogger'

// DeepSeek选项接口，扩展基础选项以支持推理功能
export interface DeepSeekOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
}

type DeepSeekDelta = OpenAI.ChatCompletionChunk.Choice.Delta & {
	reasoning_content?: string
} // hack, deepseek-reasoner added a reasoning_content field

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, _resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))

		const client = new OpenAI({
			apiKey,
			baseURL,
			dangerouslyAllowBrowser: true
		})

		const stream = await client.chat.completions.create(
			{
				model,
				messages,
				stream: true,
				...remains
			},
			{ signal: controller.signal }
		)

		let startReasoning = false
		const deepSeekOptions = settings as DeepSeekOptions
		const isReasoningEnabled = deepSeekOptions.enableReasoning ?? false
		
		for await (const part of stream) {
			if (part.usage && part.usage.prompt_tokens && part.usage.completion_tokens)
				DebugLogger.debug(`Prompt tokens: ${part.usage.prompt_tokens}, completion tokens: ${part.usage.completion_tokens}`)

			const delta = part.choices[0]?.delta as DeepSeekDelta
			const reasonContent = delta?.reasoning_content

			// 只有在启用推理功能时才显示推理内容
			if (reasonContent && isReasoningEnabled) {
				const prefix = !startReasoning ? ((startReasoning = true), CALLOUT_BLOCK_START) : ''
				yield prefix + reasonContent.replace(/\n/g, '\n> ') // Each line of the callout needs to have '>' at the beginning
			} else {
				const prefix = startReasoning ? ((startReasoning = false), CALLOUT_BLOCK_END) : ''
				if (delta?.content) yield prefix + delta?.content
			}
		}
	}

const models = ['deepseek-chat', 'deepseek-reasoner']

export const deepSeekVendor: Vendor = {
	name: 'DeepSeek',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.deepseek.com',
		model: models[0],
		parameters: {},
		enableReasoning: false // 默认关闭推理功能
	},
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://platform.deepseek.com',
	capabilities: ['Text Generation', 'Reasoning']
}

