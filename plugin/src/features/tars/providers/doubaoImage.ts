import { Notice, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'
import { DebugLogger } from '../../../utils/DebugLogger'
import { feedChunk } from './sse'

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
		
		// 将识别到的图片 URL 添加到结果中
		if (url.length > 0) {
			imageUrls.push(url)
			DebugLogger.debug(`提取到图片 URL: ${url}`)
		}
	}
	
	return imageUrls
}

// 豆包图像生成支持的模型列表
export const DOUBAO_IMAGE_MODELS = [
	'doubao-seedream-4-0-250828',
	'doubao-seedream-3.0-t2i'
]

export const isDoubaoImageGenerationModel = (model: string): boolean => {
	const normalized = (model || '').trim().toLowerCase()
	if (!normalized) return false
	if (DOUBAO_IMAGE_MODELS.includes(normalized)) return true
	if (normalized.includes('seedream')) return true
	if (normalized.includes('-t2i')) return true
	if (normalized.includes('image') && normalized.includes('generation')) return true
	return false
}

// 推荐的图片尺寸预设值
export const DOUBAO_IMAGE_SIZE_PRESETS = {
	'1K': '1K',
	'2K': '2K',
	'4K': '4K',
	'2048x2048': '2048x2048 (1:1)',
	'2304x1728': '2304x1728 (4:3)',
	'1728x2304': '1728x2304 (3:4)',
	'2560x1440': '2560x1440 (16:9)',
	'1440x2560': '1440x2560 (9:16)',
	'2496x1664': '2496x1664 (3:2)',
	'1664x2496': '1664x2496 (2:3)',
	'3024x1296': '3024x1296 (21:9)'
} as const

export const DEFAULT_DOUBAO_IMAGE_OPTIONS = {
	displayWidth: 400,
	size: '2K',
	response_format: 'b64_json',
	watermark: false,
	sequential_image_generation: 'disabled',
	stream: false,
	optimize_prompt_mode: 'standard'
}

export interface DoubaoImageOptions extends BaseOptions {
	displayWidth: number
	// 图片尺寸：支持分辨率（1K/2K/4K）或像素值（如2048x2048）
	size: '1K' | '2K' | '4K' | '2048x2048' | '2304x1728' | '1728x2304' | '2560x1440' | '1440x2560' | '2496x1664' | '1664x2496' | '3024x1296' | string
	response_format: 'url' | 'b64_json'
	watermark?: boolean
	// 组图功能控制
	sequential_image_generation?: 'auto' | 'disabled'
	// 组图配置：最多生成的图片数量
	max_images?: number
	// 流式输出
	stream?: boolean
	// 提示词优化模式
	optimize_prompt_mode?: 'standard' | 'fast'
}

/**
 * 解析 SSE (Server-Sent Events) 格式的流式响应
 * 格式示例：
 * event: image
 * data: {"url": "https://...", "b64_json": "..."}
 * 
 * event: done
 * data: [DONE]
 */
function parseSSEResponse(text: string): { data: any[] } {
	const result: any[] = []
	const parsed = feedChunk('', `${text}\n\n`)
	for (const event of parsed.events) {
		if (event.isDone) continue
		if (event.parseError) {
			console.warn('Failed to parse SSE data line:', event.data, event.parseError)
			continue
		}
		const jsonData = event.json as any
		if (!jsonData) continue
		if (event.event === 'image' || !event.event || jsonData.url || jsonData.b64_json) {
			result.push(jsonData)
		}
	}
	return { data: result }
}

