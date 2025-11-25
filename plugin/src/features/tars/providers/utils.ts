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

export const CALLOUT_BLOCK_START = ' \n\n> [!quote]+  \n> '
export const CALLOUT_BLOCK_END = '\n\n'

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
				if ((options as any).enableReasoning === true) {
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

