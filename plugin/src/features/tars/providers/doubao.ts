import { requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { convertEmbedToImageUrl, getMimeTypeFromFilename } from './utils'

// Web Search 工具配置
export interface WebSearchTool {
	type: 'web_search'
	limit?: number // 最多返回的搜索结果数量，默认10
	max_keyword?: number // 最多生成的搜索关键词数量
	sources?: string[] // 优先搜索的来源，如 ['toutiao', 'douyin', 'moji']
	user_location?: {
		type: 'approximate'
		country?: string
		region?: string
		city?: string
	}
}

// Doubao图片理解配置选项
export interface DoubaoOptions extends BaseOptions {
	// 图片理解精细度控制
	imageDetail?: 'low' | 'high'
	imagePixelLimit?: {
		minPixels?: number
		maxPixels?: number
	}
	// Web Search 相关配置
	webSearchConfig?: {
		limit?: number
		maxKeyword?: number
		sources?: string[]
		userLocation?: {
			country?: string
			region?: string
			city?: string
		}
		systemPrompt?: string // 系统提示词，用于指导搜索行为
		enableThinking?: boolean // 是否启用思考过程（边想边搜）
	}
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

const extractImageUrls = (text: string | undefined): string[] => {
	if (!text) return []
	const urlRegex = /(https?:\/\/[^\s]+)/gi
	const matches = text.match(urlRegex) || []
	const uniqueUrls = Array.from(new Set(matches.map((match) => match.trim())));
	return uniqueUrls.filter((url) => {
		const lowerUrl = url.toLowerCase()
		return IMAGE_EXTENSIONS.some((ext) => lowerUrl.includes(ext))
	})
}

// 处理消息，支持文本和图片的多模态输入
// 当启用 Web Search 时，需要转换为 Responses API 的消息格式
const processMessages = async (
	messages: Message[],
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
	imageDetail?: 'low' | 'high',
	imagePixelLimit?: { minPixels?: number; maxPixels?: number },
	useResponsesAPI = false // 是否使用 Responses API 格式
) => {
	const processedMessages = []

	for (const message of messages) {
		console.log(`[Doubao] 处理消息:`, {
			role: message.role,
			content: message.content?.substring(0, 50),
			embedsCount: message.embeds?.length || 0,
			embeds: message.embeds?.map((e) => e.link) || []
		})

		const content: any[] = []
		let remainingText = message.content ?? ''
		const textImageUrls = extractImageUrls(remainingText)
		const imageContentsFromText: any[] = []

		if (textImageUrls.length > 0) {
			for (const url of textImageUrls) {
				console.log(`[Doubao] 识别到文本中的图片URL: ${url}`)
				imageContentsFromText.push({
					type: 'image_url' as const,
					image_url: {
						url
					}
				})
			}

			for (const url of textImageUrls) {
				remainingText = remainingText.split(url).join(' ')
			}
		}

		const sanitizedText = remainingText.trim()
		if (sanitizedText) {
			content.push({
				type: useResponsesAPI ? 'input_text' : 'text',
				text: sanitizedText
			})
		}

		content.push(...imageContentsFromText)

		let imageCount = 0
		const maxImageCount = 10
		const maxImageSize = 20 * 1024 * 1024

		if (message.embeds && message.embeds.length > 0) {
			console.log(`[Doubao] 检测到 ${message.embeds.length} 个嵌入内容`)
			for (const embed of message.embeds) {
				if (imageCount >= maxImageCount) {
					console.warn(`已达到最大图片数量限制 ${maxImageCount}，忽略剩余图片`)
					break
				}

				try {
					const isHttpUrl = embed.link.startsWith('http://') || embed.link.startsWith('https://')
					let imageContent: any

					if (isHttpUrl) {
						console.log(`[Doubao] 使用 URL 图片: ${embed.link}`)
						imageContent = {
							type: 'image_url' as const,
							image_url: {
								url: embed.link
							}
						}
					} else {
						console.log(`[Doubao] 处理本地图片: ${embed.link}`)
						const binary = await resolveEmbedAsBinary(embed)
						if (binary.byteLength > maxImageSize) {
							console.warn(`图片大小超过限制 ${maxImageSize / (1024 * 1024)}MB，忽略此图片`)
							continue
						}

						const mimeType = getMimeTypeFromFilename(embed.link)
						if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
							console.warn(`不支持的图片格式: ${mimeType}，忽略此图片`)
							continue
						}

						imageContent = await convertEmbedToImageUrl(embed, resolveEmbedAsBinary)
					}

					if (imageContent) {
						if (imagePixelLimit && (imagePixelLimit.minPixels || imagePixelLimit.maxPixels)) {
							const pixelLimit: any = {}
							if (imagePixelLimit.minPixels) pixelLimit.min_pixels = imagePixelLimit.minPixels
							if (imagePixelLimit.maxPixels) pixelLimit.max_pixels = imagePixelLimit.maxPixels
							imageContent.image_pixel_limit = pixelLimit
						} else if (imageDetail) {
							imageContent.detail = imageDetail
						}

						content.push(imageContent)
						imageCount++
					}
				} catch (error) {
					console.error('处理嵌入图片时出错:', error)
				}
			}
		}

		const hasImageContent = content.some((item) => item.type !== 'text' && item.type !== 'input_text')

		if (!useResponsesAPI && !hasImageContent) {
			const textItem = content.find((item) => item.type === 'text')
			processedMessages.push({
				role: message.role,
				content: textItem ? textItem.text : ''
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
		const { apiKey, baseURL, model, imageDetail, imagePixelLimit, enableWebSearch, webSearchConfig, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		// 判断是否启用 Web Search
		const useWebSearch = enableWebSearch === true
		const useResponsesAPI = useWebSearch // Web Search 需要使用 Responses API

		// 确定使用的 API 端点
		let endpoint = baseURL
		if (useResponsesAPI && baseURL.includes('/chat/completions')) {
			// 如果启用了 Web Search，自动切换到 Responses API
			endpoint = baseURL.replace('/chat/completions', '/responses')
		}

		// 处理消息，自动支持文本和图片的多模态输入
		const processedMessages = await processMessages(
			messages, 
			resolveEmbedAsBinary,
			imageDetail,
			imagePixelLimit,
			useResponsesAPI
		)

		// 构建请求数据
		const data: any = {
			model,
			stream: true,
			...remains
		}

		// 根据 API 类型设置消息字段
		if (useResponsesAPI) {
			// Responses API 使用 input 字段
			data.input = processedMessages
			
			// 添加 Web Search 工具配置
			if (useWebSearch) {
				const webSearchTool: WebSearchTool = {
					type: 'web_search'
				}

				// 配置搜索参数
				if (webSearchConfig?.limit) {
					webSearchTool.limit = webSearchConfig.limit
				}
				if (webSearchConfig?.maxKeyword) {
					webSearchTool.max_keyword = webSearchConfig.maxKeyword
				}
				if (webSearchConfig?.sources && webSearchConfig.sources.length > 0) {
					webSearchTool.sources = webSearchConfig.sources
				}
				if (webSearchConfig?.userLocation) {
					webSearchTool.user_location = {
						type: 'approximate',
						...webSearchConfig.userLocation
					}
				}

				data.tools = [webSearchTool]

				// 不启用思考功能，避免输出思考过程
				// 如果需要启用，可以取消下面的注释
				// if (webSearchConfig?.enableThinking) {
				// 	data.thinking = { type: 'auto' }
				// }

				// 如果配置了系统提示词，添加到消息开头
				if (webSearchConfig?.systemPrompt) {
					data.input = [
						{
							role: 'system',
							content: [
								{
									type: 'input_text',
									text: webSearchConfig.systemPrompt
								}
							]
						},
						...processedMessages
					]
				}
			}
		} else {
			// Chat Completions API 使用 messages 字段
			data.messages = processedMessages
		}

		// 发送请求
		const response = await fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify(data),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			signal: controller.signal
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
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
						
						if (useResponsesAPI) {
							// 处理 Responses API 的流式响应
							const chunkType = json.type
							
							// 只输出最终回答文本，忽略思考过程和搜索状态
							if (chunkType === 'response.output_text.delta') {
								const content = json.delta
								if (content) yield content
							}
						} else {
							// 处理 Chat Completions API 的流式响应
							const content = json.choices?.[0]?.delta?.content
							if (content) yield content
						}
					} catch (e) {
						console.warn('Failed to parse SSE data:', trimmed, e)
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
		parameters: {},
		enableWebSearch: false // 默认不启用 Web Search
	},
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Text Generation', 'Image Vision', 'Web Search']
}

