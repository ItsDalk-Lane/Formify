import Anthropic from '@anthropic-ai/sdk'
import { EmbedCache } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, McpCallToolFnForProvider, McpToolDefinitionForProvider, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import {
	arrayBufferToBase64,
	CALLOUT_BLOCK_END,
	CALLOUT_BLOCK_START,
	getMimeTypeFromFilename
} from './utils'
import { normalizeProviderError } from './errors'
import { withRetry } from './retry'
import { toClaudeTools, findToolServerId, resolveCurrentMcpTools } from '../mcp/mcpToolCallHandler'

export interface ClaudeOptions extends BaseOptions {
	max_tokens: number
	enableWebSearch: boolean
	enableThinking: boolean
	budget_tokens: number
}

const formatMsgForClaudeAPI = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const content: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] = msg.embeds
		? await Promise.all(msg.embeds.map((embed) => formatEmbed(embed, resolveEmbedAsBinary)))
		: []

	if (msg.content.trim()) {
		content.push({
			type: 'text',
			text: msg.content
		})
	}

	return {
		role: msg.role as 'user' | 'assistant',
		content
	}
}

const formatEmbed = async (embed: EmbedCache, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const mimeType = getMimeTypeFromFilename(embed.link)
	if (mimeType === 'application/pdf') {
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'document',
			source: {
				type: 'base64',
				media_type: mimeType,
				data: base64Data
			}
		} as Anthropic.DocumentBlockParam
	} else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'image',
			source: {
				type: 'base64',
				media_type: mimeType,
				data: base64Data
			}
		} as Anthropic.ImageBlockParam
	} else {
		throw new Error(t('Only PNG, JPEG, GIF, WebP, and PDF files are supported.'))
	}
}

const sendRequestFuncBase = (settings: ClaudeOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		try {
			const { parameters, ...optionsExcludingParams } = settings
			const options = { ...optionsExcludingParams, ...parameters }
			const {
				apiKey,
				baseURL: originalBaseURL,
				model,
				max_tokens,
				enableWebSearch: _enableWebSearch = false,
				enableThinking = false,
				budget_tokens = 1600
			} = options
			let baseURL = originalBaseURL
			if (!apiKey) throw new Error(t('API key is required'))

			// Remove /v1/messages from baseURL if present, as Anthropic SDK will add it automatically
			if (baseURL.endsWith('/v1/messages/')) {
				baseURL = baseURL.slice(0, -'/v1/messages/'.length)
			} else if (baseURL.endsWith('/v1/messages')) {
				baseURL = baseURL.slice(0, -'/v1/messages'.length)
			}

			const [system_msg, messagesWithoutSys] =
				messages[0].role === 'system' ? [messages[0], messages.slice(1)] : [null, messages]

			// Check if messagesWithoutSys only contains user or assistant roles
			messagesWithoutSys.forEach((msg) => {
				if (msg.role === 'system') {
					throw new Error('System messages are only allowed as the first message')
				}
			})

			const formattedMsgs = await Promise.all(
				messagesWithoutSys.map((msg) => formatMsgForClaudeAPI(msg, resolveEmbedAsBinary))
			)

			const client = new Anthropic({
				apiKey,
				baseURL,
				fetch: globalThis.fetch,
				dangerouslyAllowBrowser: true
			})

			const requestParams: Anthropic.MessageCreateParams = {
				model,
				max_tokens,
				messages: formattedMsgs,
				stream: true,
				...(system_msg && { system: system_msg.content }),
				...(enableThinking && {
					thinking: {
						type: 'enabled',
						budget_tokens
					}
				})
			}

			const stream = await withRetry(
				() =>
					client.messages.create(requestParams, {
						signal: controller.signal
					}),
				{ signal: controller.signal }
			)

			let startReasoning = false
			for await (const messageStreamEvent of stream) {
				// DebugLogger.debug('ClaudeNew messageStreamEvent', messageStreamEvent)

				// Handle different types of stream events
				if (messageStreamEvent.type === 'content_block_delta') {
					if (messageStreamEvent.delta.type === 'text_delta') {
						if (startReasoning) {
							startReasoning = false
							yield CALLOUT_BLOCK_END + messageStreamEvent.delta.text
						} else {
							yield messageStreamEvent.delta.text
						}
					}
					if (messageStreamEvent.delta.type === 'thinking_delta') {
						const prefix = !startReasoning ? ((startReasoning = true), CALLOUT_BLOCK_START) : ''
						yield prefix + messageStreamEvent.delta.thinking.replace(/\n/g, '\n> ') // Each line of the callout needs to have '>' at the beginning
					}
				} else if (messageStreamEvent.type === 'message_delta') {
					// Handle message-level incremental updates
					// DebugLogger.debug('Message delta received', messageStreamEvent.delta)
					// Check stop reason and notify user
					if (messageStreamEvent.delta.stop_reason) {
						const stopReason = messageStreamEvent.delta.stop_reason
						if (stopReason !== 'end_turn') {
							throw new Error(`🔴 Unexpected stop reason: ${stopReason}`)
						}
					}
				}
			}
		} catch (error) {
			throw normalizeProviderError(error, 'Claude request failed')
		}
	}

