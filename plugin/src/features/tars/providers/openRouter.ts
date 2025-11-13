import { EmbedCache, Notice } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'
import { arrayBufferToBase64, getCapabilityEmoji, getMimeTypeFromFilename, CALLOUT_BLOCK_START, CALLOUT_BLOCK_END } from './utils'

// OpenRouter Reasoning Effort 级别
export type OpenRouterReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

// OpenRouter Reasoning Effort 选项
export const OPENROUTER_REASONING_EFFORT_OPTIONS: OpenRouterReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

/**
 * OpenRouter 选项接口
 * 扩展基础选项以支持网络搜索、图像生成和推理功能
 */
export interface OpenRouterOptions extends BaseOptions {
	// 网络搜索配置
	enableWebSearch: boolean
	webSearchEngine?: 'native' | 'exa' // 搜索引擎选择：native（原生）、exa 或 undefined（自动选择）
	webSearchMaxResults?: number // 搜索结果数量，默认为 5
	webSearchPrompt?: string // 自定义搜索提示文本
	
	// 图像生成配置（根据模型自动启用，无需手动开关）
	imageAspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' // 图片宽高比
	imageStream?: boolean // 是否启用流式图像生成
	imageResponseFormat?: 'url' | 'b64_json' // 图片返回格式
	imageSaveAsAttachment?: boolean // 是否保存为附件（false则返回URL）
	imageDisplayWidth?: number // 图片显示宽度
	
	// Reasoning 推理配置（支持 Responses API Beta）
	enableReasoning?: boolean // 是否启用推理功能
	reasoningEffort?: OpenRouterReasoningEffort // 推理努力级别：minimal/low/medium/high
}

/**
 * 判断模型是否支持图像生成
 * 严格按照 OpenRouter 的命名规则：只有模型名称包含 "image" 的模型才支持图像生成
 */
