import { AzureOpenAI } from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockEnd, buildReasoningBlockStart } from './utils'
import { DebugLogger } from '../../../utils/DebugLogger'

export interface AzureOptions extends BaseOptions {
	endpoint: string
	apiVersion: string
	enableReasoning?: boolean
}

export const azureUseResponsesAPI = (options: AzureOptions) => options.enableReasoning === true
export const azureMapResponsesParams = (params: Record<string, unknown>) => {
	const mapped = { ...params }
	if (typeof mapped.max_tokens === 'number') {
		mapped.max_output_tokens = mapped.max_tokens
		delete mapped.max_tokens
	}
	return mapped
}

const sendRequestFunc = (settings: AzureOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, model, endpoint, apiVersion, enableReasoning = false, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment: model, dangerouslyAllowBrowser: true })

		if (azureUseResponsesAPI({ ...options, enableReasoning })) {
			const input = await Promise.all(messages.map((msg) => formatMsgForResponses(msg, resolveEmbedAsBinary)))
			const responseData: Record<string, unknown> = {
				model,
				stream: true,
				input
			}
			const responseParams = azureMapResponsesParams(remains as Record<string, unknown>)
			Object.assign(responseData, responseParams)
			if (responseData.reasoning === undefined) {
				responseData.reasoning = { effort: 'medium' }
			}

			const stream = await client.responses.create(responseData as any, {
				signal: controller.signal
			})
			let reasoningActive = false
			let reasoningStartMs: number | null = null
			for await (const event of stream as any) {
				if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') {
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

		const stream = await client.chat.completions.create(
			{
				model,
				messages: messages.map((message) => ({
					role: message.role,
					content: message.content
				})),
				stream: true,
				...remains
			},
			{
				signal: controller.signal
			}
		)

		let reasoningActive = false
		let reasoningStartMs: number | null = null
		for await (const part of stream as any) {
			if (part.usage && part.usage.prompt_tokens && part.usage.completion_tokens)
				DebugLogger.debug(`Prompt tokens: ${part.usage.prompt_tokens}, completion tokens: ${part.usage.completion_tokens}`)

			const delta = part.choices[0]?.delta
			const reasoningContent = delta?.reasoning_content
			if (reasoningContent) {
				if (!reasoningActive) {
					reasoningActive = true
					reasoningStartMs = Date.now()
					yield buildReasoningBlockStart(reasoningStartMs)
				}
				yield reasoningContent
			}
			const text = delta?.content
			if (text) {
				if (reasoningActive) {
					reasoningActive = false
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					reasoningStartMs = null
					yield buildReasoningBlockEnd(durationMs)
				}
				yield text
			}
		}
		if (reasoningActive) {
			const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
			yield buildReasoningBlockEnd(durationMs)
		}
	}

const formatMsgForResponses = async (msg: Message, _resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	return {
		role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
		content: [{ type: 'input_text', text: msg.content }]
	}
}

const models = ['o3-mini', 'deepseek-r1', 'phi-4', 'o1', 'o1-mini', 'gpt-4o', 'gpt-4o-mini']

export const azureVendor: Vendor = {
	name: 'Azure',
	defaultOptions: {
		apiKey: '',
		baseURL: '',
		model: models[0],
		endpoint: '',
		apiVersion: '',
		enableReasoning: false,
		parameters: {}
	} as AzureOptions,
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://portal.azure.com',
	capabilities: ['Text Generation', 'Reasoning']
}