/** 最大工具调用循环次数（与 OpenAI MCP 路径保持一致） */
const CLAUDE_MAX_TOOL_LOOPS = 10

/**
 * 为 Claude (Anthropic) Provider 包装 MCP 工具调用支持
 * 使用 Anthropic 原生的 tool_use / tool_result 内容块格式
 */
function withAnthropicMcpToolCallSupport(
	originalFactory: (settings: ClaudeOptions) => SendRequest,
): (settings: ClaudeOptions) => SendRequest {
	return (settings: ClaudeOptions): SendRequest => {
		const mcpTools = settings.mcpTools as McpToolDefinitionForProvider[] | undefined
		const mcpGetTools = settings.mcpGetTools
		const mcpCallTool = settings.mcpCallTool as McpCallToolFnForProvider | undefined
		const hasStaticTools = Array.isArray(mcpTools) && mcpTools.length > 0
		const hasDynamicTools = typeof mcpGetTools === 'function'
		if ((!hasStaticTools && !hasDynamicTools) || !mcpCallTool) {
			return originalFactory(settings)
		}

		return async function* (messages, controller, resolveEmbedAsBinary) {
			try {
				const { parameters, ...optionsExcludingParams } = settings
				const options = { ...optionsExcludingParams, ...parameters } as ClaudeOptions
				const {
					apiKey,
					baseURL: originalBaseURL,
					model,
					max_tokens = 8192,
					enableThinking = false,
					budget_tokens = 1600,
				} = options

				if (!apiKey) throw new Error(t('API key is required'))

				let baseURL = originalBaseURL as string
				if (baseURL.endsWith('/v1/messages/')) {
					baseURL = baseURL.slice(0, -'/v1/messages/'.length)
				} else if (baseURL.endsWith('/v1/messages')) {
					baseURL = baseURL.slice(0, -'/v1/messages'.length)
				}

				const client = new Anthropic({ apiKey, baseURL, fetch: globalThis.fetch, dangerouslyAllowBrowser: true })

				const [systemMsg, nonSystemMsgs] =
					messages[0]?.role === 'system' ? [messages[0], messages.slice(1)] : [null, messages]

				let loopMessages: Anthropic.MessageParam[] = await Promise.all(
					nonSystemMsgs.map((msg) => formatMsgForClaudeAPI(msg, resolveEmbedAsBinary))
				)

				for (let loop = 0; loop < CLAUDE_MAX_TOOL_LOOPS; loop++) {
					if (controller.signal.aborted) return
					const currentMcpTools = await resolveCurrentMcpTools(mcpTools, mcpGetTools)
					const claudeTools = toClaudeTools(currentMcpTools)

					const stream = await client.messages.create(
						{
							model: model as string,
							max_tokens: max_tokens as number,
							messages: loopMessages,
							tools: claudeTools,
							stream: true,
							...(systemMsg && { system: systemMsg.content }),
							...(enableThinking && { thinking: { type: 'enabled', budget_tokens: budget_tokens as number } }),
						},
						{ signal: controller.signal },
					)

					const contentBlocks: Anthropic.ContentBlock[] = []
					const toolInputJsonBuffers: Record<number, string> = {}
					let hasToolUse = false
					let startReasoning = false

					for await (const event of stream) {
						const e = event as any
						if (e.type === 'content_block_start') {
							const block = e.content_block
							if (block.type === 'tool_use') {
								hasToolUse = true
								contentBlocks[e.index] = { type: 'tool_use', id: block.id, name: block.name, input: {} } as Anthropic.ToolUseBlock
								toolInputJsonBuffers[e.index] = ''
							} else if (block.type === 'text') {
								contentBlocks[e.index] = { type: 'text', text: '' } as Anthropic.TextBlock
							} else if (block.type === 'thinking') {
								contentBlocks[e.index] = { type: 'thinking', thinking: '' } as any
							}
						} else if (e.type === 'content_block_delta') {
							const delta = e.delta
							if (delta.type === 'text_delta') {
								const text: string = delta.text ?? ''
								if ((contentBlocks[e.index] as Anthropic.TextBlock)?.type === 'text') {
									(contentBlocks[e.index] as Anthropic.TextBlock).text += text
								}
								if (text && !hasToolUse) {
									if (startReasoning) {
										startReasoning = false
										yield CALLOUT_BLOCK_END + text
									} else {
										yield text
									}
								}
							} else if (delta.type === 'input_json_delta') {
								toolInputJsonBuffers[e.index] = (toolInputJsonBuffers[e.index] ?? '') + (delta.partial_json ?? '')
							} else if (delta.type === 'thinking_delta') {
								const prefix = !startReasoning ? ((startReasoning = true), CALLOUT_BLOCK_START) : ''
								yield prefix + (delta.thinking ?? '').replace(/\n/g, '\n> ')
							}
						} else if (e.type === 'content_block_stop') {
							const block = contentBlocks[e.index]
							if (block?.type === 'tool_use' && toolInputJsonBuffers[e.index] !== undefined) {
								try {
									(block as Anthropic.ToolUseBlock).input = JSON.parse(toolInputJsonBuffers[e.index] || '{}')
								} catch {
									// JSON 解析失败时保留空 input
								}
							}
						} else if (e.type === 'message_delta') {
							if (startReasoning) {
								startReasoning = false
								yield CALLOUT_BLOCK_END
							}
							const stopReason = e.delta?.stop_reason
							if (stopReason && stopReason !== 'end_turn' && stopReason !== 'tool_use') {
								throw new Error(`🔴 Unexpected stop reason: ${stopReason}`)
							}
						}
					}

					if (!hasToolUse) {
						// 无工具调用，文本已实时 yield，结束
						return
					}

					// 将本轮 assistant 内容块追加到循环消息
					const validBlocks = contentBlocks.filter(Boolean) as Anthropic.ContentBlock[]
					loopMessages.push({ role: 'assistant', content: validBlocks })

					// 依次执行 tool_use 块并收集 tool_result
					const toolResultContents: Anthropic.ToolResultBlockParam[] = []
					const toolUseBlocks = validBlocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

					for (const toolBlock of toolUseBlocks) {
						const serverId = findToolServerId(toolBlock.name, currentMcpTools)
						let resultText: string
						if (!serverId) {
							resultText = `错误: 未找到工具 "${toolBlock.name}"`
						} else {
							try {
								resultText = await mcpCallTool(serverId, toolBlock.name, toolBlock.input as Record<string, unknown>)
							} catch (err) {
								resultText = `工具调用失败: ${err instanceof Error ? err.message : String(err)}`
							}
						}
						toolResultContents.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: resultText })
						yield `{{FF_MCP_TOOL_START}}:${toolBlock.name}:${resultText}{{FF_MCP_TOOL_END}}:`
					}

					loopMessages.push({ role: 'user', content: toolResultContents })
				}

				// 达到最大循环次数，做最后一次请求（不带工具）
				const finalStream = await client.messages.create(
					{
						model: model as string,
						max_tokens: max_tokens as number,
						messages: loopMessages,
						stream: true,
						...(systemMsg && { system: systemMsg.content }),
						...(enableThinking && { thinking: { type: 'enabled', budget_tokens: budget_tokens as number } }),
					},
					{ signal: controller.signal },
				)

				let finalStartReasoning = false
				for await (const event of finalStream) {
					const e = event as any
					if (e.type === 'content_block_delta') {
						if (e.delta?.type === 'text_delta') {
							if (finalStartReasoning) {
								finalStartReasoning = false
								yield CALLOUT_BLOCK_END + (e.delta.text ?? '')
							} else {
								yield e.delta.text ?? ''
							}
						} else if (e.delta?.type === 'thinking_delta') {
							const prefix = !finalStartReasoning ? ((finalStartReasoning = true), CALLOUT_BLOCK_START) : ''
							yield prefix + (e.delta.thinking ?? '').replace(/\n/g, '\n> ')
						}
					}
				}
			} catch (error) {
				if (controller.signal.aborted) return
				throw normalizeProviderError(error, 'Claude MCP request failed')
			}
		}
	}
}

const sendRequestFunc = withAnthropicMcpToolCallSupport(sendRequestFuncBase)

export const CLAUDE_MODELS = [
	'claude-sonnet-4-0',
	'claude-opus-4-0',
	'claude-3-7-sonnet-latest',
	'claude-3-5-sonnet-latest',
	'claude-3-opus-latest',
	'claude-3-5-haiku-latest'
]

export const claudeVendor: Vendor = {
	name: 'Claude',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.anthropic.com',
		model: CLAUDE_MODELS[0],
		max_tokens: 8192,
		enableWebSearch: false,
		enableThinking: false,
		budget_tokens: 1600,
		parameters: {}
	} as ClaudeOptions,
	sendRequestFunc,
	models: CLAUDE_MODELS,
	websiteToObtainKey: 'https://console.anthropic.com',
	capabilities: ['Text Generation', 'Web Search', 'Reasoning', 'Image Vision', 'PDF Vision']
}
