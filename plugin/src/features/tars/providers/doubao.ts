import { requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { convertEmbedToImageUrl, getMimeTypeFromFilename } from './utils'

// Doubao图片理解配置选项
export interface DoubaoOptions extends BaseOptions {
	// 图片理解精细度控制
	imageDetail?: 'low' | 'high'
	imagePixelLimit?: {
		minPixels?: number
		maxPixels?: number
	}
}

// 处理消息，支持文本和图片的多模态输入
const processMessages = async (
	messages: Message[],
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
	imageDetail?: 'low' | 'high',
	imagePixelLimit?: { minPixels?: number; maxPixels?: number }
) => {
	const processedMessages = []

	for (const message of messages) {
		// 如果消息没有嵌入图片，直接添加（纯文本模式）
		if (!message.embeds || message.embeds.length === 0) {
			processedMessages.push({
				role: message.role,
				content: message.content
			})
			continue
		}

		// 处理包含图片的消息（多模态模式）
		const content = []

		// 添加文本内容
		if (message.content) {
			content.push({
				type: 'text',
				text: message.content
			})
		}

		// 处理嵌入的图片（最多10张，单张最大20MB）
		let imageCount = 0
		const maxImageCount = 10
		const maxImageSize = 20 * 1024 * 1024

		for (const embed of message.embeds) {
			if (imageCount >= maxImageCount) {
				console.warn(`已达到最大图片数量限制 ${maxImageCount}，忽略剩余图片`)
				break
			}

			try {
				// 检查图片大小
				const binary = await resolveEmbedAsBinary(embed)
				if (binary.byteLength > maxImageSize) {
					console.warn(`图片大小超过限制 ${maxImageSize / (1024 * 1024)}MB，忽略此图片`)
					continue
				}

				// 检查图片格式
				const mimeType = getMimeTypeFromFilename(embed.link)
				if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
					console.warn(`不支持的图片格式: ${mimeType}，忽略此图片`)
					continue
				}

				// 转换为API需要的格式
				const imageContent: any = await convertEmbedToImageUrl(embed, resolveEmbedAsBinary)
				
				// 添加图片理解精细度控制
				// 优先级：imagePixelLimit > detail
				if (imagePixelLimit && (imagePixelLimit.minPixels || imagePixelLimit.maxPixels)) {
					// 使用 image_pixel_limit 控制
					const pixelLimit: any = {}
					if (imagePixelLimit.minPixels) pixelLimit.min_pixels = imagePixelLimit.minPixels
					if (imagePixelLimit.maxPixels) pixelLimit.max_pixels = imagePixelLimit.maxPixels
					imageContent.image_pixel_limit = pixelLimit
				} else if (imageDetail) {
					// 使用 detail 控制
					imageContent.detail = imageDetail
				}
				
				content.push(imageContent)
				imageCount++
			} catch (error) {
				console.error('处理嵌入图片时出错:', error)
			}
		}

		// 如果没有有效的图片内容，只添加文本
		if (content.length === 1 && content[0].type === 'text') {
			processedMessages.push({
				role: message.role,
				content: content[0].text
			})
		} else {
			processedMessages.push({
				role: message.role,
				content
			})
		}
	}

	return processedMessages
}

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters } as DoubaoOptions
		const { apiKey, baseURL, model, imageDetail, imagePixelLimit, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		// 处理消息，自动支持文本和图片的多模态输入
		const processedMessages = await processMessages(
			messages, 
			resolveEmbedAsBinary,
			imageDetail,
			imagePixelLimit
		)

		const data = {
			model,
			messages: processedMessages,
			stream: true,
			...remains
		}

		const response = await fetch(baseURL, {
			method: 'POST',
			body: JSON.stringify(data),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			signal: controller.signal
		})

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}

		const reader = response.body?.getReader()
		if (!reader) throw new Error('Failed to get response reader')

		const decoder = new TextDecoder()
		let buffer = ''

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					const trimmed = line.trim()
					if (!trimmed || trimmed === 'data: [DONE]') continue
					if (!trimmed.startsWith('data: ')) continue

					try {
						const json = JSON.parse(trimmed.slice(6))
						const content = json.choices?.[0]?.delta?.content
						if (content) yield content
					} catch (e) {
						console.warn('Failed to parse SSE data:', trimmed)
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

export const doubaoVendor: Vendor = {
	name: 'Doubao',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
		model: '',
		parameters: {}
	},
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Text Generation', 'Image Vision']
}

