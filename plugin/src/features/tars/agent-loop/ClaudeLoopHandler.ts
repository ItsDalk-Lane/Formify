/**
 * Anthropic Claude Provider 的工具调用循环处理器
 *
 * 从 claude.ts 中提取的循环逻辑，
 * 使用通用 ToolExecutor 接口替代直接 MCP 调用
 */

import Anthropic from '@anthropic-ai/sdk'
import { DebugLogger } from 'src/utils/DebugLogger'
import type {
	BaseOptions,
	Message,
	ResolveEmbedAsBinary,
	SendRequest,
} from '../providers'
import { CALLOUT_BLOCK_END, CALLOUT_BLOCK_START } from '../providers/utils'
import { normalizeProviderError } from '../providers/errors'
import type { ToolDefinition, ToolExecutor, ToolCallRequest } from './types'
import { resolveCurrentTools } from './OpenAILoopHandler'

/** 最大工具调用循环次数 */
const DEFAULT_MAX_TOOL_LOOPS = 10

/** 将工具定义转换为 Anthropic Claude 格式 */
export function toClaudeTools(tools: ToolDefinition[]): Array<{
	name: string
	description: string
	input_schema: Record<string, unknown>
}> {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}))
}

interface ClaudeLoopSettings extends BaseOptions {
	max_tokens: number
	enableThinking: boolean
	budget_tokens: number
}

type FormatMsgFn = (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => Promise<Anthropic.MessageParam>

/**
 * 为 Claude (Anthropic) Provider 包装工具调用循环支持
 *
 * 替代原来的 withAnthropicMcpToolCallSupport，使用通用 ToolExecutor 接口
 */
export function withClaudeToolCallLoopSupport(
	originalFactory: (settings: ClaudeLoopSettings) => SendRequest,
	formatMsgForClaudeAPI: FormatMsgFn,
): (settings: ClaudeLoopSettings) => SendRequest {
	return (settings: ClaudeLoopSettings): SendRequest => {
		const toolDefs = settings.tools as ToolDefinition[] | undefined
		const getToolsFn = settings.getTools
		const executor = settings.toolExecutor as ToolExecutor | undefined
		const hasStaticTools = Array.isArray(toolDefs) && toolDefs.length > 0
		const hasDynamicTools = typeof getToolsFn === 'function'
		if ((!hasStaticTools && !hasDynamicTools) || !executor) {
			return originalFactory(settings)
		}

		return async function* (messages, controller, resolveEmbedAsBinary) {
			try {
				const { parameters, ...optionsExcludingParams } = settings
				const options = { ...optionsExcludingParams, ...parameters } as ClaudeLoopSettings
				const {
					apiKey,
					baseURL: originalBaseURL,
					model,
					max_tokens = 8192,
					enableThinking = false,
					budget_tokens = 1600,
				} = options

				if (!apiKey) throw new Error('API key is required')

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

				const maxLoops =
					typeof settings.maxToolCallLoops === 'number' && settings.maxToolCallLoops > 0
						? settings.maxToolCallLoops
						: DEFAULT_MAX_TOOL_LOOPS

				for (let loop = 0; loop < maxLoops; loop++) {
					if (controller.signal.aborted) return
					const currentTools = await resolveCurrentTools(toolDefs, getToolsFn)
					const claudeTools = toClaudeTools(currentTools)

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
						return
					}

					const validBlocks = contentBlocks.filter(Boolean) as Anthropic.ContentBlock[]
					loopMessages.push({ role: 'assistant', content: validBlocks })

					const toolResultContents: Anthropic.ToolResultBlockParam[] = []
					const toolUseBlocks = validBlocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

					for (const toolBlock of toolUseBlocks) {
						const request: ToolCallRequest = {
							id: toolBlock.id,
							name: toolBlock.name,
							arguments: JSON.stringify(toolBlock.input),
						}

						let resultText: string
						try {
							const result = await executor!.execute(request, currentTools)
							resultText = result.content
						} catch (err) {
							resultText = `工具调用失败: ${err instanceof Error ? err.message : String(err)}`
							DebugLogger.error(`[AgentLoop/Claude] 工具执行失败: ${toolBlock.name}`, err)
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
				throw normalizeProviderError(error, 'Claude tool loop request failed')
			}
		}
	}
}
