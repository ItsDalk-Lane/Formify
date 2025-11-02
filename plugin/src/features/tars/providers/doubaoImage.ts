import { Notice, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'
import { DebugLogger } from '../../../utils/DebugLogger'

// 豆包图像生成支持的模型列表
const models = [
	'doubao-seedream-4-0-250828',
	'doubao-seedream-3.0-t2i'
]

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
	// 输入图片（支持单图或多图）
	inputImages?: string[]
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
	const lines = text.trim().split('\n')
	
	let currentEvent = ''
	let currentData = ''
	
	for (const line of lines) {
		if (line.startsWith('event:')) {
			currentEvent = line.substring(6).trim()
		} else if (line.startsWith('data:')) {
			currentData = line.substring(5).trim()
			
			// 如果是 [DONE] 标记，跳过
			if (currentData === '[DONE]') {
				continue
			}
			
			// 尝试解析 JSON 数据
			try {
				const jsonData = JSON.parse(currentData)
				
				// 如果是图片数据事件，添加到结果中
				if (currentEvent === 'image' || currentEvent === '' || jsonData.url || jsonData.b64_json) {
					result.push(jsonData)
				}
			} catch (error) {
				console.warn('Failed to parse SSE data line:', currentData, error)
			}
			
			// 重置
			currentEvent = ''
			currentData = ''
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
			optimize_prompt_mode,
			inputImages
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
		const prompt = lastMsg.content

		// 构建请求数据，严格按照官方 API 格式
		const data: Record<string, unknown> = {
			model,
			prompt,
			size,
			response_format
		}
		
		// 添加输入图片（支持消息中的图片和配置的图片）
		const imageUrls: string[] = []
		
		// 从配置中获取输入图片
		if (inputImages && inputImages.length > 0) {
			imageUrls.push(...inputImages)
		}
		
		// 从消息中提取嵌入的图片
		if (lastMsg.embeds && lastMsg.embeds.length > 0) {
			for (const embed of lastMsg.embeds) {
				try {
					// 尝试将图片转换为 base64
					const binary = await resolveEmbedAsBinary(embed)
					if (binary) {
						// 检测图片格式
						const uint8Array = new Uint8Array(binary)
						let mimeType = 'image/png'
						if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
							mimeType = 'image/jpeg'
						}
						const base64 = Buffer.from(binary).toString('base64')
						imageUrls.push(`data:${mimeType};
import { DebugLogger } from '../../../utils/DebugLogger';base64,${base64}`)
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
				console.error(`Failed to save image ${i + 1}:`, error)
				yield `❌ 图片 ${i + 1} 保存失败\n\n`
			}
		}
	}

export const doubaoImageVendor: Vendor = {
	name: 'DoubaoImage',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
		model: models[0],
		displayWidth: DEFAULT_DOUBAO_IMAGE_OPTIONS.displayWidth,
		size: DEFAULT_DOUBAO_IMAGE_OPTIONS.size,
		response_format: DEFAULT_DOUBAO_IMAGE_OPTIONS.response_format,
		watermark: DEFAULT_DOUBAO_IMAGE_OPTIONS.watermark,
		sequential_image_generation: DEFAULT_DOUBAO_IMAGE_OPTIONS.sequential_image_generation,
		stream: DEFAULT_DOUBAO_IMAGE_OPTIONS.stream,
		optimize_prompt_mode: DEFAULT_DOUBAO_IMAGE_OPTIONS.optimize_prompt_mode,
		max_images: 5,
		inputImages: [],
		parameters: {}
	} as DoubaoImageOptions,
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Image Generation']
}
