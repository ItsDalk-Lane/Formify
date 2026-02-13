import { Ollama } from 'ollama/browser'
import type { EmbedCache } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { arrayBufferToBase64, getMimeTypeFromFilename, buildReasoningBlockStart, buildReasoningBlockEnd } from './utils'

// Structured Output Format 类型
export type StructuredOutputFormat = 'json' | Record<string, unknown>

// Ollama 扩展选项接口
export interface OllamaOptions extends BaseOptions {
	// 推理功能配置
	enableReasoning?: boolean // 是否启用推理功能
	thinkLevel?: 'low' | 'medium' | 'high' // 推理级别(可选)

	// 结构化输出配置
	format?: StructuredOutputFormat // 输出格式：'json' 或 JSON Schema 对象
}

/**
 * 将 embed 数组转换为 Ollama 需要的 base64 字符串数组
 * @param embeds embed 对象数组
 * @param resolveEmbedAsBinary embed 转换函数
 * @returns base64 字符串数组（不含 data URL 前缀）
 * @throws {Error} 当遇到不支持的图像格式时
 */
const convertEmbedsToBase64Array = async (
	embeds: EmbedCache[],
	resolveEmbedAsBinary: ResolveEmbedAsBinary
): Promise<string[]> => {
	const base64Array: string[] = []

	for (const embed of embeds) {
		const mimeType = getMimeTypeFromFilename(embed.link)

		// 验证图像格式
		if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
			throw new Error(t('Only PNG, JPEG, GIF, and WebP images are supported.'))
		}

		// 转换为 base64（无前缀）
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		base64Array.push(base64Data)
	}

	return base64Array
}

/**
 * 将项目消息格式转换为 Ollama API 消息格式
 * @param msg 原始消息对象
 * @param resolveEmbedAsBinary embed 转换函数
 * @returns Ollama 格式的消息
 */
const formatMsgForOllama = async (
	msg: Message,
	resolveEmbedAsBinary: ResolveEmbedAsBinary
): Promise<{ role: string; content: string; images?: string[] }> => {
	// 提取并转换图像
	const images = msg.embeds
		? await convertEmbedsToBase64Array(msg.embeds, resolveEmbedAsBinary)
		: []

	// 构建消息对象
	return {
		role: msg.role,
		content: msg.content,
		images: images.length > 0 ? images : undefined
	}
}

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters } as OllamaOptions
		const { baseURL, model, enableReasoning, thinkLevel, format, ...remains } = options

		// 格式化消息（处理图像 embeds）
		const formattedMessages = await Promise.all(
			messages.map((msg) => formatMsgForOllama(msg, resolveEmbedAsBinary))
		)

		// 构建 Ollama API 请求参数
		const requestParams: any = {
			model,
			messages: formattedMessages,
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

		// 添加结构化输出格式参数（如果配置）
		if (format !== undefined) {
			requestParams.format = format
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
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning', 'Structured Output']
}
