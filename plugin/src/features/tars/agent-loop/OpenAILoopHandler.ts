/**
 * OpenAI 兼容 Provider 的工具调用循环处理器
 *
 * 从 mcpToolCallHandler.ts 中提取的循环逻辑，
 * 使用通用 ToolExecutor 接口替代直接 MCP 调用
 */

import OpenAI from 'openai'
import { DebugLogger } from 'src/utils/DebugLogger'
import type {
	BaseOptions,
	Message,
	ResolveEmbedAsBinary,
	SaveAttachment,
	SendRequest,
} from '../providers'
import {
	convertEmbedToImageUrl,
	REASONING_BLOCK_START_MARKER,
	REASONING_BLOCK_END_MARKER,
} from '../providers/utils'
import type { ToolDefinition, ToolExecutor, GetToolsFn, ToolCallRequest } from './types'

/** 工具调用循环最大次数（默认值） */
const DEFAULT_MAX_TOOL_CALL_LOOPS = 10

/** OpenAI 兼容格式的工具定义 */
export interface OpenAIToolDefinition {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}

/** OpenAI 工具调用响应 */
export interface OpenAIToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

/** 多模态内容项（文本或图片） */
export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }

/** 工具调用循环中的消息 */
export interface ToolLoopMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string | null | ContentPart[]
	tool_calls?: OpenAIToolCall[]
	tool_call_id?: string
	name?: string
	reasoning_content?: string
	reasoning?: string
	reasoning_details?: unknown
}

/** 将工具定义转换为 OpenAI 兼容格式 */
export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolDefinition[] {
	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}))
}

/** 解析当前可用工具集（支持动态刷新） */
export async function resolveCurrentTools(
	staticTools: ToolDefinition[] | undefined,
	getTools?: GetToolsFn,
): Promise<ToolDefinition[]> {
	if (typeof getTools === 'function') {
		try {
			const nextTools = await getTools()
			if (Array.isArray(nextTools) && nextTools.length > 0) {
				return nextTools
			}
		} catch (error) {
			DebugLogger.warn('[AgentLoop] 读取动态工具集失败，回退静态工具集', error)
		}
	}

	return Array.isArray(staticTools) ? staticTools : []
}

// ─── 工具调用检测与累积 ────────────────────────────────────────

function accumulateToolCall(
	toolCallsMap: Map<number, { id: string; name: string; args: string }>,
	deltaToolCalls: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>,
): void {
	for (const tc of deltaToolCalls) {
		const existing = toolCallsMap.get(tc.index) ?? { id: '', name: '', args: '' }
		if (tc.id) existing.id = tc.id
		if (tc.function?.name) existing.name += tc.function.name
		if (tc.function?.arguments) existing.args += tc.function.arguments
		toolCallsMap.set(tc.index, existing)
	}
}

function accumulateLegacyFunctionCall(
	toolCallsMap: Map<number, { id: string; name: string; args: string }>,
	deltaFunctionCall: { name?: string; arguments?: string } | undefined,
): void {
	if (!deltaFunctionCall) return

	const existing = toolCallsMap.get(0) ?? { id: 'call_legacy_0', name: '', args: '' }
	if (deltaFunctionCall.name) existing.name += deltaFunctionCall.name
	if (deltaFunctionCall.arguments) existing.args += deltaFunctionCall.arguments
	toolCallsMap.set(0, existing)
}

function finalizeToolCalls(
	toolCallsMap: Map<number, { id: string; name: string; args: string }>,
): OpenAIToolCall[] {
	return Array.from(toolCallsMap.values())
		.filter((tc) => typeof tc.name === 'string' && tc.name.trim().length > 0)
		.map((tc, index) => ({
			id: tc.id || `call_fallback_${index}`,
			type: 'function' as const,
			function: { name: tc.name, arguments: tc.args },
		}))
}

