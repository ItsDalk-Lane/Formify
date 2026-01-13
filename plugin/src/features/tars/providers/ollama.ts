import { Ollama } from 'ollama/browser'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd } from './utils'

// Ollama 扩展选项接口
export interface OllamaOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
	thinkLevel?: 'low' | 'medium' | 'high' // 推理级别(可选)
}

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, _resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters } as OllamaOptions
		const { baseURL, model, enableReasoning, thinkLevel, ...remains } = options

		// 构建 Ollama API 请求参数
		const requestParams: any = {
			model,
			messages,
			stream: true,
			...remains
		}

		// 根据配置添加 think 参数
		if (enableReasoning) {
			// 如果指定了 thinkLevel，使用级别；否则使用 true
			requestParams.think = thinkLevel ?? true
		} else {
			// 明确禁用推理
			requestParams.think = false
		}

		const ollama = new Ollama({ host: baseURL })
		const response = await ollama.chat(requestParams)

		// 推理状态追踪
		let inReasoning = false
		let reasoningStartMs: number | null = null
		const isReasoningEnabled = enableReasoning ?? false

		for await (const part of response) {
			if (controller.signal.aborted) {
				ollama.abort()
				break
			}

			const thinkingContent = part.message?.thinking
			const content = part.message?.content

			// 处理推理内容
			if (thinkingContent && isReasoningEnabled) {
				if (!inReasoning) {
					inReasoning = true
					reasoningStartMs = Date.now()
					yield buildReasoningBlockStart(reasoningStartMs)
				}
				yield thinkingContent
			} else {
				// 退出推理状态
				if (inReasoning) {
					inReasoning = false
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					reasoningStartMs = null
					yield buildReasoningBlockEnd(durationMs)
				}
				// 输出正常内容
				if (content) yield content
			}
		}

		// 流结束时关闭推理块
		if (inReasoning) {
			const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
			yield buildReasoningBlockEnd(durationMs)
		}
	}

export const ollamaVendor: Vendor = {
	name: 'Ollama',
	defaultOptions: {
		apiKey: '',
		baseURL: 'http://127.0.0.1:11434',
		model: 'llama3.1',
		parameters: {},
		enableReasoning: false
	} as OllamaOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://ollama.com',
	capabilities: ['Text Generation', 'Reasoning']
}
