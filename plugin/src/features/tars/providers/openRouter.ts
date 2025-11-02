import { EmbedCache, Notice } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { arrayBufferToBase64, getCapabilityEmoji, getMimeTypeFromFilename } from './utils'

/**
 * OpenRouter 选项接口
 * 扩展基础选项以支持网络搜索功能
 */
export interface OpenRouterOptions extends BaseOptions {
	enableWebSearch: boolean
	webSearchEngine?: 'native' | 'exa' // 搜索引擎选择：native（原生）、exa 或 undefined（自动选择）
	webSearchMaxResults?: number // 搜索结果数量，默认为 5
	webSearchPrompt?: string // 自定义搜索提示文本
}

/**
 * OpenRouter Web Search 插件配置
 */
interface WebSearchPlugin {
	id: 'web'
	engine?: 'native' | 'exa'
	max_results?: number
	search_prompt?: string
}

const sendRequestFunc = (settings: OpenRouterOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { 
			apiKey, 
			baseURL, 
			model, 
			enableWebSearch = false,
			webSearchEngine,
			webSearchMaxResults = 5,
			webSearchPrompt,
			...remains 
		} = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		
		// 构建请求数据
		const data: Record<string, unknown> = {
			model,
			messages: formattedMessages,
			stream: true,
			...remains
		}

		// 如果启用了网络搜索,配置 plugins 参数
		if (enableWebSearch) {
			const webPlugin: WebSearchPlugin = {
				id: 'web'
			}
			
			// 可选配置：搜索引擎
			if (webSearchEngine) {
				webPlugin.engine = webSearchEngine
			}
			
			// 可选配置：最大结果数
			if (webSearchMaxResults !== 5) {
				webPlugin.max_results = webSearchMaxResults
			}
			
			// 可选配置：自定义搜索提示
			if (webSearchPrompt) {
				webPlugin.search_prompt = webSearchPrompt
			}
			
			data.plugins = [webPlugin]
			
			// 显示网络搜索通知
			new Notice(getCapabilityEmoji('Web Search') + 'Web Search')
		}

		const response = await fetch(baseURL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data),
			signal: controller.signal
		})

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error('Response body is not readable')
		}
		const decoder = new TextDecoder()
		let buffer = ''

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				// Append new chunk to buffer
				buffer += decoder.decode(value, { stream: true })
				// Process complete lines from buffer
				while (true) {
					const lineEnd = buffer.indexOf('\n')
					if (lineEnd === -1) break
					const line = buffer.slice(0, lineEnd).trim()
					buffer = buffer.slice(lineEnd + 1)
					if (line.startsWith('data: ')) {
						const data = line.slice(6)
						if (data === '[DONE]') break
						try {
							const parsed = JSON.parse(data)
							const content = parsed.choices[0].delta.content
							if (content) {
								yield content
							}
							
							// 处理网络搜索的 annotations（URL citations）
							// OpenRouter 会在消息中返回 url_citation 注释
							if (parsed.choices[0].message?.annotations) {
								const annotations = parsed.choices[0].message.annotations
								for (const annotation of annotations) {
									if (annotation.type === 'url_citation') {
										const citation = annotation.url_citation
										// 可以选择在这里处理引用信息
										// 例如：记录日志或在界面上显示
										// DebugLogger.debug('Web search citation', {
										// 	url: citation.url,
										// 	title: citation.title,
										// 	content: citation.content
										// })
									}
								}
							}
						} catch {
							// Ignore invalid JSON
						}
					}
				}
			}
		} finally {
			reader.cancel()
		}
	}

type ContentItem =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| { type: 'text'; text: string }
	| { type: 'file'; file: { filename: string; file_data: string } }

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

