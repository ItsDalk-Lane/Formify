import { EmbedCache } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Capability, ProviderSettings, ResolveEmbedAsBinary, Vendor } from '.'

export const getMimeTypeFromFilename = (filename: string) => {
	const extension = filename.split('.').pop()?.toLowerCase() || ''

	const mimeTypes: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml',
		bmp: 'image/bmp',
		ico: 'image/x-icon',

		pdf: 'application/pdf',
		doc: 'application/msword',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		ppt: 'application/vnd.ms-powerpoint',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

		txt: 'text/plain',
		html: 'text/html',
		css: 'text/css',
		js: 'application/javascript',
		json: 'application/json',
		xml: 'application/xml',
		md: 'text/markdown',

		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		ogg: 'audio/ogg',
		flac: 'audio/flac',
		m4a: 'audio/mp4',

		mp4: 'video/mp4',
		avi: 'video/x-msvideo',
		mov: 'video/quicktime',
		wmv: 'video/x-ms-wmv',
		webm: 'video/webm'
	}

	return mimeTypes[extension] || 'application/octet-stream'
}

export const CALLOUT_BLOCK_START = ' \n\n> [!danger]+\n> '
export const CALLOUT_BLOCK_END = '\n\n'

// 推理区块标记（用于前端解析和创建独立的推理 UI）
export const REASONING_BLOCK_START_MARKER = '{{FF_REASONING_START}}'
export const REASONING_BLOCK_END_MARKER = '{{FF_REASONING_END}}'

export const formatReasoningDuration = (durationMs: number) => {
	const centiSeconds = Math.max(1, Math.round(durationMs / 10))
	return `${(centiSeconds / 100).toFixed(2)}s`
}

// 推理区块开始标记（包含时间戳）
export const buildReasoningBlockStart = (startMs: number) => {
	return `${REASONING_BLOCK_START_MARKER}:${startMs}:`
}

// 推理区块结束标记（包含耗时）
export const buildReasoningBlockEnd = (durationMs: number) => {
	return `:${REASONING_BLOCK_END_MARKER}:${durationMs}`
}

export const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	const len = bytes.byteLength
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i])
	}
	return window.btoa(binary)
}

export const convertEmbedToImageUrl = async (embed: EmbedCache, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const mimeType = getMimeTypeFromFilename(embed.link)
	const originalBase64 = (embed as any)?.[Symbol.for('originalBase64')] as string | undefined
	const originalMimeType = ((embed as any)?.[Symbol.for('mimeType')] as string | undefined)?.toLowerCase()

	if (typeof originalBase64 === 'string' && originalBase64.length > 0) {
		const dataUrl = originalBase64.startsWith('data:')
			? originalBase64
			: `data:${originalMimeType || mimeType || 'image/png'};base64,${originalBase64}`

		const dataMimeTypeMatch = dataUrl.match(/^data:([^;]+);base64,/i)
		const dataMimeType = dataMimeTypeMatch?.[1]?.toLowerCase() ?? (originalMimeType || mimeType)
		if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'].includes(dataMimeType)) {
			return {
				type: 'image_url' as const,
				image_url: {
					url: dataUrl
				}
			}
		}
	}

	if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType) === false) {
		throw new Error(t('Only PNG, JPEG, GIF, and WebP images are supported.'))
	}

	const embedBuffer = await resolveEmbedAsBinary(embed)
	const base64Data = arrayBufferToBase64(embedBuffer)
	return {
		type: 'image_url' as const,
		image_url: {
			url: `data:${mimeType};base64,${base64Data}`
		}
	}
}

export const getCapabilityEmoji = (capability: Capability): string => {
	switch (capability) {
		case 'Text Generation':
			return '✍️'
		case 'Image Vision':
			return '👁️'
		case 'PDF Vision':
			return '📄'
		case 'Image Generation':
			return '🎨'
		case 'Image Editing':
			return '✏️'
		case 'Web Search':
			return '🔍'
		case 'Reasoning':
			return '🧠'
		case 'Structured Output':
			return '📋'
	}
}

/**
 * 根据模型实例配置动态计算实际启用的功能
 * @param vendor 服务商定义
 * @param options 模型实例配置选项
 * @returns 实际启用的功能列表
 */
