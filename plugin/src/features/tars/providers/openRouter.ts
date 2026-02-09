import { EmbedCache, Notice } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'
import { arrayBufferToBase64, buildReasoningBlockStart, buildReasoningBlockEnd, buildToolCallsBlock, getCapabilityEmoji, getMimeTypeFromFilename } from './utils'
import { withToolMessageContext } from './messageFormat'

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
 * 检查模型是否同时支持图像输入和图像输出
 */
export const isImageGenerationModel = (model: string): boolean => {
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
		const toolCalls: Array<{ id: string; name: string; argumentsText: string }> = []
		const ensureToolCall = (id: string, name: string) => {
			let existing = toolCalls.find((t) => t.id === id)
			if (!existing) {
				existing = { id, name, argumentsText: '' }
				toolCalls.push(existing)
			}
			return existing
		}

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

		// 如果是图像生成但未提供 saveAttachment 且配置要保存为附件，则抛出警告而非错误
		if (isImageGenerationRequest && imageSaveAsAttachment && !saveAttachment) {
			console.warn('⚠️ 图像生成配置为保存附件，但未提供 saveAttachment 函数，将返回 URL 格式')
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
		// Responses API 使用 input 字段，格式为消息数组
		data.input = formattedMessages.map(msg => ({
			type: 'message',
			role: msg.role,
			content: Array.isArray(msg.content) ? msg.content : [{ type: 'input_text', text: msg.content }]
		}))

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
			new Notice(getCapabilityEmoji('Reasoning') + '推理模式 (' + reasoningEffort + ') - 模型: ' + model)
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
			
			// 针对 403 Forbidden 错误的特殊处理
			if (response.status === 403) {
				errorMessage = `❌ OpenRouter API 访问被拒绝 (403 Forbidden)\n\n可能的原因：\n` +
					`1. API Key 无效或已过期\n` +
					`2. API Key 没有访问此模型的权限\n` +
					`3. 账户余额不足或超出配额\n` +
					`4. API Key 格式错误（应该是 sk-or-v1-xxxxxx）\n\n` +
					`解决方法：\n` +
					`• 在 OpenRouter 设置中检查 API Key 是否正确\n` +
					`• 访问 https://openrouter.ai/keys 验证 API Key\n` +
					`• 访问 https://openrouter.ai/credits 检查账户余额\n` +
					`• 确认模型访问权限：${model}`
				
				// 尝试解析更详细的错误信息
				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage += `\n\nAPI 返回的详细错误：${errorJson.error.message}`
					}
				} catch {
					// 忽略 JSON 解析错误
				}
				
				throw new Error(errorMessage)
			}
			
			// 针对 401 Unauthorized 错误的特殊处理
			if (response.status === 401) {
				errorMessage = `❌ OpenRouter API 认证失败 (401 Unauthorized)\n\n` +
					`API Key 未提供或无效。\n\n` +
					`解决方法：\n` +
					`• 在插件设置 > OpenRouter 中配置有效的 API Key\n` +
					`• 访问 https://openrouter.ai/keys 获取或创建新的 API Key\n` +
					`• 确保 API Key 格式正确（sk-or-v1-xxxxxx）`
				
				throw new Error(errorMessage)
			}
			
			// 尝试解析其他错误信息
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
					
					// 针对速率限制错误
					else if (response.status === 429 || errorMessage.includes('rate limit')) {
						errorMessage = `❌ 请求频率超限 (429 Too Many Requests)\n\n` +
							`您的请求过于频繁。\n\n` +
							`解决方法：\n` +
							`• 稍等片刻后再试\n` +
							`• 检查账户配额限制\n` +
							`• 考虑升级 OpenRouter 账户套餐`
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
			let reasoningStartMs: number | null = null

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
								if (useResponsesAPI) {
									// 首先检查推理内容字段（参考 Doubao/Kimi 模式）
									const reasonContent = parsed.reasoning_content || parsed.delta?.reasoning_content
									if (reasonContent) {
										if (!reasoningActive) {
											reasoningActive = true
											reasoningStartMs = Date.now()
											yield buildReasoningBlockStart(reasoningStartMs)
										}
										yield reasonContent // 直接输出，不加任何前缀
										continue
									}

									// 同时支持 OpenRouter 特有的事件类型
									if (parsed.type) {
										const eventType = parsed.type as string

										// 处理推理内容
										if (eventType === 'response.reasoning.delta' || eventType === 'response.reasoning_text.delta') {
											const reasoningText = parsed.delta
											if (reasoningText) {
												if (!reasoningActive) {
													reasoningActive = true
													reasoningStartMs = Date.now()
													yield buildReasoningBlockStart(reasoningStartMs)
												}
												yield reasoningText // 直接输出，不加任何前缀
											}
											continue
										}

										// 处理输出文本
										if (eventType === 'response.output_text.delta') {
											const content = parsed.delta
											if (content) {
												if (reasoningActive) {
													reasoningActive = false
													const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
													reasoningStartMs = null
													yield buildReasoningBlockEnd(durationMs)
												}
												yield content
											}
											continue
										}

										// 处理完成事件
										if (eventType === 'response.completed' && reasoningActive) {
											reasoningActive = false
											const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
											reasoningStartMs = null
											yield buildReasoningBlockEnd(durationMs)
											continue
										}
									}
								}

								// 处理 Chat Completions API 的文本内容
								const content = parsed.choices?.[0]?.delta?.content
								if (content) {
									yield content
								}

								// 处理 Chat Completions API 的工具调用（OpenAI 风格 tool_calls）
								const deltaToolCalls: any[] | undefined = parsed.choices?.[0]?.delta?.tool_calls
								if (Array.isArray(deltaToolCalls)) {
									for (const tc of deltaToolCalls) {
										const id = String(tc?.id ?? '')
										const name = String(tc?.function?.name ?? '')
										const argsChunk = String(tc?.function?.arguments ?? '')
										if (!id || !name) continue
										const acc = ensureToolCall(id, name)
										acc.argumentsText += argsChunk
									}
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
									continue
								}

								hasGeneratedImages = true

								// 如果配置为保存为附件
								if (imageSaveAsAttachment && saveAttachment) {
								try {
									if (imageUrl.startsWith('data:')) {
										const base64Data = imageUrl.split(',')[1]
											if (!base64Data) {
												throw new Error('无效的 base64 数据')
											}
											
											// 使用 Uint8Array 替代 Buffer (更兼容浏览器环境)
											const binaryString = atob(base64Data)
											const bytes = new Uint8Array(binaryString.length)
											for (let j = 0; j < binaryString.length; j++) {
												bytes[j] = binaryString.charCodeAt(j)
											}
											const arrayBuffer = bytes.buffer

											// 生成文件名
											const now = new Date()
											const formatTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
											const indexFlag = images.length > 1 ? `-${i + 1}` : ''
										const filename = `openrouter-${formatTime}${indexFlag}.png`

										await saveAttachment(filename, arrayBuffer)
										yield `![[${filename}|${imageDisplayWidth}]]\n\n`
										} else {
											yield `⚠️ 检测到 URL 格式图片，但配置为保存附件。图片 URL：${imageUrl}\n\n`
										}
									} catch (error) {
										console.error('❌ 保存流式图片失败:', error)
										const errorMsg = error instanceof Error ? error.message : String(error)
										yield `❌ 图片保存失败: ${errorMsg}\n\n`
									}
								} else {
									if (imageUrl.startsWith('data:')) {
										yield `📷 生成的图片（Base64 格式，长度: ${imageUrl.length}）\n\n`
									} else {
										yield `📷 生成的图片 URL：${imageUrl}\n\n`
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
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					reasoningStartMs = null
					yield buildReasoningBlockEnd(durationMs)
				}

				if (toolCalls.length > 0) {
					const payload = toolCalls.map((tc) => {
						let parsedArgs: any = null
						try {
							parsedArgs = tc.argumentsText ? JSON.parse(tc.argumentsText) : {}
						} catch {
							parsedArgs = { __raw: tc.argumentsText }
						}
						return {
							id: tc.id,
							name: tc.name,
							arguments: parsedArgs
						}
					})
					yield buildToolCallsBlock(payload)
				}
				reader.cancel()
			}
		} else {
			// 处理非流式响应（JSON 格式）
			const responseText = await response.text()
			try {
				const parsed = JSON.parse(responseText)

				// 处理 Responses API 的非流式响应
				if (useResponsesAPI && parsed.output) {
					let hasReasoning = false
					let reasoningDurationMs = 0
					let finalText = ''
					let reasoningText = ''

					// 遍历 output 数组处理推理和文本内容
					for (const output of parsed.output) {
						if (output.type === 'reasoning') {
							if (!hasReasoning) {
								hasReasoning = true
								reasoningDurationMs = 10
								finalText += buildReasoningBlockStart(Date.now())
							}
							// 处理主要的推理内容
							if (output.content && Array.isArray(output.content)) {
								for (const contentItem of output.content) {
									if (contentItem.type === 'input_text' && contentItem.text) {
										reasoningText += contentItem.text
									}
								}
							}
							// 如果有 summary，显示摘要
							if (output.summary && Array.isArray(output.summary)) {
								for (const summaryItem of output.summary) {
									reasoningText += '\n' + summaryItem
								}
							}
							finalText += reasoningText
						} else if (output.type === 'message' && output.content) {
							const textContent = output.content.find((item: any) => item.type === 'output_text')?.text
							if (textContent) {
								if (hasReasoning) {
									finalText += buildReasoningBlockEnd(reasoningDurationMs)
								}
								finalText += textContent
							}
						}
					}

					if (finalText) {
						yield finalText
					}
				} else {
					// 处理 Chat Completions API 的文本内容
					const content = parsed.choices?.[0]?.message?.content
					if (content) {
						yield content
					}
				}

				// 处理图像内容（仅在 Chat Completions API 中）
				if (!useResponsesAPI) {
					const message = parsed.choices?.[0]?.message
					const content = parsed.choices?.[0]?.message?.content

					if (message?.images) {
						const images = message.images

						yield '\n\n'

						// 处理生成的图像
						for (let i = 0; i < images.length; i++) {
							const image = images[i]
							const imageUrl = image.image_url?.url

							if (!imageUrl) {
								continue
							}

							// 如果配置为保存为附件
							if (imageSaveAsAttachment && saveAttachment) {
								try {
									// 从 base64 data URL 中提取数据
									if (imageUrl.startsWith('data:')) {
										const base64Data = imageUrl.split(',')[1]
										if (!base64Data) {
											throw new Error('无效的 base64 数据')
										}
										
										// 使用 Uint8Array 替代 Buffer (更兼容浏览器环境)
										const binaryString = atob(base64Data)
										const bytes = new Uint8Array(binaryString.length)
										for (let j = 0; j < binaryString.length; j++) {
											bytes[j] = binaryString.charCodeAt(j)
										}
										const arrayBuffer = bytes.buffer

										// 生成文件名
										const now = new Date()
										const formatTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
										const indexFlag = images.length > 1 ? `-${i + 1}` : ''
										const filename = `openrouter-${formatTime}${indexFlag}.png`

										// 保存附件到系统附件文件夹
										await saveAttachment(filename, arrayBuffer)

										// 输出图片引用
										yield `![[${filename}|${imageDisplayWidth}]]\n\n`
									} else {
										// 如果是 URL 形式但配置要保存为附件
										yield `⚠️ 检测到 URL 格式图片，但配置为保存附件。图片 URL：${imageUrl}\n\n`
									}
								} catch (error) {
									const errorMsg = error instanceof Error ? error.message : String(error)
								}
							} else {
								// 直接输出 URL 或 base64
								if (imageUrl.startsWith('data:')) {
									yield `📷 生成的图片（Base64 格式，长度: ${imageUrl.length}）\n\n`
								} else {
									yield `📷 生成的图片 URL：${imageUrl}\n\n`
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

					// 如果既没有文本也没有图像，提示用户
					if (!content && !message?.images) {
						if (supportsImageGeneration) {
							yield '⚠️ 图像生成请求完成，但 API 未返回图片数据。请检查模型配置或提示词。'
						}
					}
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
		return withToolMessageContext(msg, {
			role: msg.role,
			content: msg.content
		})
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
	
	return withToolMessageContext(msg, {
		role: msg.role,
		content
	})
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
	capabilities: ['Text Generation', 'Image Vision', 'PDF Vision', 'Web Search', 'Image Generation', 'Tool Calling', 'Reasoning']
}