/**
 * 从文本中提取图片 URL
 * 支持 http:// 和 https:// 开头的链接
 * 
 * 改进的 URL 提取逻辑：
 * 1. 提取所有 http/https URL
 * 2. 清理 URL 末尾的特殊字符（括号、中文等）
 * 3. 保留合法的查询参数和锚点
 * 4. 不强制要求 URL 包含图片扩展名（支持动态图片服务）
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
	
	for (const match of matches) {
		let url = match.trim()
		
		// 清理 URL 末尾的特殊字符
		// 移除常见的中文标点、括号等非 URL 字符
		// 但保留合法的 URL 字符（包括查询参数和锚点）
		url = url.replace(/[)）\]】>'"]+$/, '')
		
		// 如果 URL 包含图片扩展名，截断到扩展名之后
		const lowerUrl = url.toLowerCase()
		let foundExt = false
		
		for (const ext of IMAGE_EXTENSIONS) {
			const extIndex = lowerUrl.lastIndexOf(ext)
			if (extIndex !== -1) {
				foundExt = true
				// 截取到扩展名结束的位置
				const afterExt = url.substring(extIndex + ext.length)
				
				// 如果扩展名后面是查询参数或锚点，保留它们
				if (afterExt.startsWith('?') || afterExt.startsWith('#')) {
					// 查找查询参数或锚点的结束位置（遇到非 URL 字符为止）
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
		
		// 即使没有找到扩展名，也保留 URL（支持动态图片服务）
		if (!foundExt) {
			// 对于没有扩展名的 URL，确保末尾没有多余的特殊字符
			// 但保留查询参数和锚点
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

/**
 * 处理嵌入内容（embed），支持：
 * 1. URL 图片：直接使用 URL
 * 2. 本地图片：转换为 base64
 * 3. PDF 文件：转换为 base64
 */
const formatEmbed = async (embed: EmbedCache, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const mimeType = getMimeTypeFromFilename(embed.link)
	
	// 检查是否为 HTTP/HTTPS URL
	const isHttpUrl = embed.link.startsWith('http://') || embed.link.startsWith('https://')
	
	if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
		// 如果是 URL 图片，直接使用 URL
		if (isHttpUrl) {
			return {
				type: 'image_url' as const,
				image_url: {
					url: embed.link
				}
			}
		}
		
		// 本地图片，转换为 base64
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'image_url' as const,
			image_url: {
				url: `data:${mimeType};base64,${base64Data}`
			}
		}
	} else if ('application/pdf' === mimeType) {
		// PDF 文件，转换为 base64
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'file' as const,
			file: {
				filename: embed.link,
				file_data: `data:${mimeType};base64,${base64Data}`
			}
		}
	} else {
		throw new Error(t('Only PNG, JPEG, GIF, WebP, and PDF files are supported.'))
	}
}

/**
 * 格式化消息，支持：
 * 1. 文本内容
 * 2. 嵌入的图片（URL 或本地）
 * 3. 文本中的图片 URL
 * 
 * 注意：根据 OpenRouter API 规范，当只有纯文本时返回字符串格式，
 * 当包含图片时返回数组格式（遵循 OpenAI 标准）
 */
const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	// 处理文本内容和提取图片 URL
	let remainingText = msg.content ?? ''
	const textImageUrls = extractImageUrls(remainingText)
	
	// 从文本中移除图片 URL（避免重复显示）
	for (const url of textImageUrls) {
		remainingText = remainingText.split(url).join(' ')
	}
	const sanitizedText = remainingText.trim()
	
	// 处理嵌入的图片和文件
	const embedContents: ContentItem[] = msg.embeds && msg.embeds.length > 0
		? await Promise.all(msg.embeds.map((embed) => formatEmbed(embed, resolveEmbedAsBinary)))
		: []
	
	// 如果没有任何图片（既没有文本中的 URL，也没有嵌入的图片），返回简单的文本格式
	if (textImageUrls.length === 0 && embedContents.length === 0) {
		return {
			role: msg.role,
			content: msg.content
		}
	}
	
	// 有图片时，使用数组格式（OpenAI 标准的 multimodal 格式）
	const content: ContentItem[] = []
	
	// 根据 OpenRouter 文档建议：先添加文本，再添加图片
	if (sanitizedText) {
		content.push({
			type: 'text' as const,
			text: sanitizedText
		})
	}
	
	// 添加从文本中提取的图片 URL
	if (textImageUrls.length > 0) {
		content.push(...textImageUrls.map((url) => ({
			type: 'image_url' as const,
			image_url: {
				url
			}
		})))
	}
	
	// 添加嵌入的图片和文件
	content.push(...embedContents)
	
	return {
		role: msg.role,
		content
	}
}

export const openRouterVendor: Vendor = {
	name: 'OpenRouter',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://openrouter.ai/api/v1/chat/completions',
		model: '',
		enableWebSearch: false,
		webSearchEngine: undefined, // undefined 表示自动选择：OpenAI 和 Anthropic 使用 native，其他使用 exa
		webSearchMaxResults: 5,
		webSearchPrompt: undefined,
		parameters: {}
	} as OpenRouterOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://openrouter.ai',
	capabilities: ['Text Generation', 'Image Vision', 'PDF Vision', 'Web Search']
}