export const getEnabledCapabilities = (vendor: Vendor, options: BaseOptions): Capability[] => {
	// 获取服务商支持的所有功能
	const vendorCapabilities = [...vendor.capabilities]

	const isReasoningEnabledForDisplay = (): boolean => {
		const raw = options as any

		// 通用开关（大部分 provider 使用）
		if (raw?.enableReasoning === true) return true

		// Qwen/Claude/QianFan 使用 enableThinking
		if (vendor.name === 'Qwen' || vendor.name === 'Claude' || vendor.name === 'QianFan') {
			return raw?.enableThinking === true
		}

		// Doubao 使用 thinkingType: enabled/auto/disabled
		if (vendor.name === 'Doubao') {
			const thinkingType = raw?.thinkingType
			if (typeof thinkingType === 'string') {
				return thinkingType !== 'disabled'
			}
			// 兼容旧配置：未设置时按默认开启推理处理
			return true
		}

		// Azure 目前没有单独的推理开关，且实现上会强制引导输出 <think>
		if (vendor.name === 'Azure') {
			return true
		}

		return false
	}

	// 检查是否启用了结构化输出
	const isStructuredOutputEnabled = (): boolean => {
		const raw = options as any
		// Ollama 使用 format 参数（可能在 options 上或 parameters 中）
		if (vendor.name === 'Ollama') {
			return raw?.format !== undefined || raw?.parameters?.format !== undefined
		}
		// DeepSeek 使用 response_format: { type: 'json_object' }
		if (vendor.name === 'DeepSeek') {
			const responseFormat = raw?.response_format ?? raw?.parameters?.response_format
			return responseFormat?.type === 'json_object'
		}
		// 可以在这里添加其他服务商的结构化输出检查
		return false
	}

	// 检查并过滤掉未启用的功能
	const enabledCapabilities: Capability[] = []

	for (const capability of vendorCapabilities) {
		switch (capability) {
			case 'Web Search':
				// 只有当enableWebSearch为true时才启用网络搜索
				if (options.enableWebSearch === true) {
					enabledCapabilities.push(capability)
				}
				break

			case 'Reasoning':
				// 只有当enableReasoning为true时才启用推理功能
				if (isReasoningEnabledForDisplay()) {
					enabledCapabilities.push(capability)
				}
				break

			case 'Structured Output':
				// 只有当配置了 format 参数时才启用结构化输出
				if (isStructuredOutputEnabled()) {
					enabledCapabilities.push(capability)
				}
				break

			case 'Image Generation':
				// OpenRouter特殊处理：只有当模型支持图像生成时才显示此功能
				if (vendor.name === 'OpenRouter') {
					// 动态检查模型是否支持图像生成
					if (isImageGenerationModel(options.model)) {
						enabledCapabilities.push(capability)
					}
				} else {
					// 其他服务商：只要支持就启用
					enabledCapabilities.push(capability)
				}
				break

			// 以下功能目前没有开关控制，只要服务商支持就启用
			case 'Text Generation':
			case 'Image Vision':
			case 'PDF Vision':
			case 'Image Editing':
				enabledCapabilities.push(capability)
				break
		}
	}

	return enabledCapabilities
}

/**
 * 检查OpenRouter模型是否支持图像生成
 * @param model 模型名称
 * @returns 是否支持图像生成
 */
const isImageGenerationModel = (model: string): boolean => {
	if (!model) return false

	// 检查模型是否在已知的图像生成模型列表中
	const knownImageGenerationModels = [
		'openai/gpt-5-image-mini',
		'openai/gpt-5-image',
		'google/gemini-2.5-flash-image',
		'google/gemini-2.5-flash-image-preview'
	]

	// 严格匹配已知的图像生成模型
	if (knownImageGenerationModels.includes(model)) {
		return true
	}

	// 对于其他模型，检查名称中是否包含 "image" 关键字
	// 这符合 OpenRouter 的命名规范，图像生成模型都会在名称中包含 "image" 关键字
	const modelName = model.toLowerCase()
	return modelName.includes('image')
}

/**
 * 获取模型实例的功能显示文本
 * @param vendor 服务商定义
 * @param options 模型实例配置选项
 * @returns 功能显示文本（仅包含图标）
 */
export const getCapabilityDisplayText = (vendor: Vendor, options: BaseOptions): string => {
	const enabledCapabilities = getEnabledCapabilities(vendor, options)
	return enabledCapabilities.map((cap) => getCapabilityEmoji(cap)).join('  ')
}

/**
 * 构建禁用推理的 provider options
 *
 * 该函数用于在非聊天场景（如 Tab 补全、快捷操作执行、AI 动作等）中禁用推理功能，
 * 避免推理内容意外输出到最终结果中。
 *
 * @param originalOptions - 原始的 provider options
 * @param vendorName - 供应商名称（用于判断参数类型）
 * @returns 新的 options 对象，所有推理相关参数都设置为禁用状态
 */
export const buildProviderOptionsWithReasoningDisabled = (
	originalOptions: Record<string, unknown>,
	vendorName: string
): Record<string, unknown> => {
	// 创建浅拷贝，避免修改原始对象
	const newOptions = { ...originalOptions }

	// 通用推理参数禁用（适用于大部分 provider）
	newOptions.enableReasoning = false
	newOptions.enableThinking = false

	// Doubao 特殊处理：使用 thinkingType: 'disabled'
	if (vendorName === 'Doubao') {
		newOptions.thinkingType = 'disabled'
	}

	// Zhipu 特殊处理：同时需要禁用 enableReasoning 和设置 thinkingType
	if (vendorName === 'Zhipu') {
		newOptions.thinkingType = 'disabled'
	}

	return newOptions
}

export type { ProviderErrorType, NormalizedProviderError } from './errors'
export { normalizeProviderError, shouldRetryNormalizedError, isAbortLikeError } from './errors'
export { withRetry, type RetryOptions } from './retry'