function extractTextFromMessageContent(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''

	const parts: string[] = []
	for (const item of content) {
		if (!item || typeof item !== 'object') continue
		const record = item as Record<string, unknown>
		const directText = typeof record.text === 'string' ? record.text : ''
		if (directText) {
			parts.push(directText)
			continue
		}
		const nestedText = record.type === 'text' && typeof record.content === 'string'
			? record.content
			: ''
		if (nestedText) {
			parts.push(nestedText)
		}
	}

	return parts.join('')
}

function toOpenAIToolCallsFromMessage(
	messageToolCalls: unknown,
): OpenAIToolCall[] {
	if (!Array.isArray(messageToolCalls)) return []
	const result: OpenAIToolCall[] = []
	for (const [index, raw] of messageToolCalls.entries()) {
		if (!raw || typeof raw !== 'object') continue
		const tc = raw as {
			id?: unknown
			type?: unknown
			function?: { name?: unknown; arguments?: unknown }
		}
		const name =
			tc.function && typeof tc.function === 'object' && typeof tc.function.name === 'string'
				? tc.function.name
				: ''
		if (!name.trim()) continue
		const rawArgs =
			tc.function && typeof tc.function === 'object'
				? tc.function.arguments
				: undefined
		const args =
			typeof rawArgs === 'string'
				? rawArgs
				: rawArgs === undefined
					? '{}'
					: JSON.stringify(rawArgs)
		result.push({
			id: typeof tc.id === 'string' && tc.id ? tc.id : `call_nonstream_${index}`,
			type: 'function',
			function: {
				name,
				arguments: args,
			},
		})
	}
	return result
}

// ─── 推理内容处理 ────────────────────────────────────────

const REASONING_TEXT_PREFERRED_KEYS = [
	'text',
	'summary',
	'content',
	'reasoning',
	'reasoning_text',
	'summary_text',
	'value',
]

function appendReasoningText(
	value: unknown,
	parts: string[],
	visited: Set<unknown>,
): void {
	if (typeof value === 'string') {
		const text = value.trim()
		if (text) parts.push(text)
		return
	}
	if (!value || typeof value !== 'object') return
	if (visited.has(value)) return
	visited.add(value)

	if (Array.isArray(value)) {
		for (const item of value) {
			appendReasoningText(item, parts, visited)
		}
		return
	}

	const obj = value as Record<string, unknown>
	for (const key of REASONING_TEXT_PREFERRED_KEYS) {
		if (key in obj) {
			appendReasoningText(obj[key], parts, visited)
		}
	}

	for (const [key, child] of Object.entries(obj)) {
		if (REASONING_TEXT_PREFERRED_KEYS.includes(key)) continue
		appendReasoningText(child, parts, visited)
	}
}

function extractReasoningTextFromDetails(reasoningDetails: unknown): string {
	if (reasoningDetails === undefined || reasoningDetails === null) return ''
	const parts: string[] = []
	appendReasoningText(reasoningDetails, parts, new Set())
	if (parts.length === 0) return ''
	const uniqueParts: string[] = []
	const seen = new Set<string>()
	for (const part of parts) {
		if (seen.has(part)) continue
		seen.add(part)
		uniqueParts.push(part)
	}
	return uniqueParts.join('\n')
}

interface ExtractedReasoningDelta {
	displayText: string
	reasoningContent?: string
	reasoning?: string
	reasoningDetails?: unknown
}

function extractReasoningFromDelta(
	delta: Record<string, unknown>,
): ExtractedReasoningDelta | null {
	const reasoningContent =
		typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined
	const reasoning = typeof delta.reasoning === 'string' ? delta.reasoning : undefined
	const hasReasoningDetails = Object.prototype.hasOwnProperty.call(delta, 'reasoning_details')
	const reasoningDetails = hasReasoningDetails ? delta.reasoning_details : undefined

	const hasAnyReasoningField =
		reasoningContent !== undefined || reasoning !== undefined || hasReasoningDetails
	if (!hasAnyReasoningField) return null

	const preferredReasoningText =
		(typeof reasoningContent === 'string' && reasoningContent.trim())
			|| (typeof reasoning === 'string' && reasoning.trim())
			|| extractReasoningTextFromDetails(reasoningDetails)

	return {
		displayText: preferredReasoningText || '',
		reasoningContent,
		reasoning,
		reasoningDetails,
	}
}