const sendRequestFunc = (settings: DoubaoImageOptions): SendRequest =>
	async function* (
		messages: Message[],
		_controller: AbortController,
		resolveEmbedAsBinary: ResolveEmbedAsBinary,
		saveAttachment?: SaveAttachment
	) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { 
			apiKey, 
			baseURL, 
			model, 
			displayWidth, 
			size, 
			response_format, 
			watermark,
			sequential_image_generation,
			max_images,
			stream,
			optimize_prompt_mode
		} = options
		
		if (!apiKey) throw new Error(t('API key is required'))
		if (!saveAttachment) throw new Error('saveAttachment is required')

		DebugLogger.debug('messages:', messages)
		DebugLogger.debug('options:', options)
		
		if (messages.length > 1) {
			new Notice(t('Only the last user message is used for image generation. Other messages are ignored.'))
		}
		
		const lastMsg = messages.last()
		if (!lastMsg) {
			throw new Error('No user message found in the conversation')
		}
		
		// 从用户消息中提取文本提示词和图片URL
		let prompt = lastMsg.content || ''
		const textImageUrls = extractImageUrls(prompt)
		
		// 从提示词中移除图片URL，保留纯文本
		for (const url of textImageUrls) {
			prompt = prompt.split(url).join(' ')
		}
		prompt = prompt.trim()
		
		if (!prompt) {
			throw new Error('请提供文本提示词用于图片生成')
		}

		// 构建请求数据，严格按照官方 API 格式
		const data: Record<string, unknown> = {
			model,
			prompt,
			size,
			response_format
		}
		
		// 添加输入图片（支持消息中的网络图片和本地图片）
		const imageUrls: string[] = []
		
		// 添加从文本中提取的网络图片URL
		if (textImageUrls.length > 0) {
			DebugLogger.debug(`从文本中提取到 ${textImageUrls.length} 个网络图片URL`)
			imageUrls.push(...textImageUrls)
		}
		
		// 从消息中提取嵌入的图片
		if (lastMsg.embeds && lastMsg.embeds.length > 0) {
			DebugLogger.debug(`检测到 ${lastMsg.embeds.length} 个嵌入内容`)
			for (const embed of lastMsg.embeds) {
				try {
					// 检查是否是网络图片
					const isHttpUrl = embed.link.startsWith('http://') || embed.link.startsWith('https://')
					
					if (isHttpUrl) {
						// 网络图片直接使用 URL
						DebugLogger.debug(`使用网络图片 URL: ${embed.link}`)
						imageUrls.push(embed.link)
					} else {
						// 本地图片转换为 base64
						DebugLogger.debug(`处理本地图片: ${embed.link}`)
						const binary = await resolveEmbedAsBinary(embed)
						if (binary) {
							// 检测图片格式
							const uint8Array = new Uint8Array(binary)
							let mimeType = 'image/png'
							if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
								mimeType = 'image/jpeg'
							} else if (uint8Array[0] === 0x47 && uint8Array[1] === 0x49) {
								mimeType = 'image/gif'
							} else if (uint8Array[0] === 0x52 && uint8Array[1] === 0x49) {
								mimeType = 'image/webp'
							}
							
							const base64 = Buffer.from(binary).toString('base64')
							const dataUrl = `data:${mimeType};base64,${base64}`
							imageUrls.push(dataUrl)
							DebugLogger.debug(`本地图片已转换为 base64，格式: ${mimeType}`)
						}
					}
				} catch (error) {
					console.error('Failed to process embed image:', error)
				}
			}
		}
		
		// 添加图片到请求数据
		if (imageUrls.length > 0) {
			if (imageUrls.length > 10) {
				throw new Error('最多支持 10 张参考图片')
			}
			data.image = imageUrls.length === 1 ? imageUrls[0] : imageUrls
		}
		
		// 添加组图配置
		if (sequential_image_generation) {
			data.sequential_image_generation = sequential_image_generation
			if (sequential_image_generation === 'auto' && max_images) {
				data.sequential_image_generation_options = {
					max_images: Math.min(Math.max(max_images, 1), 15)
				}
			}
		}
		
		// 添加流式输出配置
		if (stream !== undefined) {
			data.stream = stream
		}
		
		// 添加提示词优化配置
		if (optimize_prompt_mode) {
			data.optimize_prompt_options = {
				mode: optimize_prompt_mode
			}
		}
		
		// 添加水印配置
		if (watermark !== undefined) {
			data.watermark = watermark
		}

		DebugLogger.debug('Request data:', JSON.stringify(data, null, 2))

		// 发送请求
		const response = await requestUrl({
			url: baseURL,
			method: 'POST',
			body: JSON.stringify(data),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})

		DebugLogger.debug('Response status:', response.status)
		DebugLogger.debug('Response headers:', response.headers)

		// 处理响应数据
		let responseData: any
		
		// 检查是否是流式响应（通过 Content-Type 判断）
		const contentType = response.headers['content-type'] || response.headers['Content-Type'] || ''
		const isStreamResponse = contentType.includes('text/event-stream') || stream === true
		
		if (isStreamResponse && typeof response.text === 'string') {
			// 解析 SSE (Server-Sent Events) 格式的流式响应
			DebugLogger.debug('Parsing SSE stream response')
			try {
				responseData = parseSSEResponse(response.text)
			} catch (error) {
				console.error('Failed to parse SSE response:', error)
				DebugLogger.debug('Raw response text:', response.text)
				throw new Error('解析流式响应失败，请尝试关闭流式输出选项')
			}
		} else {
			// 普通 JSON 响应
			responseData = response.json
		}

		DebugLogger.debug('Parsed response data:', responseData)

		if (!responseData.data || responseData.data.length === 0) {
			throw new Error(t('Failed to generate image. no data received from API'))
		}

		yield ' \n'
		const now = new Date()
		const formatTime =
			`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
			`_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

		// 处理返回的图片
		const imageCount = responseData.data.length
		if (imageCount > 1) {
			yield `生成了 ${imageCount} 张图片：\n\n`
		}

		for (let i = 0; i < imageCount; i++) {
			const imageData = responseData.data[i]
			const imageBase64 = imageData.b64_json || imageData.url
			
			if (!imageBase64) {
				console.error(`No image data returned for image ${i + 1}`)
				continue
			}

			let imageBuffer: ArrayBuffer
			if (imageData.b64_json) {
				// Base64 格式
				const buffer = Buffer.from(imageBase64, 'base64')
				imageBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
			} else {
				// URL 格式，需要下载图片
				try {
					const imgResponse = await requestUrl({ url: imageBase64, method: 'GET' })
					imageBuffer = imgResponse.arrayBuffer
				} catch (error) {
					console.error(`Failed to download image ${i + 1}:`, error)
					yield `❌ 图片 ${i + 1} 下载失败\n\n`
					continue
				}
			}

			// 多张图片时添加序号
			const indexFlag = imageCount > 1 ? `-${i + 1}` : ''
			const filename = `doubaoImage-${formatTime}${indexFlag}.png`
			DebugLogger.debug(`Saving image as ${filename}`)
			
			try {
				await saveAttachment(filename, imageBuffer)
				yield `![[${filename}|${displayWidth}]]\n\n`
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error)
				console.error(`Failed to save image ${i + 1}:`, error)
				yield `❌ 图片 ${i + 1} 保存失败: ${detail}\n\n`
			}
		}
	}

export const doubaoImageVendor: Vendor = {
	name: 'DoubaoImage',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
		model: DOUBAO_IMAGE_MODELS[0],
		displayWidth: DEFAULT_DOUBAO_IMAGE_OPTIONS.displayWidth,
		size: DEFAULT_DOUBAO_IMAGE_OPTIONS.size,
		response_format: DEFAULT_DOUBAO_IMAGE_OPTIONS.response_format,
		watermark: DEFAULT_DOUBAO_IMAGE_OPTIONS.watermark,
		sequential_image_generation: DEFAULT_DOUBAO_IMAGE_OPTIONS.sequential_image_generation,
		stream: DEFAULT_DOUBAO_IMAGE_OPTIONS.stream,
		optimize_prompt_mode: DEFAULT_DOUBAO_IMAGE_OPTIONS.optimize_prompt_mode,
		max_images: 5,
		parameters: {}
	} as DoubaoImageOptions,
	sendRequestFunc,
	models: DOUBAO_IMAGE_MODELS,
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Image Generation']
}
