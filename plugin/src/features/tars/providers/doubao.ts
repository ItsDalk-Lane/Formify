import { requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { buildReasoningBlockStart, buildReasoningBlockEnd, convertEmbedToImageUrl, getMimeTypeFromFilename } from './utils'

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

export type DoubaoThinkingType = 'enabled' | 'disabled' | 'auto'
export type DoubaoReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

interface DoubaoModelCapability {
	thinkingTypes: DoubaoThinkingType[]
	supportsReasoningEffort: boolean
}

const DOUBAO_MODEL_CAPABILITY_MAP: Record<string, DoubaoModelCapability> = {
	'doubao-seed-1-6-vision-250815': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-seed-1-6-lite-251015': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: true },
	'doubao-seed-1-6-250615': { thinkingTypes: ['enabled', 'disabled', 'auto'], supportsReasoningEffort: false },
	'doubao-seed-1-6-251015': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: true },
	'doubao-seed-1-6-flash-250828': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-seed-1-6-flash-250715': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-seed-1-6-flash-250615': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-1-5-thinking-vision-pro-250428': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-1-5-ui-tars-250428': { thinkingTypes: ['enabled', 'disabled'], supportsReasoningEffort: false },
	'doubao-1-5-thinking-pro-m-250428': { thinkingTypes: ['enabled', 'disabled', 'auto'], supportsReasoningEffort: false }
}

export const DOUBAO_REASONING_EFFORT_OPTIONS: DoubaoReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
export const DEFAULT_DOUBAO_THINKING_TYPE: DoubaoThinkingType = 'enabled'

export const getDoubaoModelCapability = (model: string): DoubaoModelCapability | undefined =>
	DOUBAO_MODEL_CAPABILITY_MAP[model]

// Doubao图片理解配置选项
export interface DoubaoOptions extends BaseOptions {
	enableReasoning?: boolean // 是否启用推理功能（受聊天界面“推理”按钮控制）
	thinkingType?: DoubaoThinkingType
	reasoningEffort?: DoubaoReasoningEffort
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

/**
 * 已知的动态图片服务域名列表
 * 这些服务通常不使用文件扩展名，而是通过 URL 参数来获取图片
 */
const KNOWN_IMAGE_SERVICE_DOMAINS = [
	'tse1.mm.bing.net', 'tse2.mm.bing.net', 'tse3.mm.bing.net', 'tse4.mm.bing.net', // Bing 图片搜索
	'th.bing.com', // Bing 缩略图
	'images.unsplash.com', 'source.unsplash.com', // Unsplash
	'pbs.twimg.com', // Twitter 图片
	'i.imgur.com', // Imgur
	'cdn.discordapp.com', 'media.discordapp.net', // Discord
	'lh3.googleusercontent.com', 'lh4.googleusercontent.com', 'lh5.googleusercontent.com', // Google 用户内容
	'graph.facebook.com', // Facebook Graph API
	'avatars.githubusercontent.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com', // GitHub
	'i.ytimg.com', // YouTube 缩略图
	'img.shields.io', // Shields.io 徽章
	'via.placeholder.com', 'placekitten.com', 'placehold.co', // 占位图服务
	'api.qrserver.com', // QR Code 生成
	'chart.googleapis.com', // Google Charts
	'image.tmdb.org', // TMDB 电影数据库
	'a.ppy.sh', // osu! 头像
	'cdn.shopify.com', // Shopify CDN
	'res.cloudinary.com', // Cloudinary
	'imagedelivery.net', // Cloudflare Images
]

/**
 * 检查 URL 是否来自已知的动态图片服务
 */
const isKnownImageService = (url: string): boolean => {
	try {
		const urlObj = new URL(url)
		const hostname = urlObj.hostname.toLowerCase()
		return KNOWN_IMAGE_SERVICE_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain))
	} catch {
		return false
	}
}

/**
 * 从文本中提取图片 URL
 * 
 * 提取逻辑：
 * 1. 只提取带有图片扩展名（.png, .jpg, .jpeg, .gif, .webp）的 URL
 * 2. 或者来自已知动态图片服务（如 Bing、Unsplash 等）的 URL
 * 3. 过滤掉普通网页链接（如 .htm, .html, .php 等）
 * 
 * 支持的 URL 格式：
 * - 带扩展名：https://example.com/image.jpg
 * - 带查询参数：https://example.com/image.jpg?size=large
 * - 动态服务：https://tse1.mm.bing.net/th/id/OIP.xxx?rs=1&pid=ImgDetMain
 */