// ─── API 参数处理 ────────────────────────────────────────

const INTERNAL_OPTION_KEYS = new Set([
	'apiKey', 'baseURL', 'model', 'parameters',
	'apiSecret', 'vendorApiKeys', 'vendorApiKeysByDevice',
	'mcpTools', 'mcpCallTool', 'mcpMaxToolCallLoops', 'mcpGetTools',
	'tools', 'toolExecutor', 'maxToolCallLoops', 'getTools',
	'enableReasoning',
	'reasoningEffort',
	'tag', 'vendor',
])

function extractApiParams(allOptions: Record<string, unknown>): Record<string, unknown> {
	const apiParams: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(allOptions)) {
		if (INTERNAL_OPTION_KEYS.has(key)) continue
		if (value === undefined || value === null) continue
		if (typeof value === 'function') continue
		if (key.startsWith('__')) continue
		apiParams[key] = value
	}
	return apiParams
}

function sanitizeApiParamsForToolLoop(apiParams: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = { ...apiParams }

	delete sanitized.model
	delete sanitized.messages
	delete sanitized.stream
	delete sanitized.tools
	delete sanitized.functions
	delete sanitized.function_call
	delete sanitized.tool_calls

	return sanitized
}

function sanitizeApiParamsForFinalRequest(apiParams: Record<string, unknown>): Record<string, unknown> {
	const sanitized = sanitizeApiParamsForToolLoop(apiParams)

	delete sanitized.tool_choice
	delete sanitized.parallel_tool_calls

	return sanitized
}

// ─── 消息转换 ────────────────────────────────────────