export const isImageGenerationModel = (model: string): boolean => {
	if (!model) return false

	// 严格检查：只有模型名称中包含 "image" 的才认为是图像生成模型
	// 这符合 OpenRouter 的命名规范，图像生成模型都会在名称中包含 "image" 关键字
	const modelName = model.toLowerCase()
	return modelName.includes('image')
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
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary, saveAttachment?: SaveAttachment) {
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
			imageAspectRatio,
			imageStream = false,
			imageResponseFormat = 'b64_json',
			imageSaveAsAttachment = true,
			imageDisplayWidth = 400,
			enableReasoning = false,
			reasoningEffort = 'medium',
			...remains 
		} = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		// 判断是否使用 Responses API（启用 Reasoning 时需要）
		const useResponsesAPI = enableReasoning
		
		// 确定使用的 API 端点
		let endpoint = baseURL
		if (useResponsesAPI && baseURL.includes('/chat/completions')) {
			// 启用 Reasoning 时，自动切换到 Responses API
			endpoint = baseURL.replace('/chat/completions', '/responses')
		}

		// 根据模型自动判断是否支持图像生成
		const supportsImageGeneration = isImageGenerationModel(model)

		// 检查是否是图像生成请求
		const isImageGenerationRequest = supportsImageGeneration || messages.some(msg =>
			msg.content?.toLowerCase().includes('生成图片') ||
			msg.content?.toLowerCase().includes('生成图像') ||
			msg.content?.toLowerCase().includes('generate image')
		)

		// 如果是图像生成但未提供 saveAttachment 且配置要保存为附件，则抛出错误
		if (isImageGenerationRequest && imageSaveAsAttachment && !saveAttachment) {
			throw new Error('图像生成需要 saveAttachment 函数支持')
		}

	const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary, useResponsesAPI)))
	
	// 构建请求数据
	const data: Record<string, unknown> = {
		model,
		// Reasoning 模式必须使用 stream，图像生成时根据配置决定
		stream: useResponsesAPI ? true : (imageStream || !isImageGenerationRequest),
	}
	
	// 根据 API 类型设置消息字段和参数
	if (useResponsesAPI) {
		// Responses API 使用 input 字段
		data.input = formattedMessages
		
		// Responses API 需要 max_output_tokens 而不是 max_tokens
		const remainsObj = remains as any
		if (remainsObj.max_tokens) {
			data.max_output_tokens = remainsObj.max_tokens
			// 从 remains 中移除 max_tokens，避免参数冲突
			const { max_tokens, ...otherParams } = remainsObj
			Object.assign(data, otherParams)
		} else {
			// 设置默认的 max_output_tokens
			data.max_output_tokens = 9000
			Object.assign(data, remains)
		}
		
		// 添加 reasoning 配置
		if (enableReasoning) {
			data.reasoning = {
				effort: reasoningEffort
			}
			new Notice(getCapabilityEmoji('Reasoning') + 'Reasoning 模式 (' + reasoningEffort + ')')
		}
	} else {
		// Chat Completions API 使用 messages 字段
		data.messages = formattedMessages
		Object.assign(data, remains)
	}

		// 如果模型支持图像生成，添加 modalities 和 image_config
		if (supportsImageGeneration) {
			data.modalities = ['image', 'text']
			
			// 配置图片宽高比
			if (imageAspectRatio) {
				data.image_config = {
					aspect_ratio: imageAspectRatio
				}
			}
			
			// 显示图像生成通知
			new Notice(getCapabilityEmoji('Image Generation') + '图像生成模式')
		}

		// 如果启用了网络搜索且模型不支持图像生成,配置 plugins 参数
		// 图像生成模式下不使用网络搜索
		if (enableWebSearch && !supportsImageGeneration) {
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

		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data),
			signal: controller.signal
		})

		// 检查响应是否成功
		if (!response.ok) {
			let errorText = await response.text()
			let errorMessage = `OpenRouter API 错误 (${response.status}): ${errorText}`
			
			// 尝试解析错误信息
			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error) {
					const error = errorJson.error
					errorMessage = error.message || errorText

					// 针对无效模型名称的特殊错误提示
					if (errorMessage.includes('invalid model name') || errorMessage.includes('invalid_model')) {
						errorMessage = `❌ 无效的模型名称：${model}\n\n推荐的图像生成模型：\n• google/gemini-2.5-flash-image-preview\n• google/gemini-2.0-flash-exp\n• openai/gpt-4o\n• anthropic/claude-3-5-sonnet\n\n请在 OpenRouter 设置中选择正确的模型名称。`
					}

					// 针对图像生成的特殊错误提示
					else if (supportsImageGeneration && (
						errorMessage.includes('modalities') ||
						errorMessage.includes('output_modalities') ||
						errorMessage.includes('not support')
					)) {
						errorMessage = `❌ 模型不支持图像生成：${errorMessage}\n\n请确保：\n1. 模型的 output_modalities 包含 "image"\n2. 在 OpenRouter 模型页面筛选支持图像生成的模型\n3. 推荐使用 google/gemini-2.5-flash-image-preview`
					}
				}
			} catch {
				// 如果不是 JSON 格式，使用原始错误文本
			}
			
			throw new Error(errorMessage)
		}

		// 检查是否为流式响应
		const contentType = response.headers.get('content-type') || ''
		const isStreamingResponse = contentType.includes('text/event-stream') || data.stream

		if (isStreamingResponse) {
			// 处理流式响应（Server-Sent Events）
			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error('Response body is not readable')
			}
			const decoder = new TextDecoder()
			let buffer = ''

			// 用于累积图像数据
			let hasGeneratedImages = false
			
			// 用于追踪推理过程状态
			let reasoningActive = false

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
								
								// 处理 Responses API 的推理过程（reasoning）
								if (useResponsesAPI && parsed.type) {
									const eventType = parsed.type as string
									
									// 处理推理内容
									if (eventType === 'response.reasoning.delta') {
										const reasoningText = parsed.delta
										if (reasoningText) {
											const prefix = !reasoningActive ? ((reasoningActive = true), CALLOUT_BLOCK_START) : ''
											const formattedReasoning = reasoningText.replace(/\n/g, '\n> ')
											yield prefix + formattedReasoning
										}
										continue
									}
									
									// 处理输出文本
									if (eventType === 'response.output_text.delta') {
										const content = parsed.delta
										if (content) {
											if (reasoningActive) {
												reasoningActive = false
												yield CALLOUT_BLOCK_END + content
											} else {
												yield content
											}
										}
										continue
									}
									
									// 处理完成事件
									if (eventType === 'response.completed' && reasoningActive) {
										reasoningActive = false
										yield CALLOUT_BLOCK_END
										continue
									}
								}

								// 处理 Chat Completions API 的文本内容
								const content = parsed.choices?.[0]?.delta?.content
								if (content) {
									yield content
								}

								// 处理图像内容（流式）- 根据官方文档
								const delta = parsed.choices?.[0]?.delta

								if (delta?.images) {
									const images = delta.images

									// 处理流式图像（每个图像块都处理）
									for (let i = 0; i < images.length; i++) {
										const image = images[i]
										const imageUrl = image.image_url?.url

										if (!imageUrl) {
											console.warn('流式图像数据缺失 URL')
											continue
										}

										console.log('收到流式图像数据:', imageUrl.substring(0, 50) + '...')

										// 如果配置为保存为附件
										if (imageSaveAsAttachment && saveAttachment) {
											try {
												if (imageUrl.startsWith('data:')) {
													const base64Data = imageUrl.split(',')[1]
													const buffer = Buffer.from(base64Data, 'base64')
													const arrayBuffer = buffer.buffer.slice(
														buffer.byteOffset,
														buffer.byteOffset + buffer.byteLength
													)

													// 生成文件名
													const now = new Date()
													const formatTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
													const indexFlag = images.length > 1 ? `-${i + 1}` : ''
													const filename = `openrouter-${formatTime}${indexFlag}.png`

													await saveAttachment(filename, arrayBuffer)
													yield `![[${filename}|${imageDisplayWidth}]]\n\n`
												} else {
													yield `⚠️ 检测到 URL 格式图片，但配置为保存附件。请手动下载：\n${imageUrl}\n\n`
												}
											} catch (error) {
												console.error('保存流式图片失败:', error)
												yield `❌ 图片保存失败，URL: ${imageUrl}\n\n`
											}
										} else {
											if (imageUrl.startsWith('data:')) {
												yield `📷 生成的图片（Base64格式）：\n${imageUrl.substring(0, 100)}...\n\n`
											} else {
												yield `📷 生成的图片：\n${imageUrl}\n\n`
											}
										}
									}
								}

								// 处理网络搜索的 annotations（URL citations）
								// OpenRouter 会在消息中返回 url_citation 注释
								if (parsed.choices?.[0]?.message?.annotations) {
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
				if (reasoningActive) {
					reasoningActive = false
					yield CALLOUT_BLOCK_END
				}
				reader.cancel()
			}
		} else {
			// 处理非流式响应（JSON 格式）
			const responseText = await response.text()
			try {
				const parsed = JSON.parse(responseText)

				// 处理文本内容
				const content = parsed.choices?.[0]?.message?.content
				if (content) {
					yield content
				}

				// 处理图像内容
				const message = parsed.choices?.[0]?.message
				if (message?.images) {
					const images = message.images

					yield '\n\n'

					// 处理生成的图像
					for (let i = 0; i < images.length; i++) {
						const image = images[i]
						const imageUrl = image.image_url?.url

						if (!imageUrl) {
							console.warn('图像数据缺失 URL')
							continue
						}

						// 如果配置为保存为附件
						if (imageSaveAsAttachment && saveAttachment) {
							try {
								// 从 base64 data URL 中提取数据
								if (imageUrl.startsWith('data:')) {
									const base64Data = imageUrl.split(',')[1]
									const buffer = Buffer.from(base64Data, 'base64')
									const arrayBuffer = buffer.buffer.slice(
										buffer.byteOffset,
										buffer.byteOffset + buffer.byteLength
									)

									// 生成文件名
									const now = new Date()
									const formatTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
									const indexFlag = images.length > 1 ? `-${i + 1}` : ''
									const filename = `openrouter-${formatTime}${indexFlag}.png`

									// 保存附件
									await saveAttachment(filename, arrayBuffer)

									// 输出图片引用
									yield `![[${filename}|${imageDisplayWidth}]]\n\n`
								} else {
									// 如果是 URL 形式但配置要保存为附件，需要下载
									yield `⚠️ 检测到 URL 格式图片，但配置为保存附件。请手动下载：\n${imageUrl}\n\n`
								}
							} catch (error) {
								console.error('保存图片失败:', error)
								yield `❌ 图片保存失败，URL: ${imageUrl}\n\n`
							}
						} else {
							// 直接输出 URL 或 base64
							if (imageUrl.startsWith('data:')) {
								yield `📷 生成的图片（Base64格式）：\n${imageUrl.substring(0, 100)}...\n\n`
							} else {
								yield `📷 生成的图片：\n${imageUrl}\n\n`
							}
						}
					}
				}

				// 处理网络搜索的 annotations（URL citations）
				if (message?.annotations) {
					const annotations = message.annotations
					for (const annotation of annotations) {
						if (annotation.type === 'url_citation') {
							const citation = annotation.url_citation
							// 可以选择在这里处理引用信息
							// DebugLogger.debug('Web search citation', {
							// 	url: citation.url,
							// 	title: citation.title,
							// 	content: citation.content
							// })
						}
					}
				}

				// 如果既没有文本也没有图像，确保至少输出一些内容
				if (!content && !message?.images) {
					yield '📷 图像生成完成，但没有可显示的内容。'
				}
			} catch (error) {
				console.error('解析非流式响应失败:', error)
				throw new Error(`解析响应失败: ${error.message}`)
			}
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
	| { type: 'input_text'; text: string }
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
 * Responses API 使用 input_text 类型，Chat Completions API 使用 text 类型
 */
const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary, useResponsesAPI = false) => {
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
		if (useResponsesAPI) {
			content.push({
				type: 'input_text' as const,
				text: sanitizedText
			})
		} else {
			content.push({
				type: 'text' as const,
				text: sanitizedText
			})
		}
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
		model: '', // 默认为空，由用户选择模型
		enableWebSearch: false,
		webSearchEngine: undefined, // undefined 表示自动选择：OpenAI 和 Anthropic 使用 native，其他使用 exa
		webSearchMaxResults: 5,
		webSearchPrompt: undefined,
		imageAspectRatio: '1:1',
		imageStream: false,
		imageResponseFormat: 'b64_json',
		imageSaveAsAttachment: true,
		imageDisplayWidth: 400,
		enableReasoning: false,
		reasoningEffort: 'medium',
		parameters: {}
	} as OpenRouterOptions,
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://openrouter.ai',
	capabilities: ['Text Generation', 'Image Vision', 'PDF Vision', 'Web Search', 'Image Generation', 'Reasoning']
}