const extractImageUrls = (text: string | undefined): string[] => {
	if (!text) return []
	
	// 匹配所有以 http:// 或 https:// 开头的 URL
	const urlRegex = /(https?:\/\/[^\s]+)/gi
	const matches = text.match(urlRegex) || []
	
	const imageUrls: string[] = []
	
	// 明确的非图片文件扩展名（网页、脚本等）
	const NON_IMAGE_EXTENSIONS = ['.htm', '.html', '.php', '.asp', '.aspx', '.jsp', '.js', '.css', '.json', '.xml', '.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.tar', '.gz', '.7z', '.exe', '.msi', '.dmg', '.apk', '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac']
	
	for (const match of matches) {
		let url = match.trim()
		
		// 清理 URL 末尾的特殊字符
		// 移除常见的中文标点、括号等非 URL 字符
		url = url.replace(/[)）\]】>'"]+$/, '')
		
		const lowerUrl = url.toLowerCase()
		
		// 检查是否是明确的非图片文件
		const hasNonImageExt = NON_IMAGE_EXTENSIONS.some(ext => {
			const pathPart = lowerUrl.split('?')[0].split('#')[0] // 去掉查询参数和锚点
			return pathPart.endsWith(ext)
		})
		if (hasNonImageExt) {
			continue // 跳过非图片文件
		}
		
		// 检查是否包含图片扩展名
		let foundImageExt = false
		for (const ext of IMAGE_EXTENSIONS) {
			const extIndex = lowerUrl.lastIndexOf(ext)
			if (extIndex !== -1) {
				foundImageExt = true
				// 截取到扩展名结束的位置
				const afterExt = url.substring(extIndex + ext.length)
				
				// 如果扩展名后面是查询参数或锚点，保留它们
				if (afterExt.startsWith('?') || afterExt.startsWith('#')) {
					const endMatch = afterExt.match(/^[?#][^\s)）\]】>'"]*/)
					if (endMatch) {
						url = url.substring(0, extIndex + ext.length + endMatch[0].length)
					} else {
						url = url.substring(0, extIndex + ext.length)
					}
				} else if (afterExt.length > 0) {
					// 扩展名后有其他字符但不是查询参数，截断
					url = url.substring(0, extIndex + ext.length)
				}
				break
			}
		}
		
		// 如果没有图片扩展名，检查是否是已知的动态图片服务
		if (!foundImageExt) {
			if (!isKnownImageService(url)) {
				continue // 既没有图片扩展名，也不是已知图片服务，跳过
			}
			// 对于动态图片服务，清理 URL 末尾的特殊字符
			url = url.replace(/[)）\]】>'"]+$/, '')
		}
		
		// 最终验证：确保 URL 不为空且格式合法
		if (url.length > 10 && url.match(/^https?:\/\/.+/)) {
			imageUrls.push(url)
		}
	}
	
	// 去重
	return Array.from(new Set(imageUrls))
}

const extractString = (value: unknown): string | undefined => {
	if (!value) return undefined
	if (typeof value === 'string') return value
	if (Array.isArray(value)) {
		return value
			.map((item) => extractString(item))
			.filter((item): item is string => typeof item === 'string')
			.join('') || undefined
	}
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>
		const preferredKeys: Array<string> = ['text', 'content', 'delta', 'thinking', 'value', 'output']
		for (const key of preferredKeys) {
			if (key in obj) {
				const nested = extractString(obj[key])
				if (nested) return nested
			}
		}
		for (const key of Object.keys(obj)) {
			if (preferredKeys.includes(key)) continue
			const nested = extractString(obj[key])
			if (nested) return nested
		}
	}
	return undefined
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

		const content: any[] = []
		let remainingText = message.content ?? ''
		const textImageUrls = extractImageUrls(remainingText)
		const imageContentsFromText: any[] = []

		if (textImageUrls.length > 0) {
			for (const url of textImageUrls) {
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
			for (const embed of message.embeds) {
				if (imageCount >= maxImageCount) {
					console.warn(`已达到最大图片数量限制 ${maxImageCount}，忽略剩余图片`)
					break
				}

				try {
					const isHttpUrl = embed.link.startsWith('http://') || embed.link.startsWith('https://')
					let imageContent: any

					if (isHttpUrl) {
						imageContent = {
							type: 'image_url' as const,
							image_url: {
								url: embed.link
							}
						}
					} else {
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
		const {
			apiKey,
			baseURL,
			model,
			imageDetail,
			imagePixelLimit,
			enableReasoning,
			enableWebSearch,
			webSearchConfig,
			thinkingType,
			reasoningEffort,
			...remains
		} = options
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
			stream: true
		}

		// 只添加通用的、非模型特定的参数
		// 过滤掉可能不被所有模型支持的参数
		const { 
			reasoningEffort: _, 
			thinkingType: __, 
			effort: ___,  // 也过滤掉直接的 effort 参数
			...generalParams 
		} = remains as any
		Object.assign(data, generalParams)

	const capability = getDoubaoModelCapability(model)
	let effectiveThinkingType: DoubaoThinkingType | undefined
	const isReasoningEnabled = enableReasoning === true

	
	if (capability) {
		const fallbackThinking = capability.thinkingTypes.includes(DEFAULT_DOUBAO_THINKING_TYPE)
			? DEFAULT_DOUBAO_THINKING_TYPE
			: capability.thinkingTypes[0]
		const requestedThinking = isReasoningEnabled ? (thinkingType ?? fallbackThinking) : 'disabled'
		effectiveThinkingType = capability.thinkingTypes.includes(requestedThinking)
			? requestedThinking
			: fallbackThinking

		
		if (effectiveThinkingType && isReasoningEnabled && effectiveThinkingType !== 'disabled') {
			data.thinking = { type: effectiveThinkingType }
		}

		// 豆包API不支持effort参数，根据官方文档
		// 即使模型标记为supportsReasoningEffort，也不添加effort参数
		// 注释掉以下代码：
		// if (capability && capability.supportsReasoningEffort && effectiveThinkingType === 'enabled') {
		// 	if (reasoningEffort && DOUBAO_REASONING_EFFORT_OPTIONS.includes(reasoningEffort)) {
		// 		data.effort = reasoningEffort
		// 	}
		// }
	} else {
		console.warn('[Doubao] 当前模型不在能力映射表中:', model)
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

				// 根据配置决定是否启用思考功能（同时受 enableReasoning 门控）
				if (
					isReasoningEnabled &&
					webSearchConfig?.enableThinking !== false &&
					effectiveThinkingType &&
					effectiveThinkingType !== 'disabled'
					) {
						data.thinking = { type: effectiveThinkingType }
					}

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
	let thinkingActive = false
	let thinkingStartMs: number | null = null
	const shouldShowThinking =
		isReasoningEnabled &&
		(effectiveThinkingType ?? 'disabled') !== 'disabled' &&
		(useResponsesAPI ? webSearchConfig?.enableThinking !== false : true)

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
					const payload = JSON.parse(trimmed.slice(6))

					if (useResponsesAPI) {
						const chunkType = payload.type as string | undefined
						if (chunkType && chunkType.startsWith('response.thinking')) {
							const thinkingText = extractString(payload.delta ?? payload.thinking ?? payload.content)
							if (thinkingText && shouldShowThinking) {
								if (!thinkingActive) {
									thinkingActive = true
									thinkingStartMs = Date.now()
									yield buildReasoningBlockStart(thinkingStartMs)
								}
								yield thinkingText // 直接输出，不加任何前缀
							}
							continue
						}
						if (chunkType === 'response.output_text.delta') {
							const content = extractString(payload.delta)
							if (content) {
								if (thinkingActive) {
									thinkingActive = false
									const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
									thinkingStartMs = null
									yield buildReasoningBlockEnd(durationMs)
								}
								yield content
							}
							continue
						}
						if (chunkType === 'response.completed' && thinkingActive) {
							thinkingActive = false
							const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
							thinkingStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
					} else {
						const delta = payload.choices?.[0]?.delta ?? {}

						// 豆包使用 reasoning_content 字段返回推理过程
						const reasoningContent = (delta as any).reasoning_content
						if (reasoningContent && shouldShowThinking) {
							if (!thinkingActive) {
								thinkingActive = true
								thinkingStartMs = Date.now()
								yield buildReasoningBlockStart(thinkingStartMs)
							}
							yield reasoningContent // 直接输出，不加任何前缀
						}

						const content = (delta as any).content
						if (content) {
							if (thinkingActive) {
								thinkingActive = false
								const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
								thinkingStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
							yield content
						}
						const finishReason = payload.choices?.[0]?.finish_reason
						if (finishReason && thinkingActive) {
							thinkingActive = false
							const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
							thinkingStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
					}
				} catch (e) {
					console.warn('Failed to parse SSE data:', trimmed, e)
				}
			}
		}
	} finally {
		if (thinkingActive) {
			thinkingActive = false
			const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
			thinkingStartMs = null
			yield buildReasoningBlockEnd(durationMs)
		}
		reader.releaseLock()
	}
}

const models = Object.keys(DOUBAO_MODEL_CAPABILITY_MAP)

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
	models,
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Text Generation', 'Image Vision', 'Web Search', 'Reasoning']
}