async function buildLoopMessages(
	messages: readonly Message[],
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
): Promise<ToolLoopMessage[]> {
	const result: ToolLoopMessage[] = []

	for (const msg of messages) {
		const loopMsg: ToolLoopMessage = {
			role: msg.role,
			content: msg.content,
		}

		if (typeof msg === 'object' && msg !== null && 'reasoning_content' in msg) {
			;(loopMsg as { reasoning_content?: string }).reasoning_content = (msg as { reasoning_content?: string }).reasoning_content
		}

		if (!msg.embeds || msg.embeds.length === 0) {
			result.push(loopMsg)
			continue
		}

		const contentParts: ContentPart[] = []

		if (msg.content) {
			contentParts.push({ type: 'text', text: msg.content })
		}

		for (const embed of msg.embeds) {
			try {
				const isHttpUrl = embed.link.startsWith('http://') || embed.link.startsWith('https://')
				if (isHttpUrl) {
					contentParts.push({ type: 'image_url', image_url: { url: embed.link } })
				} else {
					const imageUrlObj = await convertEmbedToImageUrl(embed, resolveEmbedAsBinary)
					contentParts.push(imageUrlObj)
				}
			} catch (err) {
				DebugLogger.warn(`[AgentLoop] 处理嵌入图片失败: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		loopMsg.content = contentParts.length > 0 ? contentParts : msg.content ?? ''
		result.push(loopMsg)
	}

	return result
}

// ─── 工具结果阻止检测 ────────────────────────────────────────

function areAllToolResultsBlocked(toolResults: ToolLoopMessage[]): boolean {
	return (
		toolResults.length > 0
		&& toolResults.every(
			(result) =>
				typeof result.content === 'string'
				&& result.content.startsWith('工具调用已阻止:'),
		)
	)
}

// ─── 回退判断 ────────────────────────────────────────

function shouldFallbackToPlainRequest(err: unknown): boolean {
	const inspected = new Set<unknown>()
	const texts: string[] = []
	const statuses: number[] = []

	const visit = (value: unknown): void => {
		if (value === null || value === undefined) return
		if (inspected.has(value)) return
		inspected.add(value)

		if (typeof value === 'string') {
			texts.push(value)
			const statusInText = value.match(/\b([45]\d{2})\b/)
			if (statusInText) statuses.push(Number(statusInText[1]))
			return
		}

		if (typeof value === 'number' && Number.isFinite(value)) {
			if (value >= 400 && value <= 599) {
				statuses.push(value)
			}
			return
		}

		if (value instanceof Error) {
			texts.push(value.message)
			const errorLike = value as Error & {
				status?: unknown
				statusCode?: unknown
				code?: unknown
				cause?: unknown
				response?: { status?: unknown; data?: unknown; error?: unknown }
			}
			visit(errorLike.status)
			visit(errorLike.statusCode)
			visit(errorLike.code)
			visit(errorLike.cause)
			visit(errorLike.response?.status)
			visit(errorLike.response?.data)
			visit(errorLike.response?.error)
			return
		}

		if (typeof value === 'object') {
			const obj = value as Record<string, unknown>
			visit(obj.message)
			visit(obj.status)
			visit(obj.statusCode)
			visit(obj.code)
			visit(obj.cause)
			visit(obj.error)
			visit(obj.data)
			visit(obj.response)
			return
		}
	}

	visit(err)
	const mergedText = texts.join(' | ').toLowerCase()
	const hasServerError = statuses.some((s) => s >= 500 && s <= 599)
	if (hasServerError) return true

	const hasConnectionLikeError = /(\bapi ?connection ?error\b|\bconnection error\b|\bnetwork error\b|failed to fetch|\bfetch failed\b|socket hang up|econnreset|econnrefused|etimedout|\btimeout\b)/i
		.test(mergedText)
	if (hasConnectionLikeError) return true

	return (
		/(internal server error|server error|response status code 5\d\d|http.*5\d\d)/i.test(mergedText) ||
		/(tool|tools|function|functions|tool_calls?).*(unsupported|not support|not implemented|invalid|unknown)/i.test(
			mergedText,
		) ||
		/(unsupported|invalid|unknown).*(tool|tools|function|functions|tool_calls?)/i.test(mergedText)
	)
}

// ─── 执行工具调用 ────────────────────────────────────────

async function executeToolCalls(
	toolCalls: OpenAIToolCall[],
	tools: ToolDefinition[],
	toolExecutor: ToolExecutor,
): Promise<ToolLoopMessage[]> {
	const results: ToolLoopMessage[] = []

	for (const call of toolCalls) {
		const request: ToolCallRequest = {
			id: call.id,
			name: call.function.name,
			arguments: call.function.arguments,
		}

		try {
			const result = await toolExecutor.execute(request, tools)
			results.push({
				role: 'tool',
				tool_call_id: result.toolCallId,
				name: result.name,
				content: result.content,
			})
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)
			DebugLogger.error(`[AgentLoop] 工具执行失败: ${call.function.name}`, err)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: call.function.name,
				content: `工具调用失败: ${errorMsg}`,
			})
		}
	}

	return results
}

// ─── 公开配置 ────────────────────────────────────────

export interface OpenAILoopOptions {
	transformBaseURL?: (url: string) => string
	createClient?: (allOptions: Record<string, unknown>) => OpenAI
	preferNonStreamingToolLoop?: boolean
	transformApiParams?: (apiParams: Record<string, unknown>, allOptions: Record<string, unknown>) => Record<string, unknown>
}

// ─── 核心循环包装器 ────────────────────────────────────────

/**
 * 为 OpenAI 兼容 Provider 注入工具调用循环支持
 *
 * 替代原来的 withOpenAIMcpToolCallSupport，使用通用 ToolExecutor 接口
 */
export function withToolCallLoopSupport(
	originalFactory: (settings: BaseOptions) => SendRequest,
	loopOptions?: OpenAILoopOptions,
): (settings: BaseOptions) => SendRequest {
	return (settings: BaseOptions): SendRequest => {
		const hasStaticTools = Array.isArray(settings.tools) && settings.tools.length > 0
		const hasDynamicTools = typeof settings.getTools === 'function'
		const { tools, toolExecutor, getTools } = settings
		if ((!hasStaticTools && !hasDynamicTools) || !toolExecutor) {
			return originalFactory(settings)
		}

		return async function* (messages, controller, resolveEmbedAsBinary, saveAttachment) {
			let requestBaseURL = ''
			try {
				const { parameters, ...optionsExcludingParams } = settings
				const allOptions = { ...optionsExcludingParams, ...parameters }
				const apiKey =
					typeof optionsExcludingParams.apiKey === 'string'
						? optionsExcludingParams.apiKey
						: (allOptions.apiKey as string)
				const baseURL =
					typeof optionsExcludingParams.baseURL === 'string'
						? optionsExcludingParams.baseURL
						: (allOptions.baseURL as string)
				const model =
					typeof optionsExcludingParams.model === 'string'
						? optionsExcludingParams.model
						: (allOptions.model as string)
				if (typeof baseURL === 'string') {
					requestBaseURL = baseURL
				}
				const maxToolCallLoops =
					typeof settings.maxToolCallLoops === 'number' && settings.maxToolCallLoops > 0
						? settings.maxToolCallLoops
						: DEFAULT_MAX_TOOL_CALL_LOOPS

				let apiParams = extractApiParams(allOptions)

				if (loopOptions?.transformApiParams) {
					apiParams = loopOptions.transformApiParams(apiParams, allOptions)
				}
				const apiParamsForToolLoop = sanitizeApiParamsForToolLoop(apiParams)
				const apiParamsForFinalRequest = sanitizeApiParamsForFinalRequest(apiParams)

				let client: OpenAI
				if (loopOptions?.createClient) {
					client = loopOptions.createClient(allOptions as Record<string, unknown>)
				} else {
					let normalizedBaseURL: string
					if (loopOptions?.transformBaseURL) {
						normalizedBaseURL = loopOptions.transformBaseURL(baseURL as string)
					} else {
						normalizedBaseURL = baseURL as string
						if (normalizedBaseURL.endsWith('/chat/completions')) {
							normalizedBaseURL = normalizedBaseURL.replace(/\/chat\/completions$/, '')
						}
					}
					client = new OpenAI({
						apiKey: apiKey as string,
						baseURL: normalizedBaseURL,
						dangerouslyAllowBrowser: true,
					})
				}

				const initialTools = await resolveCurrentTools(tools, getTools)
				const rawThinkingType = (settings as { thinkingType?: unknown }).thinkingType
				const hasThinkingTypeEnabled =
					typeof rawThinkingType === 'string' && rawThinkingType.toLowerCase() !== 'disabled'
				const enableReasoning =
					(settings as { enableReasoning?: boolean }).enableReasoning === true ||
					(settings as { enableThinking?: boolean }).enableThinking === true ||
					hasThinkingTypeEnabled
				const preferNonStreamingToolLoop = loopOptions?.preferNonStreamingToolLoop === true

				DebugLogger.debug(
					`[AgentLoop] 工具调用循环启动: ${initialTools.length} 个工具可用, model=${model}, ` +
					`maxLoops=${maxToolCallLoops}, enableReasoning=${enableReasoning}, ` +
					`preferNonStreamingToolLoop=${preferNonStreamingToolLoop}, ` +
					`apiParams=${JSON.stringify(Object.keys(apiParams))}`,
				)

				const loopMessages: ToolLoopMessage[] = await buildLoopMessages(
					messages,
					resolveEmbedAsBinary,
				)

				for (let loop = 0; loop < maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					DebugLogger.debug(`[AgentLoop] 工具调用循环 #${loop + 1}`)
					const currentTools = await resolveCurrentTools(tools, getTools)

					if (preferNonStreamingToolLoop) {
						const completion = await client.chat.completions.create(
							{
								model: model as string,
								messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
								...(currentTools.length > 0
									? { tools: toOpenAITools(currentTools) }
									: {}),
								...apiParamsForToolLoop,
							},
							{ signal: controller.signal },
						)
						const message = completion.choices[0]?.message as Record<string, unknown> | undefined
						if (!message) return

						const messageReasoning = extractReasoningFromDelta(message)
						if (messageReasoning?.displayText && enableReasoning) {
							const startMs = Date.now()
							yield `${REASONING_BLOCK_START_MARKER}:${startMs}:`
							yield messageReasoning.displayText
							const durationMs = Date.now() - startMs
							yield `:${REASONING_BLOCK_END_MARKER}:${durationMs}:`
						}

						const contentBuffer = extractTextFromMessageContent(message.content)
						const toolCallsResult = toOpenAIToolCallsFromMessage(message.tool_calls)

						if (toolCallsResult.length === 0) {
							if (contentBuffer) {
								yield contentBuffer
							}
							return
						}

						const assistantMsg: ToolLoopMessage = {
							role: 'assistant',
							content: contentBuffer || null,
							tool_calls: toolCallsResult,
						}
						if (messageReasoning?.reasoningContent) {
							assistantMsg.reasoning_content = messageReasoning.reasoningContent
						} else if (messageReasoning?.displayText) {
							assistantMsg.reasoning_content = messageReasoning.displayText
						}
						if (messageReasoning?.reasoning) {
							assistantMsg.reasoning = messageReasoning.reasoning
						}
						if (messageReasoning?.reasoningDetails !== undefined) {
							assistantMsg.reasoning_details = messageReasoning.reasoningDetails
						}
						loopMessages.push(assistantMsg)

						const toolResults: ToolLoopMessage[] = []
						for (const call of toolCallsResult) {
							const singleResults = await executeToolCalls(
								[call],
								currentTools,
								toolExecutor!,
							)
							toolResults.push(...singleResults)

							const resultContent = typeof singleResults[0]?.content === 'string'
								? singleResults[0].content
								: ''
							yield `{{FF_MCP_TOOL_START}}:${call.function.name}:${resultContent}{{FF_MCP_TOOL_END}}:`
						}

						loopMessages.push(...toolResults)
						if (areAllToolResultsBlocked(toolResults)) {
							DebugLogger.warn('[AgentLoop] 检测到重复失败的相同工具调用，提前结束工具循环')
							break
						}

						DebugLogger.debug(
							`[AgentLoop] 已执行 ${toolCallsResult.length} 个工具调用（非流式），继续循环`,
						)
						continue
					}

					// 流式请求
					const stream = await client.chat.completions.create(
						{
							model: model as string,
							messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
							...(currentTools.length > 0
								? { tools: toOpenAITools(currentTools) }
								: {}),
							stream: true,
							...apiParamsForToolLoop,
						},
						{ signal: controller.signal },
					)

					let contentBuffer = ''
					let reasoningBuffer = ''
					let reasoningForMessage = ''
					let reasoningContentForMessage = ''
					let reasoningTextForMessage = ''
					const reasoningDetailsForMessage: unknown[] = []
					let reasoningStartMs = 0
					let reasoningActive = false
					const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()
					let hasToolCalls = false

					for await (const part of stream) {
						const delta = part.choices[0]?.delta as Record<string, unknown> | undefined
						if (!delta) continue

						const reasoningDelta = extractReasoningFromDelta(delta)
						if (reasoningDelta) {
							if (reasoningDelta.reasoningContent) {
								reasoningContentForMessage += reasoningDelta.reasoningContent
							}
							if (reasoningDelta.reasoning) {
								reasoningTextForMessage += reasoningDelta.reasoning
							}
							if (reasoningDelta.reasoningDetails !== undefined) {
								reasoningDetailsForMessage.push(reasoningDelta.reasoningDetails)
							}

							if (reasoningDelta.displayText && enableReasoning) {
								if (!reasoningActive) {
									reasoningActive = true
									reasoningStartMs = Date.now()
									yield `${REASONING_BLOCK_START_MARKER}:${reasoningStartMs}:`
								}
								reasoningBuffer += reasoningDelta.displayText
								yield reasoningDelta.displayText
							}
						}

						const textContent = delta.content as string | undefined
						if (textContent) {
							if (reasoningActive && reasoningBuffer.length > 0) {
								const reasoningDurationMs = Date.now() - reasoningStartMs
								yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
								reasoningActive = false
								reasoningForMessage += reasoningBuffer
								reasoningBuffer = ''
							}

							contentBuffer += textContent
							if (!hasToolCalls) {
								yield textContent
							}
						}

						const deltaToolCalls = delta.tool_calls as
							| Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
							| undefined
						if (deltaToolCalls) {
							if (reasoningActive && reasoningBuffer.length > 0) {
								const reasoningDurationMs = Date.now() - reasoningStartMs
								yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
								reasoningActive = false
								reasoningForMessage += reasoningBuffer
								reasoningBuffer = ''
							}

							hasToolCalls = true
							accumulateToolCall(toolCallsMap, deltaToolCalls)
						}

						const deltaFunctionCall = delta.function_call as
							| { name?: string; arguments?: string }
							| undefined
						if (deltaFunctionCall) {
							if (reasoningActive && reasoningBuffer.length > 0) {
								const reasoningDurationMs = Date.now() - reasoningStartMs
								yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
								reasoningActive = false
								reasoningForMessage += reasoningBuffer
								reasoningBuffer = ''
							}

							hasToolCalls = true
							accumulateLegacyFunctionCall(toolCallsMap, deltaFunctionCall)
						}
					}

					if (reasoningActive && reasoningBuffer.length > 0) {
						const reasoningDurationMs = Date.now() - reasoningStartMs
						yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
						reasoningActive = false
						reasoningForMessage += reasoningBuffer
					}

					if (!hasToolCalls) {
						return
					}

					const toolCallsFinal = finalizeToolCalls(toolCallsMap)

					const assistantMsg: ToolLoopMessage = {
						role: 'assistant',
						content: contentBuffer || null,
						tool_calls: toolCallsFinal,
					}
					const normalizedReasoningContent = reasoningContentForMessage || reasoningForMessage
					if (normalizedReasoningContent) {
						assistantMsg.reasoning_content = normalizedReasoningContent
					}
					if (reasoningTextForMessage) {
						assistantMsg.reasoning = reasoningTextForMessage
					}
					if (reasoningDetailsForMessage.length > 0) {
						assistantMsg.reasoning_details =
							reasoningDetailsForMessage.length === 1
								? reasoningDetailsForMessage[0]
								: reasoningDetailsForMessage
					}
					loopMessages.push(assistantMsg)

					const toolResults: ToolLoopMessage[] = []
					for (const call of toolCallsFinal) {
						const singleResults = await executeToolCalls(
							[call],
							currentTools,
							toolExecutor!,
						)
						toolResults.push(...singleResults)

						const resultContent = typeof singleResults[0]?.content === 'string'
							? singleResults[0].content
							: ''
						yield `{{FF_MCP_TOOL_START}}:${call.function.name}:${resultContent}{{FF_MCP_TOOL_END}}:`
					}

					loopMessages.push(...toolResults)
					if (areAllToolResultsBlocked(toolResults)) {
						DebugLogger.warn('[AgentLoop] 检测到重复失败的相同工具调用，提前结束工具循环')
						break
					}

					DebugLogger.debug(
						`[AgentLoop] 已执行 ${toolCallsFinal.length} 个工具调用，继续循环`,
					)
				}

				// 达到最大循环次数，做最后一次请求（不带工具）
				DebugLogger.warn(`[AgentLoop] 达到最大工具调用循环次数 (${maxToolCallLoops})`)

				if (preferNonStreamingToolLoop) {
					const finalCompletion = await client.chat.completions.create(
						{
							model: model as string,
							messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
							...apiParamsForFinalRequest,
						},
						{ signal: controller.signal },
					)
					const finalMessage = finalCompletion.choices[0]?.message as Record<string, unknown> | undefined
					if (!finalMessage) return

					const finalReasoning = extractReasoningFromDelta(finalMessage)
					if (finalReasoning?.displayText && enableReasoning) {
						const startMs = Date.now()
						yield `${REASONING_BLOCK_START_MARKER}:${startMs}:`
						yield finalReasoning.displayText
						const durationMs = Date.now() - startMs
						yield `:${REASONING_BLOCK_END_MARKER}:${durationMs}:`
					}

					const finalText = extractTextFromMessageContent(finalMessage.content)
					if (finalText) {
						yield finalText
					}
					return
				}

				const finalStream = await client.chat.completions.create(
					{
						model: model as string,
						messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
						stream: true,
						...apiParamsForFinalRequest,
					},
					{ signal: controller.signal },
				)

				let finalReasoningBuffer = ''
				let finalReasoningStartMs = 0
				let finalReasoningActive = false

				for await (const part of finalStream) {
					const delta = part.choices[0]?.delta as Record<string, unknown> | undefined
					if (!delta) continue

					const reasoningDelta = extractReasoningFromDelta(delta)
					if (reasoningDelta?.displayText && enableReasoning) {
						if (!finalReasoningActive) {
							finalReasoningActive = true
							finalReasoningStartMs = Date.now()
							yield `${REASONING_BLOCK_START_MARKER}:${finalReasoningStartMs}:`
						}
						finalReasoningBuffer += reasoningDelta.displayText
						yield reasoningDelta.displayText
						continue
					}

					const text = delta.content as string | undefined
					if (text) {
						if (finalReasoningActive && finalReasoningBuffer.length > 0) {
							const reasoningDurationMs = Date.now() - finalReasoningStartMs
							yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
							finalReasoningActive = false
							finalReasoningBuffer = ''
						}
						yield text
					}
				}

				if (finalReasoningActive && finalReasoningBuffer.length > 0) {
					const reasoningDurationMs = Date.now() - finalReasoningStartMs
					yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
				}
			} catch (err) {
				if (controller.signal.aborted) return

				const errorText = err instanceof Error ? err.message : String(err)
				const likelyProviderCompatibilityIssue = shouldFallbackToPlainRequest(err)

				if (!likelyProviderCompatibilityIssue) {
					throw err
				}

				DebugLogger.error(
					`[AgentLoop] 工具调用链路失败，回退普通请求（不带工具）: ${errorText}`,
					err,
				)

				try {
					const { Notice } = await import('obsidian')
					new Notice(
						`⚠️ 工具调用失败，已回退为普通请求。\n原因: ${errorText.slice(0, 120)}`,
						8000,
					)
				} catch {
					// Notice 不可用时忽略
				}

				const fallbackSettings: BaseOptions = {
					...settings,
					tools: undefined,
					toolExecutor: undefined,
				}
				const fallbackSendRequest = originalFactory(fallbackSettings)
				for await (const chunk of fallbackSendRequest(messages, controller, resolveEmbedAsBinary, saveAttachment)) {
					yield chunk
				}
			}
		}
	}
}
