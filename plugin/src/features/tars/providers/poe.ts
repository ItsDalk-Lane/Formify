import OpenAI from 'openai'
import { Platform, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import {
	executeMcpToolCalls,
	type OpenAIToolCall
} from '../mcp/mcpToolCallHandler'
import { normalizeProviderError } from './errors'
import { withRetry } from './retry'
import { feedChunk } from './sse'
import { buildReasoningBlockEnd, buildReasoningBlockStart, convertEmbedToImageUrl } from './utils'

type ContentItem =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| { type: 'text'; text: string }

export interface PoeOptions extends BaseOptions {
	enableReasoning?: boolean
	enableWebSearch?: boolean
}

interface PoeFunctionCallItem {
	id: string
	call_id: string
	name: string
	arguments: string
}

interface PoeToolResultMarker {
	toolName: string
	content: string
}

const DEFAULT_MCP_TOOL_LOOP_LIMIT = 10
const POE_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 250,
	maxDelayMs: 3000,
	jitterRatio: 0.2
} as const

const THINK_OPEN_TAG = '<think>'
const THINK_CLOSE_TAG = '</think>'

/**
 * 判断 Poe Responses API SSE 事件类型是否为推理内容 delta。
 * 不同模型和 Poe 后端版本可能使用不同的事件名称：
 * - response.reasoning_text.delta
 * - response.reasoning_summary_text.delta
 * - response.reasoning.delta
 * - response.reasoning_content.delta
 * 统一通过关键字匹配来兼容各种变体。
 */
const isReasoningDeltaEvent = (eventType: string): boolean => {
	return eventType.includes('reasoning') && eventType.includes('delta')
}

const resolveErrorStatus = (error: unknown): number | undefined => {
	if (!error || typeof error !== 'object') return undefined
	const err = error as {
		status?: unknown
		statusCode?: unknown
		response?: { status?: unknown }
		message?: unknown
	}
	const candidate = [err.status, err.statusCode, err.response?.status].find(
		(value) => typeof value === 'number'
	)
	if (typeof candidate === 'number') return candidate
	const message = typeof err.message === 'string' ? err.message : ''
	const matched = message.match(/\b(4\d\d|5\d\d)\b/)
	if (!matched) return undefined
	const parsed = Number.parseInt(matched[1], 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

const shouldFallbackToChatCompletions = (error: unknown): boolean => {
	const status = resolveErrorStatus(error)
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase()

	if (status === 404 || status === 405 || status === 422) return true

	// APIConnectionError（status=undefined，message="Connection error."）
	// 表示 SDK 无法连接到 Responses API 端点，应降级到 Chat Completions
	if (status === undefined && /connection\s*error/i.test(message)) return true

	return (
		/(responses?).*(unsupported|not support|not found|invalid)/i.test(message)
		|| /(unsupported|not support|unknown).*(responses?)/i.test(message)
	)
}

const shouldRetryContinuationWithoutReasoning = (error: unknown): boolean => {
	const status = resolveErrorStatus(error)
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase()

	// 限流错误不应触发额外重试，避免放大 429
	if (status === 429) return false

	// 常见的参数/协议不兼容（含 5xx）可以尝试去掉 reasoning 再试一次
	if (
		status === 400
		|| status === 404
		|| status === 405
		|| status === 422
		|| (typeof status === 'number' && status >= 500)
	) {
		return true
	}

	// 无明确状态码时，按错误文案兜底判断
	if (
		/(reasoning|thinking)/i.test(message)
		&& /(unsupported|not support|invalid|not allowed|unknown|unrecognized|bad request)/i.test(message)
	) {
		return true
	}

	return /connection\s*error|err_connection_closed|socket|stream|network/i.test(message)
}

const normalizeErrorText = (prefix: string, error: unknown): Error => {
	const message = error instanceof Error ? error.message : String(error)
	return new Error(`${prefix}: ${message}`)
}

const ensureResponseEndpoint = (baseURL: string) => {
	return `${normalizePoeBaseURL(baseURL)}/responses`
}

const ensureCompletionEndpoint = (baseURL: string) => {
	return `${normalizePoeBaseURL(baseURL)}/chat/completions`
}

export const normalizePoeBaseURL = (baseURL: string) => {
	const trimmed = (baseURL || '').trim().replace(/\/+$/, '')
	if (!trimmed) return 'https://api.poe.com/v1'
	if (trimmed.endsWith('/chat/completions')) {
		return trimmed.replace(/\/chat\/completions$/, '')
	}
	if (trimmed.endsWith('/responses')) {
		return trimmed.replace(/\/responses$/, '')
	}
	return trimmed
}

export const poeResolveResponsesURL = (baseURL: string) => ensureResponseEndpoint(baseURL)
export const poeResolveChatCompletionsURL = (baseURL: string) => ensureCompletionEndpoint(baseURL)

export const poeMapResponsesParams = (params: Record<string, unknown>) => {
	const mapped = { ...params }
	if (typeof mapped.max_tokens === 'number') {
		mapped.max_output_tokens = mapped.max_tokens
		delete mapped.max_tokens
	}
	return mapped
}

const mapResponsesParamsToChatParams = (params: Record<string, unknown>): Record<string, unknown> => {
	const mapped: Record<string, unknown> = { ...params }
	if (typeof mapped.max_output_tokens === 'number' && typeof mapped.max_tokens !== 'number') {
		mapped.max_tokens = mapped.max_output_tokens
	}

	delete mapped.max_output_tokens

	// 将 Responses API 的 reasoning 参数转换为 Chat Completions 的自定义参数格式
	// 根据 Poe 文档，Chat Completions 的 reasoning_effort 标准字段被忽略，
	// 需要通过 extra_body（自定义字段）传递推理参数
	if (mapped.reasoning && typeof mapped.reasoning === 'object') {
		const effort = (mapped.reasoning as Record<string, unknown>).effort
		if (typeof effort === 'string' && effort) {
			mapped.reasoning_effort = effort
		}
	}
	delete mapped.reasoning
	delete mapped.tools
	delete mapped.tool_choice
	delete mapped.parallel_tool_calls
	delete mapped.previous_response_id
	delete mapped.input
	delete mapped.text
	delete mapped.truncation
	delete mapped.include

	return mapped
}

const toResponseRole = (role: string): 'user' | 'assistant' | 'system' => {
	if (role === 'assistant' || role === 'system') return role
	return 'user'
}

const dedupeTools = (tools: any[]): any[] => {
	const seen = new Set<string>()
	const result: any[] = []

	for (const tool of tools) {
		if (!tool || typeof tool !== 'object') continue
		const type = String((tool as any).type ?? '')
		if (!type) continue

		let key = type
		if (type === 'function') {
			const fnName = String((tool as any).name ?? (tool as any).function?.name ?? '')
			if (!fnName) continue
			key = `function:${fnName}`
		} else {
			key = `${type}:${JSON.stringify(tool)}`
		}

		if (seen.has(key)) continue
		seen.add(key)
		result.push(tool)
	}

	return result
}

const normalizeResponsesFunctionTool = (tool: unknown): any | null => {
	if (!tool || typeof tool !== 'object') return null
	const raw = tool as Record<string, unknown>
	if (raw.type !== 'function') {
		return raw
	}

	// 支持两种输入：
	// 1) Responses 原生格式: { type: 'function', name, description, parameters }
	// 2) Chat Completions 格式: { type: 'function', function: { name, description, parameters } }
	const nestedFunction = raw.function && typeof raw.function === 'object'
		? (raw.function as Record<string, unknown>)
		: undefined

	const name = String(raw.name ?? nestedFunction?.name ?? '')
	if (!name) return null

	return {
		type: 'function',
		name,
		description:
			typeof raw.description === 'string'
				? raw.description
				: typeof nestedFunction?.description === 'string'
					? nestedFunction.description
					: undefined,
		parameters:
			(raw.parameters && typeof raw.parameters === 'object')
				? raw.parameters
				: (nestedFunction?.parameters && typeof nestedFunction.parameters === 'object')
					? nestedFunction.parameters
					: { type: 'object', properties: {} }
	}
}

const toResponsesFunctionToolsFromMcp = (mcpTools: NonNullable<BaseOptions['mcpTools']>) => {
	return mcpTools.map((tool) => ({
		type: 'function' as const,
		name: tool.name,
		description: tool.description,
		parameters: tool.inputSchema
	}))
}

const mergeResponseTools = (
	apiParamTools: unknown,
	enableWebSearch: boolean,
	mcpTools: BaseOptions['mcpTools']
) => {
	const merged: any[] = []
	if (Array.isArray(apiParamTools)) {
		for (const tool of apiParamTools) {
			const normalized = normalizeResponsesFunctionTool(tool)
			if (normalized) {
				merged.push(normalized)
			}
		}
	}
	if (enableWebSearch) {
		merged.push({ type: 'web_search_preview' })
	}
	if (Array.isArray(mcpTools) && mcpTools.length > 0) {
		merged.push(...toResponsesFunctionToolsFromMcp(mcpTools))
	}
	return dedupeTools(merged)
}

const isFunctionCallOutputInput = (value: unknown): value is Array<{ type: 'function_call_output' }> => {
	if (!Array.isArray(value) || value.length === 0) return false
	return value.every((item) => item && typeof item === 'object' && (item as any).type === 'function_call_output')
}

const shouldRetryFunctionOutputTurn400 = (error: unknown, input: unknown) => {
	if (!isFunctionCallOutputInput(input)) return false
	const status = resolveErrorStatus(error)
	if (status === 400) return true
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
	return message.includes('protocol_messages') && message.includes('no messages')
}

const toToolResultContinuationInput = (input: unknown): unknown => {
	if (!isFunctionCallOutputInput(input)) return input
	const toolResults = input
		.map((item, index) => `Tool result ${index + 1}:\n${String((item as any).output ?? '')}`)
		.join('\n\n')
	const continuationText =
		`The tool call has completed. Use the following tool results to continue.\n\n${toolResults}`.trim()
	return [
		{
			role: 'user' as const,
			content: [{ type: 'input_text' as const, text: continuationText }]
		}
	]
}

const extractResponseFunctionCalls = (response: any): PoeFunctionCallItem[] => {
	const output = Array.isArray(response?.output) ? response.output : []
	return output
		.filter((item: any) => item?.type === 'function_call')
		.map((item: any) => ({
			id: String(item?.id ?? item?.call_id ?? ''),
			call_id: String(item?.call_id ?? item?.id ?? ''),
			name: String(item?.name ?? ''),
			arguments: typeof item?.arguments === 'string' ? item.arguments : '{}'
		}))
		.filter((call: PoeFunctionCallItem) => call.id.length > 0 && call.call_id.length > 0 && call.name.length > 0)
}

const mapFunctionCallsToOpenAI = (calls: PoeFunctionCallItem[]): OpenAIToolCall[] => {
	return calls.map((call) => ({
		id: call.id,
		type: 'function',
		function: {
			name: call.name,
			arguments: call.arguments || '{}'
		}
	}))
}

const executePoeMcpToolCalls = async (
	functionCalls: PoeFunctionCallItem[],
	mcpTools: NonNullable<BaseOptions['mcpTools']>,
	mcpCallTool: NonNullable<BaseOptions['mcpCallTool']>
): Promise<{
	nextInputItems: Array<{ type: 'function_call_output'; call_id: string; output: string }>
	markers: PoeToolResultMarker[]
}> => {
	const openAIToolCalls = mapFunctionCallsToOpenAI(functionCalls)
	const results = await executeMcpToolCalls(openAIToolCalls, mcpTools, mcpCallTool)
	const resultMap = new Map<string, { name?: string; content?: unknown }>()
	for (const result of results) {
		if (!result.tool_call_id) continue
		resultMap.set(result.tool_call_id, {
			name: result.name,
			content: result.content
		})
	}

	const nextInputItems: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
	const markers: PoeToolResultMarker[] = []

	for (const call of functionCalls) {
		const matched = resultMap.get(call.id)
		const outputText =
			typeof matched?.content === 'string'
				? matched.content
				: matched?.content === undefined || matched?.content === null
					? ''
					: String(matched.content)

		nextInputItems.push({
			type: 'function_call_output',
			call_id: call.call_id,
			output: outputText
		})
		markers.push({
			toolName: call.name,
			content: outputText
		})
	}

	return {
		nextInputItems,
		markers
	}
}

const extractMessageText = (content: unknown): string => {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''

	const parts: string[] = []
	for (const item of content) {
		if (typeof item === 'string') {
			parts.push(item)
			continue
		}
		if (item && typeof item === 'object') {
			const text = (item as any).text
			if (typeof text === 'string') {
				parts.push(text)
			}
		}
	}
	return parts.join('')
}

const extractOutputTextFromResponse = (response: any): string => {
	if (typeof response?.output_text === 'string') {
		return response.output_text
	}
	const output = Array.isArray(response?.output) ? response.output : []
	const textParts: string[] = []
	for (const item of output) {
		if (item?.type !== 'message') continue
		const content = Array.isArray(item?.content) ? item.content : []
		for (const part of content) {
			if (part?.type === 'output_text' && typeof part?.text === 'string') {
				textParts.push(part.text)
			}
		}
	}
	return textParts.join('')
}

const appendReasoningText = (value: unknown, parts: string[]): void => {
	if (typeof value === 'string') {
		const text = value.trim()
		if (text) parts.push(text)
		return
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			appendReasoningText(item, parts)
		}
		return
	}
	if (!value || typeof value !== 'object') return
	const obj = value as Record<string, unknown>
	const preferredKeys = ['text', 'summary', 'content', 'reasoning', 'reasoning_text', 'summary_text', 'value']
	for (const key of preferredKeys) {
		if (key in obj) {
			appendReasoningText(obj[key], parts)
		}
	}
}

const extractReasoningTextFromResponse = (response: any): string => {
	const output = Array.isArray(response?.output) ? response.output : []
	const parts: string[] = []
	for (const item of output) {
		const type = String(item?.type ?? '').toLowerCase()
		if (!type.includes('reason') && !type.includes('think')) {
			continue
		}
		appendReasoningText(item, parts)
	}
	if (parts.length === 0) return ''
	return Array.from(new Set(parts)).join('\n')
}

/**
 * 从 Responses API 返回中提取 function_call 项，用于累积式输入。
 * 在不使用 previous_response_id 的情况下，将模型的工具调用决策保留在输入上下文中，
 * 避免多轮工具调用时 previous_response_id 链过深导致上游 provider 返回 5xx。
 */
const extractResponseOutputItems = (response: any): unknown[] => {
	const output = Array.isArray(response?.output) ? response.output : []
	return output.filter((item: any) =>
		item && typeof item === 'object' && item.type === 'function_call'
	)
}

/**
 * 流式输出平滑渲染器：在快速连续 yield 之间插入低开销的宏任务边界，
 * 让 React 18+ 能在每次 yield 后有机会执行独立渲染，而不是把所有更新合并为一次。
 *
 * 使用 MessageChannel 替代 setTimeout(0)：
 * - MessageChannel 的宏任务开销约 0.1ms，远低于 setTimeout(0) 的 ~4ms 最小延迟
 * - 消除了 setTimeout 导致的逐字符卡顿，同时仍能打破 React 的批量更新边界
 * - 仅在 chunk 密集到达时（<8ms 间隔）才触发，慢速到达时零开销
 */
async function* smoothStream(
	source: AsyncGenerator<string, void, undefined>
): AsyncGenerator<string, void, undefined> {
	const mc = new MessageChannel()
	const flush = () => new Promise<void>(resolve => {
		mc.port1.onmessage = () => resolve()
		mc.port2.postMessage(null)
	})

	try {
		let lastYieldTs = 0
		for await (const chunk of source) {
			yield chunk
			const now = performance.now()
			// 仅在 chunk 密集到达时插入宏任务边界（间隔 < 8ms）
			if (now - lastYieldTs < 8) {
				await flush()
			}
			lastYieldTs = performance.now()
		}
	} finally {
		mc.port1.close()
		mc.port2.close()
	}
}

/**
 * 流式 <think> 标签检测器：当 Poe 模型将推理内容内联在文本中（以 <think>...</think> 包裹），
 * 自动转换为 {{FF_REASONING_START}}/{{FF_REASONING_END}} 推理块标记。
 * 如果 Responses API SSE 已通过事件发送了推理块，则文本中不含 <think> 标签，此检测器不会干扰。
 */
async function* wrapWithThinkTagDetection(
	source: AsyncGenerator<string, void, undefined>,
	enableReasoning: boolean
): AsyncGenerator<string, void, undefined> {
	if (!enableReasoning) {
		yield* source
		return
	}

	let buffer = ''
	let inThinking = false
	let thinkingStartMs: number | null = null

	for await (const chunk of source) {
		// 已有的推理/MCP 标记直接透传
		if (
			chunk.startsWith('{{FF_REASONING_START}}') ||
			chunk.startsWith(':{{FF_REASONING_END}}') ||
			chunk.startsWith('{{FF_MCP_TOOL_START}}')
		) {
			if (buffer) {
				yield buffer
				buffer = ''
			}
			yield chunk
			continue
		}

		buffer += chunk

		while (buffer.length > 0) {
			if (!inThinking) {
				const idx = buffer.indexOf(THINK_OPEN_TAG)
				if (idx === -1) {
					// 智能保留：只在 buffer 末尾确实可能是 <think> 前缀时才保留字符
					// 例如 buffer 末尾是 "<th" 则保留，末尾是 "abc" 则全部输出
					let keepLen = 0
					for (let i = Math.min(buffer.length, THINK_OPEN_TAG.length - 1); i > 0; i--) {
						if (THINK_OPEN_TAG.startsWith(buffer.slice(-i))) {
							keepLen = i
							break
						}
					}

					const safeLen = buffer.length - keepLen
					if (safeLen > 0) {
						yield buffer.slice(0, safeLen)
						buffer = buffer.slice(safeLen)
					}
					break
				}
				if (idx > 0) {
					yield buffer.slice(0, idx)
				}
				inThinking = true
				thinkingStartMs = Date.now()
				yield buildReasoningBlockStart(thinkingStartMs)
				buffer = buffer.slice(idx + THINK_OPEN_TAG.length)
			} else {
				const idx = buffer.indexOf(THINK_CLOSE_TAG)
				if (idx === -1) {
					// 智能保留：只在 buffer 末尾确实可能是 </think> 前缀时才保留
					let keepLen = 0
					for (let i = Math.min(buffer.length, THINK_CLOSE_TAG.length - 1); i > 0; i--) {
						if (THINK_CLOSE_TAG.startsWith(buffer.slice(-i))) {
							keepLen = i
							break
						}
					}

					const safeLen = buffer.length - keepLen
					if (safeLen > 0) {
						yield buffer.slice(0, safeLen)
						buffer = buffer.slice(safeLen)
					}
					break
				}
				if (idx > 0) {
					yield buffer.slice(0, idx)
				}
				const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
				thinkingStartMs = null
				yield buildReasoningBlockEnd(durationMs)
				inThinking = false
				buffer = buffer.slice(idx + THINK_CLOSE_TAG.length)
			}
		}
	}

	if (buffer) {
		yield buffer
	}
	if (inThinking) {
		const durationMs = Date.now() - (thinkingStartMs ?? Date.now())
		yield buildReasoningBlockEnd(durationMs)
	}
}

const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const base: Record<string, unknown> = {
		role: msg.role
	}

	if (msg.role === 'assistant' && typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
		base.reasoning_content = msg.reasoning_content
	}

	// Poe 的兼容层对纯文本字符串格式更稳定；只有用户消息带图片时才使用数组 content
	if (msg.role !== 'user' || !msg.embeds || msg.embeds.length === 0) {
		return {
			...base,
			content: msg.content
		}
	}

	const content: ContentItem[] = await Promise.all(msg.embeds.map((embed) => convertEmbedToImageUrl(embed, resolveEmbedAsBinary)))
	if (msg.content.trim()) {
		content.push({
			type: 'text' as const,
			text: msg.content
		})
	}

	return {
		...base,
		content
	}
}

const formatMsgForResponses = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const formatted = await formatMsg(msg, resolveEmbedAsBinary)
	const role = toResponseRole(String(formatted.role ?? msg.role))

	if (!Array.isArray(formatted.content)) {
		return {
			role,
			content: [{ type: 'input_text' as const, text: String(formatted.content ?? '') }]
		}
	}

	const content = formatted.content.map((part) => {
		if ((part as any).type === 'image_url') {
			return {
				type: 'input_image' as const,
				image_url: String((part as any).image_url?.url ?? '')
			}
		}
		return {
			type: 'input_text' as const,
			text: String((part as any).text ?? '')
		}
	})

	return {
		role,
		content: content.length > 0 ? content : [{ type: 'input_text' as const, text: '' }]
	}
}

const tryParseFirstJsonValue = (text: string): unknown | undefined => {
	const trimmed = text.trim()
	if (!trimmed) return undefined

	const startsWithObject = trimmed.startsWith('{')
	const startsWithArray = trimmed.startsWith('[')
	if (!startsWithObject && !startsWithArray) return undefined

	const stack: string[] = []
	let inString = false
	let escaped = false

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i]
		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (ch === '\\') {
				escaped = true
				continue
			}
			if (ch === '"') {
				inString = false
			}
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === '{' || ch === '[') {
			stack.push(ch)
			continue
		}

		if (ch === '}' || ch === ']') {
			const last = stack[stack.length - 1]
			if (!last) break
			if ((ch === '}' && last !== '{') || (ch === ']' && last !== '[')) break
			stack.pop()
			if (stack.length === 0) {
				const firstValue = trimmed.slice(0, i + 1)
				return JSON.parse(firstValue)
			}
		}
	}

	return undefined
}

const parsePoeJsonResponseText = (
	responseText: string
): { json?: any; parseError?: string } => {
	const trimmed = (responseText || '').trim()
	if (!trimmed) return {}

	try {
		return { json: JSON.parse(trimmed) }
	} catch (error) {
		try {
			const firstJson = tryParseFirstJsonValue(trimmed)
			if (firstJson !== undefined) return { json: firstJson as any }
		} catch {
			// noop
		}
		return {
			parseError: error instanceof Error ? error.message : String(error)
		}
	}
}

const requestResponsesByRequestUrl = async (
	url: string,
	apiKey: string,
	body: Record<string, unknown>
) => {
	let response: Awaited<ReturnType<typeof requestUrl>>
	try {
		response = await requestUrl({
			url,
			method: 'POST',
			body: JSON.stringify({
				...body,
				stream: false
			}),
			throw: false,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})
	} catch (error) {
		throw normalizeErrorText('Poe request failed', error)
	}

	const responseText = typeof response.text === 'string' ? response.text : ''
	const parsed = parsePoeJsonResponseText(responseText)

	if (response.status >= 400) {
		const apiError =
			parsed.json?.error?.message
			|| responseText
			|| (parsed.parseError ? `Invalid error body JSON: ${parsed.parseError}` : '')
			|| `HTTP ${response.status}`
		const error = new Error(`Poe API error (${response.status}): ${apiError}`) as Error & { status?: number }
		error.status = response.status
		throw error
	}

	if (parsed.json !== undefined) {
		return parsed.json
	}

	throw new Error(
		`Poe API returned non-JSON response: ${parsed.parseError || (responseText || '<empty>')}`
	)
}

const requestResponsesStreamByFetch = async (
	url: string,
	apiKey: string,
	body: Record<string, unknown>,
	signal: AbortSignal
) => {
	let response: Response
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				...body,
				stream: true
			}),
			signal
		})
	} catch (error) {
		throw normalizeErrorText('Poe request failed', error)
	}

	if (!response.ok) {
		const responseText = await response.text().catch(() => '')
		const parsed = parsePoeJsonResponseText(responseText)
		const apiError =
			parsed.json?.error?.message
			|| responseText
			|| (parsed.parseError ? `Invalid error body JSON: ${parsed.parseError}` : '')
			|| `HTTP ${response.status}`
		const error = new Error(`Poe API error (${response.status}): ${apiError}`) as Error & { status?: number }
		error.status = response.status
		throw error
	}

	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
	if (!reader) {
		throw new Error('Poe response body is not readable')
	}
	return reader
}

const requestChatCompletionStreamByFetch = async (
	url: string,
	apiKey: string,
	body: Record<string, unknown>,
	signal: AbortSignal
) => {
	let response: Response
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				...body,
				stream: true
			}),
			signal
		})
	} catch (error) {
		throw normalizeErrorText('Poe request failed', error)
	}

	if (!response.ok) {
		const responseText = await response.text().catch(() => '')
		const parsed = parsePoeJsonResponseText(responseText)
		const apiError =
			parsed.json?.error?.message
			|| responseText
			|| (parsed.parseError ? `Invalid error body JSON: ${parsed.parseError}` : '')
			|| `HTTP ${response.status}`
		const error = new Error(`Poe API error (${response.status}): ${apiError}`) as Error & { status?: number }
		error.status = response.status
		throw error
	}

	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
	if (!reader) {
		throw new Error('Poe response body is not readable')
	}
	return reader
}

const requestChatCompletionByRequestUrl = async (
	url: string,
	apiKey: string,
	body: Record<string, unknown>
) => {
	let response: Awaited<ReturnType<typeof requestUrl>>
	try {
		response = await requestUrl({
			url,
			method: 'POST',
			body: JSON.stringify({
				...body,
				stream: false
			}),
			throw: false,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})
	} catch (error) {
		throw normalizeErrorText('Poe request failed', error)
	}

	const responseText = typeof response.text === 'string' ? response.text : ''
	const parsed = parsePoeJsonResponseText(responseText)

	if (response.status >= 400) {
		const apiError =
			parsed.json?.error?.message
			|| responseText
			|| (parsed.parseError ? `Invalid error body JSON: ${parsed.parseError}` : '')
			|| `HTTP ${response.status}`
		const error = new Error(`Poe API error (${response.status}): ${apiError}`) as Error & { status?: number }
		error.status = response.status
		throw error
	}

	if (parsed.json !== undefined) {
		return parsed.json
	}

	throw new Error(
		`Poe API returned non-JSON response: ${parsed.parseError || (responseText || '<empty>')}`
	)
}

const sendRequestFunc = (settings: PoeOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		try {
			const { parameters, ...optionsExcludingParams } = settings
			const options = { ...optionsExcludingParams, ...parameters }
			const {
				apiKey,
				baseURL,
				model,
				enableReasoning = false,
				enableWebSearch = false,
				mcpTools,
				mcpCallTool,
				mcpMaxToolCallLoops,
				...remains
			} = options
			if (!apiKey) throw new Error(t('API key is required'))
			if (!model) throw new Error(t('Model is required'))

			const hasMcpToolRuntime =
				Array.isArray(mcpTools)
				&& mcpTools.length > 0
				&& typeof mcpCallTool === 'function'

			const responseBaseParams = poeMapResponsesParams(remains as Record<string, unknown>)
			const toolCandidates = mergeResponseTools(
				responseBaseParams.tools,
				enableWebSearch,
				hasMcpToolRuntime ? mcpTools : undefined
			)
			delete responseBaseParams.tools

			const maxToolCallLoops =
				typeof mcpMaxToolCallLoops === 'number' && mcpMaxToolCallLoops > 0
					? mcpMaxToolCallLoops
					: DEFAULT_MCP_TOOL_LOOP_LIMIT

			const responseInput = await Promise.all(messages.map((msg) => formatMsgForResponses(msg, resolveEmbedAsBinary)))
			const normalizedBaseURL = normalizePoeBaseURL(String(baseURL ?? ''))
			const client = new OpenAI({
				apiKey: String(apiKey),
				baseURL: normalizedBaseURL,
				dangerouslyAllowBrowser: true
			})

			const runResponsesWithOpenAISdk = async function* () {
				let currentInput: unknown = responseInput
				let previousResponseId: string | undefined
				let continuationReasoningEnabled = enableReasoning
				// 同时维护累积式输入，用于 previous_response_id 链过深遇到 5xx 时回退
				const accumulatedInput: unknown[] = [...(responseInput as unknown[])]

				const buildResponsesRequestData = (
					input: unknown,
					previousId: string | undefined,
					mode: 'default' | 'compat',
					allowContinuationReasoning = true
				): Record<string, unknown> => {
					const isToolContinuation = isFunctionCallOutputInput(input)
					const data: Record<string, unknown> = {
						model,
						stream: true,
						input
					}
					if (mode === 'default') {
						Object.assign(data, responseBaseParams)
					}
					if (previousId) {
						data.previous_response_id = previousId
					}
					const shouldAttachTools =
						toolCandidates.length > 0
						&& (mode === 'compat' ? isToolContinuation : !isToolContinuation)
					if (shouldAttachTools) {
						data.tools = toolCandidates
					}
					const shouldAttachReasoning =
						enableReasoning
						&& data.reasoning === undefined
						&& (!isToolContinuation || (continuationReasoningEnabled && allowContinuationReasoning))
					if (shouldAttachReasoning) {
						data.reasoning = { effort: 'medium' }
					}
					return data
				}

				// 构建累积式回退请求数据（不使用 previous_response_id）
				const buildAccumulatedRequestData = (): Record<string, unknown> => {
					const data: Record<string, unknown> = {
						model,
						stream: true,
						...responseBaseParams,
						input: accumulatedInput
					}
					if (toolCandidates.length > 0) {
						data.tools = toolCandidates
					}
					if (enableReasoning && continuationReasoningEnabled && data.reasoning === undefined) {
						data.reasoning = { effort: 'medium' }
					}
					if (!continuationReasoningEnabled) {
						delete data.reasoning
					}
					return data
				}

				for (let loop = 0; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					const isToolContinuationTurn = isFunctionCallOutputInput(currentInput)
					let stream: Awaited<ReturnType<typeof client.responses.create>> | undefined

					try {
						stream = await client.responses.create(
							buildResponsesRequestData(currentInput, previousResponseId, 'default') as any,
							{
								signal: controller.signal
							}
						)
					} catch (error) {
						let requestError: unknown = error

						if (
							isToolContinuationTurn
							&& continuationReasoningEnabled
							&& shouldRetryContinuationWithoutReasoning(requestError)
						) {
							continuationReasoningEnabled = false
							try {
								stream = await client.responses.create(
									buildResponsesRequestData(currentInput, previousResponseId, 'default', false) as any,
									{ signal: controller.signal }
								)
							} catch (retryWithoutReasoningError) {
								requestError = retryWithoutReasoningError
							}
						}

						if (!stream) {
							// 链式续轮遇到 5xx 时，降级为累积式输入重试（避免 previous_response_id 链过深）
							const errorStatus = resolveErrorStatus(requestError)
							if (errorStatus !== undefined && errorStatus >= 500 && loop > 0) {
								stream = await client.responses.create(
									buildAccumulatedRequestData() as any,
									{ signal: controller.signal }
								)
							} else if (shouldRetryFunctionOutputTurn400(requestError, currentInput)) {
								// 兼容部分实现：function_call_output 续轮在默认参数下会返回 400，
								// 先改用最小请求体并补发 tools 重试；若仍失败，再降级为 message 续轮。
								try {
									stream = await client.responses.create(
										buildResponsesRequestData(currentInput, previousResponseId, 'compat') as any,
										{
											signal: controller.signal
										}
									)
								} catch (compatError) {
									if (!shouldRetryFunctionOutputTurn400(compatError, currentInput)) {
										throw compatError
									}
									stream = await client.responses.create(
										buildResponsesRequestData(
											toToolResultContinuationInput(currentInput),
											previousResponseId,
											'default'
										) as any,
										{
											signal: controller.signal
										}
									)
								}
							} else {
								throw requestError
							}
						}
					}

					let completedResponse: any = null
					let reasoningActive = false
					let reasoningStartMs: number | null = null

					for await (const event of stream as any) {
						if (isReasoningDeltaEvent(String(event.type ?? ''))) {
							if (!enableReasoning) continue
							const text = String(event.delta ?? '')
							if (!text) continue
							if (!reasoningActive) {
								reasoningActive = true
								reasoningStartMs = Date.now()
								yield buildReasoningBlockStart(reasoningStartMs)
							}
							yield text
							continue
						}

						if (event.type === 'response.output_text.delta') {
							const text = String(event.delta ?? '')
							if (!text) continue
							if (reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
							yield text
							continue
						}

						if (event.type === 'response.completed') {
							completedResponse = event.response
							if (reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
						}
					}

					if (reasoningActive) {
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						yield buildReasoningBlockEnd(durationMs)
					}

					const functionCalls = extractResponseFunctionCalls(completedResponse)
					if (functionCalls.length === 0) {
						return
					}

					if (!hasMcpToolRuntime || !Array.isArray(mcpTools) || typeof mcpCallTool !== 'function') {
						throw new Error('Poe Responses 返回了 function_call，但未配置 MCP 工具执行器。')
					}
					if (loop >= maxToolCallLoops) {
						throw new Error(`Poe MCP tool loop exceeded maximum iterations (${maxToolCallLoops})`)
					}
					if (!completedResponse?.id) {
						throw new Error('Poe Responses 缺少 response.id，无法继续工具循环。')
					}

					const executed = await executePoeMcpToolCalls(functionCalls, mcpTools, mcpCallTool)
					for (const marker of executed.markers) {
						yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
					}
					// 更新链式状态
					previousResponseId = String(completedResponse.id)
					currentInput = executed.nextInputItems
					// 同时更新累积式输入，用于 5xx 回退
					accumulatedInput.push(...extractResponseOutputItems(completedResponse))
					accumulatedInput.push(...executed.nextInputItems)
				}
			}

			const runResponsesWithDesktopFetchSse = async function* () {
				let currentInput: unknown = responseInput
				let previousResponseId: string | undefined
				let continuationReasoningEnabled = enableReasoning
				// 同时维护累积式输入，用于 previous_response_id 链过深遇到 5xx 时回退
				const accumulatedInput: unknown[] = [...(responseInput as unknown[])]
				const requestResponsesStreamWithRetry = (body: Record<string, unknown>) =>
					withRetry(
						() =>
							requestResponsesStreamByFetch(
								ensureResponseEndpoint(String(baseURL ?? '')),
								String(apiKey),
								body,
								controller.signal
							),
						{
							...POE_RETRY_OPTIONS,
							signal: controller.signal
						}
					)

				const buildResponsesRequestData = (
					input: unknown,
					previousId: string | undefined,
					mode: 'default' | 'compat',
					allowContinuationReasoning = true
				): Record<string, unknown> => {
					const isToolContinuation = isFunctionCallOutputInput(input)
					const data: Record<string, unknown> = {
						model,
						input
					}
					if (mode === 'default') {
						Object.assign(data, responseBaseParams)
					}
					if (previousId) {
						data.previous_response_id = previousId
					}
					const shouldAttachTools =
						toolCandidates.length > 0
						&& (mode === 'compat' ? isToolContinuation : !isToolContinuation)
					if (shouldAttachTools) {
						data.tools = toolCandidates
					}
					const shouldAttachReasoning =
						enableReasoning
						&& data.reasoning === undefined
						&& (!isToolContinuation || (continuationReasoningEnabled && allowContinuationReasoning))
					if (shouldAttachReasoning) {
						data.reasoning = { effort: 'medium' }
					}
					return data
				}

				const buildAccumulatedRequestData = (): Record<string, unknown> => {
					const data: Record<string, unknown> = {
						model,
						...responseBaseParams,
						input: accumulatedInput
					}
					if (toolCandidates.length > 0) {
						data.tools = toolCandidates
					}
					if (enableReasoning && continuationReasoningEnabled && data.reasoning === undefined) {
						data.reasoning = { effort: 'medium' }
					}
					if (!continuationReasoningEnabled) {
						delete data.reasoning
					}
					return data
				}

				for (let loop = 0; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					const isToolContinuationTurn = isFunctionCallOutputInput(currentInput)
					let reader: ReadableStreamDefaultReader<string> | undefined

					try {
						reader = await requestResponsesStreamWithRetry(
							buildResponsesRequestData(currentInput, previousResponseId, 'default')
						)
					} catch (error) {
						let requestError: unknown = error

						if (
							isToolContinuationTurn
							&& continuationReasoningEnabled
							&& shouldRetryContinuationWithoutReasoning(requestError)
						) {
							continuationReasoningEnabled = false
							try {
								reader = await requestResponsesStreamWithRetry(
									buildResponsesRequestData(currentInput, previousResponseId, 'default', false)
								)
							} catch (retryWithoutReasoningError) {
								requestError = retryWithoutReasoningError
							}
						}

						if (!reader) {
							const errorStatus = resolveErrorStatus(requestError)
							if (errorStatus !== undefined && errorStatus >= 500 && loop > 0) {
								reader = await requestResponsesStreamWithRetry(buildAccumulatedRequestData())
							} else if (shouldRetryFunctionOutputTurn400(requestError, currentInput)) {
								try {
									reader = await requestResponsesStreamWithRetry(
										buildResponsesRequestData(currentInput, previousResponseId, 'compat')
									)
								} catch (compatError) {
									if (!shouldRetryFunctionOutputTurn400(compatError, currentInput)) {
										throw compatError
									}
									reader = await requestResponsesStreamWithRetry(
										buildResponsesRequestData(
											toToolResultContinuationInput(currentInput),
											previousResponseId,
											'default'
										)
									)
								}
							} else {
								throw requestError
							}
						}
					}

					let completedResponse: any = null
					let reasoningActive = false
					let reasoningStartMs: number | null = null
					let reading = true
					let sseRest = ''

					const processEvents = async function* (events: Array<{ isDone: boolean; parseError?: string; json?: unknown }>) {
						for (const event of events) {
							if (event.isDone) {
								reading = false
								break
							}
							const payload = event.json as Record<string, unknown> | undefined
							if (!payload) continue
							const eventType = String(payload.type ?? '')

							if (isReasoningDeltaEvent(eventType)) {
								if (!enableReasoning) continue
								const text = String(payload.delta ?? '')
								if (!text) continue
								if (!reasoningActive) {
									reasoningActive = true
									reasoningStartMs = Date.now()
									yield buildReasoningBlockStart(reasoningStartMs)
								}
								yield text
								continue
							}

							if (eventType === 'response.output_text.delta') {
								const text = String(payload.delta ?? '')
								if (!text) continue
								if (reasoningActive) {
									reasoningActive = false
									const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
									reasoningStartMs = null
									yield buildReasoningBlockEnd(durationMs)
								}
								yield text
								continue
							}

							if (eventType === 'response.completed') {
								completedResponse = payload.response
								if (reasoningActive) {
									reasoningActive = false
									const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
									reasoningStartMs = null
									yield buildReasoningBlockEnd(durationMs)
								}
							}
						}
					}

					while (reading) {
						const { done, value } = await reader.read()
						if (done) {
							const flushed = feedChunk(sseRest, '\n\n')
							sseRest = flushed.rest
							for await (const text of processEvents(flushed.events)) {
								yield text
							}
							reading = false
							break
						}
						const parsed = feedChunk(sseRest, value ?? '')
						sseRest = parsed.rest
						for await (const text of processEvents(parsed.events)) {
							yield text
						}
					}

					if (reasoningActive) {
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						yield buildReasoningBlockEnd(durationMs)
					}

					if (!completedResponse) {
						throw new Error('Poe Responses stream ended without response.completed payload')
					}

					const functionCalls = extractResponseFunctionCalls(completedResponse)
					if (functionCalls.length === 0) {
						return
					}

					if (!hasMcpToolRuntime || !Array.isArray(mcpTools) || typeof mcpCallTool !== 'function') {
						throw new Error('Poe Responses 返回了 function_call，但未配置 MCP 工具执行器。')
					}
					if (loop >= maxToolCallLoops) {
						throw new Error(`Poe MCP tool loop exceeded maximum iterations (${maxToolCallLoops})`)
					}
					if (!completedResponse?.id) {
						throw new Error('Poe Responses 缺少 response.id，无法继续工具循环。')
					}

					const executed = await executePoeMcpToolCalls(functionCalls, mcpTools, mcpCallTool)
					for (const marker of executed.markers) {
						yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
					}
					previousResponseId = String(completedResponse.id)
					currentInput = executed.nextInputItems
					accumulatedInput.push(...extractResponseOutputItems(completedResponse))
					accumulatedInput.push(...executed.nextInputItems)
				}
			}

			const runResponsesWithDesktopRequestUrl = async function* () {
				let currentInput: unknown = responseInput
				let previousResponseId: string | undefined
				let continuationReasoningEnabled = enableReasoning
				// 同时维护累积式输入，用于 previous_response_id 链过深遇到 5xx 时回退
				const accumulatedInput: unknown[] = [...(responseInput as unknown[])]
				const requestResponsesWithRetry = (body: Record<string, unknown>) =>
					withRetry(
						() =>
							requestResponsesByRequestUrl(
								ensureResponseEndpoint(String(baseURL ?? '')),
								String(apiKey),
								body
							),
						{
							...POE_RETRY_OPTIONS,
							signal: controller.signal
						}
					)

				const buildResponsesRequestData = (
					input: unknown,
					previousId: string | undefined,
					mode: 'default' | 'compat',
					allowContinuationReasoning = true
				): Record<string, unknown> => {
					const isToolContinuation = isFunctionCallOutputInput(input)
					const data: Record<string, unknown> = {
						model,
						input
					}
					if (mode === 'default') {
						Object.assign(data, responseBaseParams)
					}
					if (previousId) {
						data.previous_response_id = previousId
					}
					const shouldAttachTools =
						toolCandidates.length > 0
						&& (mode === 'compat' ? isToolContinuation : !isToolContinuation)
					if (shouldAttachTools) {
						data.tools = toolCandidates
					}
					const shouldAttachReasoning =
						enableReasoning
						&& data.reasoning === undefined
						&& (!isToolContinuation || (continuationReasoningEnabled && allowContinuationReasoning))
					if (shouldAttachReasoning) {
						data.reasoning = { effort: 'medium' }
					}
					return data
				}

				const buildAccumulatedRequestData = (): Record<string, unknown> => {
					const data: Record<string, unknown> = {
						model,
						...responseBaseParams,
						input: accumulatedInput
					}
					if (toolCandidates.length > 0) {
						data.tools = toolCandidates
					}
					if (enableReasoning && continuationReasoningEnabled && data.reasoning === undefined) {
						data.reasoning = { effort: 'medium' }
					}
					if (!continuationReasoningEnabled) {
						delete data.reasoning
					}
					return data
				}

				for (let loop = 0; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					const isToolContinuationTurn = isFunctionCallOutputInput(currentInput)
					let response: any
					try {
						response = await requestResponsesWithRetry(
							buildResponsesRequestData(currentInput, previousResponseId, 'default')
						)
					} catch (error) {
						let requestError: unknown = error

						if (
							isToolContinuationTurn
							&& continuationReasoningEnabled
							&& shouldRetryContinuationWithoutReasoning(requestError)
						) {
							continuationReasoningEnabled = false
							try {
								response = await requestResponsesWithRetry(
									buildResponsesRequestData(currentInput, previousResponseId, 'default', false)
								)
							} catch (retryWithoutReasoningError) {
								requestError = retryWithoutReasoningError
							}
						}

						if (!response) {
							// 链式续轮遇到 5xx 时，降级为累积式输入重试（避免 previous_response_id 链过深）
							const errorStatus = resolveErrorStatus(requestError)
							if (errorStatus !== undefined && errorStatus >= 500 && loop > 0) {
								response = await requestResponsesWithRetry(buildAccumulatedRequestData())
							} else if (shouldRetryFunctionOutputTurn400(requestError, currentInput)) {
								try {
									response = await requestResponsesWithRetry(
										buildResponsesRequestData(currentInput, previousResponseId, 'compat')
									)
								} catch (compatError) {
									if (!shouldRetryFunctionOutputTurn400(compatError, currentInput)) {
										throw compatError
									}
									response = await requestResponsesWithRetry(
										buildResponsesRequestData(
											toToolResultContinuationInput(currentInput),
											previousResponseId,
											'default'
										)
									)
								}
							} else {
								throw requestError
							}
						}
					}

					if (enableReasoning) {
						const reasoningText = extractReasoningTextFromResponse(response)
						if (reasoningText) {
							const startMs = Date.now()
							yield buildReasoningBlockStart(startMs)
							yield reasoningText
							const durationMs = Math.max(10, Date.now() - startMs)
							yield buildReasoningBlockEnd(durationMs)
						}
					}

					const functionCalls = extractResponseFunctionCalls(response)
					if (functionCalls.length === 0) {
						const text = extractOutputTextFromResponse(response)
						if (text) yield text
						return
					}

					if (!hasMcpToolRuntime || !Array.isArray(mcpTools) || typeof mcpCallTool !== 'function') {
						throw new Error('Poe Responses 返回了 function_call，但未配置 MCP 工具执行器。')
					}
					if (loop >= maxToolCallLoops) {
						throw new Error(`Poe MCP tool loop exceeded maximum iterations (${maxToolCallLoops})`)
					}
					if (!response?.id) {
						throw new Error('Poe Responses 缺少 response.id，无法继续工具循环。')
					}

					const executed = await executePoeMcpToolCalls(functionCalls, mcpTools, mcpCallTool)
					for (const marker of executed.markers) {
						yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
					}
					// 更新链式状态
					previousResponseId = String(response.id)
					currentInput = executed.nextInputItems
					// 同时更新累积式输入，用于 5xx 回退
					accumulatedInput.push(...extractResponseOutputItems(response))
					accumulatedInput.push(...executed.nextInputItems)
				}
			}

			const chatFallbackParams = mapResponsesParamsToChatParams(responseBaseParams)

			// 纯 Chat Completions MCP 工具循环（流式输出，支持工具调用 delta 累积）
			const runPureChatCompletionsMcpLoop = async function* (prebuiltMessages?: any[]) {
				// 将 MCP 工具转换为 Chat Completions 标准格式
				const chatTools = mcpTools!.map((tool) => ({
					type: 'function' as const,
					function: {
						name: tool.name,
						description: tool.description || '',
						parameters: tool.inputSchema as Record<string, unknown>
					}
				}))

				const loopMessages: any[] = prebuiltMessages
					? [...prebuiltMessages]
					: [...await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))]

				/**
				 * 使用流式 SSE 请求一轮 Chat Completions，逐 token yield 文本内容，
				 * 同时累积工具调用 delta。返回 { toolCalls, contentText } 以便循环继续。
				 */
				const streamOneChatRound = async function* (
					roundMessages: any[],
					tools?: any[]
				): AsyncGenerator<string, { toolCalls: OpenAIToolCall[]; contentText: string }, undefined> {
					const body: Record<string, unknown> = {
						model,
						messages: roundMessages,
						...chatFallbackParams
					}
					if (tools && tools.length > 0) {
						body.tools = tools
					}
					// 当启用推理时，通过请求体直接传递推理参数
					// 根据 Poe 文档，Chat Completions 标准 reasoning_effort 被忽略，
					// 需要通过 extra_body 方式（即请求体自定义字段）传递
					if (enableReasoning) {
						body.reasoning_effort = 'medium'
					}

					const reader = await requestChatCompletionStreamByFetch(
						ensureCompletionEndpoint(String(baseURL ?? '')),
						String(apiKey),
						body,
						controller.signal
					)

					let sseRest = ''
					let reading = true
					let contentText = ''
					// 工具调用 delta 累积器：按 index 组织
					const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map()
					// 推理内容状态
					let reasoningActive = false
					let reasoningStartMs: number | null = null
					let reasoningBuffer = ''

					while (reading) {
						const { done, value } = await reader.read()
						if (done) {
							// 刷新缓冲区中剩余的 SSE 帧
							const flushed = feedChunk(sseRest, '\n\n')
							for (const event of flushed.events) {
								if (event.isDone) break
								const payload = event.json as any
								if (!payload) continue
								const delta = payload.choices?.[0]?.delta
								if (!delta) continue

								// 处理推理内容
								const reasoningText = delta.reasoning_content
								if (reasoningText && enableReasoning) {
									if (!reasoningActive) {
										reasoningActive = true
										reasoningStartMs = Date.now()
										yield buildReasoningBlockStart(reasoningStartMs)
									}
									reasoningBuffer += reasoningText
									yield reasoningText
								}

								const text = delta.content
								if (typeof text === 'string' && text) {
									// 推理结束
									if (reasoningActive && reasoningBuffer.length > 0) {
										const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
										yield buildReasoningBlockEnd(durationMs)
										reasoningActive = false
										reasoningBuffer = ''
										reasoningStartMs = null
									}
									contentText += text
									yield text
								}
								// 累积工具调用 delta
								if (Array.isArray(delta.tool_calls)) {
									// 推理结束（工具调用前）
									if (reasoningActive && reasoningBuffer.length > 0) {
										const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
										yield buildReasoningBlockEnd(durationMs)
										reasoningActive = false
										reasoningBuffer = ''
										reasoningStartMs = null
									}
									for (const tc of delta.tool_calls) {
										const idx = tc.index ?? 0
										if (!toolCallAccum.has(idx)) {
											toolCallAccum.set(idx, { id: '', name: '', arguments: '' })
										}
										const acc = toolCallAccum.get(idx)!
										if (tc.id) acc.id = tc.id
										if (tc.function?.name) acc.name += tc.function.name
										if (tc.function?.arguments) acc.arguments += tc.function.arguments
									}
								}
							}
							reading = false
							break
						}

						const parsed = feedChunk(sseRest, value ?? '')
						sseRest = parsed.rest

						for (const event of parsed.events) {
							if (event.isDone) {
								reading = false
								break
							}
							const payload = event.json as any
							if (!payload) continue
							const delta = payload.choices?.[0]?.delta
							if (!delta) continue

							// 处理推理内容
							const reasoningText = delta.reasoning_content
							if (reasoningText && enableReasoning) {
								if (!reasoningActive) {
									reasoningActive = true
									reasoningStartMs = Date.now()
									yield buildReasoningBlockStart(reasoningStartMs)
								}
								reasoningBuffer += reasoningText
								yield reasoningText
							}

							const text = delta.content
							if (typeof text === 'string' && text) {
								// 推理结束
								if (reasoningActive && reasoningBuffer.length > 0) {
									const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
									yield buildReasoningBlockEnd(durationMs)
									reasoningActive = false
									reasoningBuffer = ''
									reasoningStartMs = null
								}
								contentText += text
								yield text
							}
							// 累积工具调用 delta
							if (Array.isArray(delta.tool_calls)) {
								// 推理结束（工具调用前）
								if (reasoningActive && reasoningBuffer.length > 0) {
									const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
									yield buildReasoningBlockEnd(durationMs)
									reasoningActive = false
									reasoningBuffer = ''
									reasoningStartMs = null
								}
								for (const tc of delta.tool_calls) {
									const idx = tc.index ?? 0
									if (!toolCallAccum.has(idx)) {
										toolCallAccum.set(idx, { id: '', name: '', arguments: '' })
									}
									const acc = toolCallAccum.get(idx)!
									if (tc.id) acc.id = tc.id
									if (tc.function?.name) acc.name += tc.function.name
									if (tc.function?.arguments) acc.arguments += tc.function.arguments
								}
							}
						}
					}

					// 流结束时关闭推理块
					if (reasoningActive && reasoningBuffer.length > 0) {
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						yield buildReasoningBlockEnd(durationMs)
					}

					// 转换累积的工具调用为标准格式
					const toolCalls: OpenAIToolCall[] = []
					for (const [, acc] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
						if (acc.name) {
							toolCalls.push({
								id: acc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
								type: 'function' as const,
								function: { name: acc.name, arguments: acc.arguments || '{}' }
							})
						}
					}

					return { toolCalls, contentText }
				}

				for (let loop = 0; loop < maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					// 使用 streamOneChatRound 流式请求，逐 token yield 文本，同时累积工具调用
					const gen = streamOneChatRound(loopMessages, chatTools)
					let result = await gen.next()
					while (!result.done) {
						yield result.value
						result = await gen.next()
					}
					const { toolCalls, contentText } = result.value

					if (toolCalls.length === 0) {
						// 没有工具调用，流式文本已经 yield 完毕
						return
					}

					// 将 assistant 消息（含 tool_calls）加入历史
					loopMessages.push({
						role: 'assistant',
						content: contentText || null,
						tool_calls: toolCalls.map((tc) => ({
							id: tc.id,
							type: 'function',
							function: { name: tc.function.name, arguments: tc.function.arguments }
						}))
					})

					// 执行工具调用
					const results = await executeMcpToolCalls(toolCalls, mcpTools!, mcpCallTool!)

					// 将工具结果加入历史，并 yield MCP 标记
					for (const result of results) {
						loopMessages.push(result)
						const resultContent = typeof result.content === 'string' ? result.content : ''
						yield `{{FF_MCP_TOOL_START}}:${result.name || ''}:${resultContent}{{FF_MCP_TOOL_END}}:`
					}
				}

				// 达到最大循环次数，最后一次请求不带工具（仍使用流式）
				const finalGen = streamOneChatRound(loopMessages)
				let finalResult = await finalGen.next()
				while (!finalResult.done) {
					yield finalResult.value
					finalResult = await finalGen.next()
				}
			}

			// 混合 MCP 工具循环：第一轮 Responses API（推理 + 联网搜索），后续轮次 Responses API 累积输入
			const runMcpHybridToolLoop = async function* () {
				// ── Phase 1: 第一轮使用 Responses API 原生 fetch SSE（绕过 SDK 缓冲） ──
				const firstRoundData: Record<string, unknown> = {
					model,
					input: responseInput,
					...responseBaseParams
				}
				if (toolCandidates.length > 0) {
					firstRoundData.tools = toolCandidates
				}
				if (enableReasoning && firstRoundData.reasoning === undefined) {
					firstRoundData.reasoning = { effort: 'medium' }
				}

				let firstCompletedResponse: any = null
				let firstRoundText = ''
				let responsesApiOk = true

				try {
					const reader = await requestResponsesStreamByFetch(
						ensureResponseEndpoint(String(baseURL ?? '')),
						String(apiKey),
						firstRoundData,
						controller.signal
					)

					let sseRest = ''
					let reading = true
					let reasoningActive = false
					let reasoningStartMs: number | null = null

					const processResponsesEvent = function* (payload: any) {
						if (!payload) return
						const eventType = String(payload.type ?? '')

						if (isReasoningDeltaEvent(eventType)) {
							if (!enableReasoning) return
							const text = String(payload.delta ?? '')
							if (!text) return
							if (!reasoningActive) {
								reasoningActive = true
								reasoningStartMs = Date.now()
								yield buildReasoningBlockStart(reasoningStartMs)
							}
							yield text
							return
						}

						if (eventType === 'response.output_text.delta') {
							const text = String(payload.delta ?? '')
							if (!text) return
							if (reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
							firstRoundText += text
							yield text
							return
						}

						if (eventType === 'response.completed') {
							firstCompletedResponse = payload.response
							if (reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
						}
					}

					while (reading) {
						const { done, value } = await reader.read()
						if (done) {
							const flushed = feedChunk(sseRest, '\n\n')
							for (const event of flushed.events) {
								if (event.isDone) break
								yield* processResponsesEvent(event.json)
							}
							reading = false
							break
						}

						const parsed = feedChunk(sseRest, value ?? '')
						sseRest = parsed.rest

						for (const event of parsed.events) {
							if (event.isDone) {
								reading = false
								break
							}
							yield* processResponsesEvent(event.json)
						}
					}

					if (reasoningActive) {
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						yield buildReasoningBlockEnd(durationMs)
					}
				} catch (responsesError) {
					// 仅在 Responses API 不被支持时降级到 Chat Completions；
					// 429（速率限制）等错误直接抛出，不做额外请求以免加重限流
					if (shouldFallbackToChatCompletions(responsesError)) {
						responsesApiOk = false
					} else {
						throw responsesError
					}
				}

				// Responses API 不支持 → 降级到纯 Chat Completions（无推理/联网搜索）
				if (!responsesApiOk) {
					for await (const chunk of runPureChatCompletionsMcpLoop()) {
						yield chunk
					}
					return
				}

				// 没有工具调用 → 第一轮完成
				const firstFunctionCalls = extractResponseFunctionCalls(firstCompletedResponse)
				if (firstFunctionCalls.length === 0) return

				// ── Phase 2: 执行工具 → 后续轮次使用 Responses API 累积式输入 ──
				// 使用纯累积式输入：将完整对话历史（原始 input + 所有 function_call + function_call_output）
				// 作为 input 发送，让服务端重新构建上下文。
				// 续轮优先携带 reasoning；若遇到兼容性错误，自动降级到无 reasoning 后重试当前轮次。
				const executed = await executePoeMcpToolCalls(firstFunctionCalls, mcpTools!, mcpCallTool!)
				for (const marker of executed.markers) {
					yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
				}

				const hybridAccumulatedInput: unknown[] = [
					...(responseInput as unknown[]),
					...extractResponseOutputItems(firstCompletedResponse),
					...executed.nextInputItems
				]
				let continuationReasoningEnabled = enableReasoning

				const buildHybridAccumulatedData = (): Record<string, unknown> => {
					const data: Record<string, unknown> = {
						model,
						...responseBaseParams,
						input: hybridAccumulatedInput
					}
					if (toolCandidates.length > 0) {
						data.tools = toolCandidates
					}
					if (enableReasoning && continuationReasoningEnabled && data.reasoning === undefined) {
						data.reasoning = { effort: 'medium' }
					}
					if (!continuationReasoningEnabled) {
						delete data.reasoning
					}
					return data
				}

				let responsesApiFailed = false
				for (let loop = 1; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					let reader: ReadableStreamDefaultReader<string> | undefined

					try {
						reader = await requestResponsesStreamByFetch(
							ensureResponseEndpoint(String(baseURL ?? '')),
							String(apiKey),
							buildHybridAccumulatedData(),
							controller.signal
						)
					} catch (error) {
						let requestError: unknown = error
						if (
							continuationReasoningEnabled
							&& shouldRetryContinuationWithoutReasoning(requestError)
						) {
							continuationReasoningEnabled = false
							try {
								reader = await requestResponsesStreamByFetch(
									ensureResponseEndpoint(String(baseURL ?? '')),
									String(apiKey),
									buildHybridAccumulatedData(),
									controller.signal
								)
							} catch (retryWithoutReasoningError) {
								requestError = retryWithoutReasoningError
							}
						}
						if (!reader) {
							// 任何错误（5xx、连接中断、不支持等）均降级到 Chat Completions
							responsesApiFailed = true
							break
						}
					}

					// 读取 SSE 流并处理推理 + 文本 + 工具调用事件
					let completedResponse: any = null
					let roundText = ''
					let reasoningActive = false
					let reasoningStartMs: number | null = null
					let reading = true
					let sseRest = ''

					const processHybridSseEvent = function* (payload: Record<string, unknown> | undefined) {
						if (!payload) return
						const eventType = String(payload.type ?? '')

						if (isReasoningDeltaEvent(eventType)) {
							if (!enableReasoning) return
							const text = String(payload.delta ?? '')
							if (!text) return
							if (!reasoningActive) {
								reasoningActive = true
								reasoningStartMs = Date.now()
								yield buildReasoningBlockStart(reasoningStartMs)
							}
							yield text
							return
						}

						if (eventType === 'response.output_text.delta') {
							const text = String(payload.delta ?? '')
							if (!text) return
							if (reasoningActive) {
								reasoningActive = false
								yield buildReasoningBlockEnd(Date.now() - (reasoningStartMs ?? Date.now()))
								reasoningStartMs = null
							}
							roundText += text
							yield text
							return
						}

						if (eventType === 'response.completed') {
							completedResponse = payload.response
							if (reasoningActive) {
								reasoningActive = false
								yield buildReasoningBlockEnd(Date.now() - (reasoningStartMs ?? Date.now()))
								reasoningStartMs = null
							}
						}
					}

					try {
						while (reading) {
							const { done, value } = await reader.read()
							if (done) {
								const flushed = feedChunk(sseRest, '\n\n')
								for (const event of flushed.events) {
									if (event.isDone) break
									yield* processHybridSseEvent(event.json as Record<string, unknown> | undefined)
								}
								reading = false
								break
							}

							const parsed = feedChunk(sseRest, value ?? '')
							sseRest = parsed.rest

							for (const event of parsed.events) {
								if (event.isDone) {
									reading = false
									break
								}
								yield* processHybridSseEvent(event.json as Record<string, unknown> | undefined)
							}
						}
					} catch {
						// SSE 流读取中断（ERR_CONNECTION_CLOSED 等）→ 降级到 Chat Completions
						if (reasoningActive) {
							yield buildReasoningBlockEnd(Date.now() - (reasoningStartMs ?? Date.now()))
						}
						responsesApiFailed = true
						break
					}

					if (reasoningActive) {
						yield buildReasoningBlockEnd(Date.now() - (reasoningStartMs ?? Date.now()))
					}

					if (!completedResponse) break

					const continuationCalls = extractResponseFunctionCalls(completedResponse)
					if (continuationCalls.length === 0) return

					const continuationExecuted = await executePoeMcpToolCalls(continuationCalls, mcpTools!, mcpCallTool!)
					for (const marker of continuationExecuted.markers) {
						yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
					}

					hybridAccumulatedInput.push(...extractResponseOutputItems(completedResponse))
					hybridAccumulatedInput.push(...continuationExecuted.nextInputItems)
				}

				// Responses API 续轮失败 → 最终降级到 Chat Completions 循环（无推理但保证可用）
				if (responsesApiFailed) {
					const chatHistoryMessages = await Promise.all(
						messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary))
					)
					const continuationMessages: any[] = [
						...chatHistoryMessages,
						{
							role: 'assistant',
							content: firstRoundText || null,
							tool_calls: firstFunctionCalls.map((call) => ({
								id: call.id,
								type: 'function',
								function: { name: call.name, arguments: call.arguments }
							}))
						},
						...firstFunctionCalls.map((call, i) => ({
							role: 'tool',
							tool_call_id: call.id,
							content: executed.nextInputItems[i]?.output ?? ''
						}))
					]
					for await (const chunk of runPureChatCompletionsMcpLoop(continuationMessages)) {
						yield chunk
					}
				}
			}

			const runChatCompletionFallback = async function* () {
				const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
				// 优先使用 SDK 流式输出（桌面端和浏览器均可用）
				try {
					const stream = await client.chat.completions.create(
						{
							model,
							messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
							stream: true,
							...chatFallbackParams
						},
						{ signal: controller.signal }
					)

					let reasoningActive = false
					let reasoningStartMs: number | null = null

					for await (const part of stream) {
						const delta: any = part.choices[0]?.delta

						// 处理推理内容（delta.reasoning_content）
						const reasoningText = delta?.reasoning_content
						if (reasoningText && enableReasoning) {
							if (!reasoningActive) {
								reasoningActive = true
								reasoningStartMs = Date.now()
								yield buildReasoningBlockStart(reasoningStartMs)
							}
							yield reasoningText
						}

						const text = delta?.content
						if (text) {
							// 推理结束，转入正文输出
							if (reasoningActive) {
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								yield buildReasoningBlockEnd(durationMs)
								reasoningActive = false
								reasoningStartMs = null
							}
							yield text
						}
					}

					// 流结束时关闭推理块
					if (reasoningActive) {
						const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
						yield buildReasoningBlockEnd(durationMs)
					}
					return
				} catch (sdkStreamError) {
					// SDK 流式失败时仅在桌面端降级到 requestUrl 非流式
					if (!Platform.isDesktopApp) throw sdkStreamError
				}

				// 桌面端降级: requestUrl 非流式
				const response = await withRetry(
					() =>
						requestChatCompletionByRequestUrl(
							ensureCompletionEndpoint(String(baseURL ?? '')),
							String(apiKey),
							{
								model,
								messages: formattedMessages,
								...chatFallbackParams
							}
						),
					{
						...POE_RETRY_OPTIONS,
						signal: controller.signal
					}
				)
				const firstChoice = response?.choices?.[0]
				const message = firstChoice?.message ?? {}

				// 处理非流式响应中的推理内容
				if (enableReasoning) {
					const reasoningContent = (message as any).reasoning_content
					if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
						const startMs = Date.now()
						yield buildReasoningBlockStart(startMs)
						yield reasoningContent
						const durationMs = Math.max(10, Date.now() - startMs)
						yield buildReasoningBlockEnd(durationMs)
					}
				}

				const text = extractMessageText(message.content)
				if (text) yield text
			}

			// Chat Completions SDK 流式输出（通用路径，桌面和浏览器均可用）
			const runStreamingChatCompletion = async function* () {
				const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
				const stream = await client.chat.completions.create(
					{
						model,
						messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
						stream: true,
						...chatFallbackParams
					},
					{ signal: controller.signal }
				)

				let reasoningActive = false
				let reasoningStartMs: number | null = null

				for await (const part of stream) {
					const delta: any = part.choices[0]?.delta

					// 处理推理内容（delta.reasoning_content）
					const reasoningText = delta?.reasoning_content
					if (reasoningText && enableReasoning) {
						if (!reasoningActive) {
							reasoningActive = true
							reasoningStartMs = Date.now()
							yield buildReasoningBlockStart(reasoningStartMs)
						}
						yield reasoningText
					}

					const text = delta?.content
					if (text) {
						// 推理结束，转入正文输出
						if (reasoningActive) {
							const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
							yield buildReasoningBlockEnd(durationMs)
							reasoningActive = false
							reasoningStartMs = null
						}
						yield text
					}
				}

				// 流结束时关闭推理块
				if (reasoningActive) {
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					yield buildReasoningBlockEnd(durationMs)
				}
			}

			// Chat Completions 原生 fetch 流式输出（绕过 OpenAI SDK，直接解析 SSE）
			const runStreamingChatCompletionByFetch = async function* () {
				const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
				const reader = await requestChatCompletionStreamByFetch(
					ensureCompletionEndpoint(String(baseURL ?? '')),
					String(apiKey),
					{
						model,
						messages: formattedMessages,
						...chatFallbackParams
					},
					controller.signal
				)

				let sseRest = ''
				let reading = true
				let reasoningActive = false
				let reasoningStartMs: number | null = null

				/**
				 * 处理 Chat Completions SSE delta（提取推理内容和正文）
				 */
				const processChatDelta = function* (delta: any) {
					if (!delta) return

					// 处理推理内容（delta.reasoning_content）
					const reasoningText = delta.reasoning_content
					if (reasoningText && enableReasoning) {
						if (!reasoningActive) {
							reasoningActive = true
							reasoningStartMs = Date.now()
							yield buildReasoningBlockStart(reasoningStartMs)
						}
						yield String(reasoningText)
					}

					// 处理正文内容
					const text = delta.content
					if (typeof text === 'string' && text) {
						// 推理结束，转入正文输出
						if (reasoningActive) {
							const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
							yield buildReasoningBlockEnd(durationMs)
							reasoningActive = false
							reasoningStartMs = null
						}
						yield text
					}
				}

				while (reading) {
					const { done, value } = await reader.read()
					if (done) {
						// 刷新缓冲区中剩余的 SSE 帧
						const flushed = feedChunk(sseRest, '\n\n')
						for (const event of flushed.events) {
							if (event.isDone) break
							const payload = event.json as Record<string, unknown> | undefined
							if (!payload) continue
							const delta = (payload as any).choices?.[0]?.delta
							yield* processChatDelta(delta)
						}
						reading = false
						break
					}

					const parsed = feedChunk(sseRest, value ?? '')
					sseRest = parsed.rest

					for (const event of parsed.events) {
						if (event.isDone) {
							reading = false
							break
						}
						const payload = event.json as Record<string, unknown> | undefined
						if (!payload) continue
						const delta = (payload as any).choices?.[0]?.delta
						yield* processChatDelta(delta)
					}
				}

				// 流结束时关闭推理块
				if (reasoningActive) {
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					yield buildReasoningBlockEnd(durationMs)
				}
			}

			// Responses API 原生 fetch 流式输出（绕过 OpenAI SDK，直接解析 SSE，含推理支持）
			const runResponsesStreamByFetch = async function* () {
				const responseData: Record<string, unknown> = {
					model,
					input: responseInput,
					...responseBaseParams
				}
				if (toolCandidates.length > 0) {
					responseData.tools = toolCandidates
				}
				if (enableReasoning && responseData.reasoning === undefined) {
					responseData.reasoning = { effort: 'medium' }
				}

				const reader = await requestResponsesStreamByFetch(
					ensureResponseEndpoint(String(baseURL ?? '')),
					String(apiKey),
					responseData,
					controller.signal
				)

				let sseRest = ''
				let reading = true
				let reasoningActive = false
				let reasoningStartMs: number | null = null

				while (reading) {
					const { done, value } = await reader.read()
					if (done) {
						const flushed = feedChunk(sseRest, '\n\n')
						sseRest = flushed.rest
						for (const event of flushed.events) {
							if (event.isDone) break
							const payload = event.json as Record<string, unknown> | undefined
							if (!payload) continue
							const eventType = String(payload.type ?? '')

							if (isReasoningDeltaEvent(eventType)) {
								if (!enableReasoning) continue
								const text = String(payload.delta ?? '')
								if (!text) continue
								if (!reasoningActive) {
									reasoningActive = true
									reasoningStartMs = Date.now()
									yield buildReasoningBlockStart(reasoningStartMs)
								}
								yield text
								continue
							}

							if (eventType === 'response.output_text.delta') {
								const text = String(payload.delta ?? '')
								if (!text) continue
								if (reasoningActive) {
									reasoningActive = false
									const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
									reasoningStartMs = null
									yield buildReasoningBlockEnd(durationMs)
								}
								yield text
								continue
							}

							if (eventType === 'response.completed' && reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
						}
						reading = false
						break
					}

					const parsed = feedChunk(sseRest, value ?? '')
					sseRest = parsed.rest

					for (const event of parsed.events) {
						if (event.isDone) {
							reading = false
							break
						}
						const payload = event.json as Record<string, unknown> | undefined
						if (!payload) continue
						const eventType = String(payload.type ?? '')

						if (isReasoningDeltaEvent(eventType)) {
							if (!enableReasoning) continue
							const text = String(payload.delta ?? '')
							if (!text) continue
							if (!reasoningActive) {
								reasoningActive = true
								reasoningStartMs = Date.now()
								yield buildReasoningBlockStart(reasoningStartMs)
							}
							yield text
							continue
						}

						if (eventType === 'response.output_text.delta') {
							const text = String(payload.delta ?? '')
							if (!text) continue
							if (reasoningActive) {
								reasoningActive = false
								const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
								reasoningStartMs = null
								yield buildReasoningBlockEnd(durationMs)
							}
							yield text
							continue
						}

						if (eventType === 'response.completed' && reasoningActive) {
							reasoningActive = false
							const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
							reasoningStartMs = null
							yield buildReasoningBlockEnd(durationMs)
						}
					}
				}

				if (reasoningActive) {
					const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
					yield buildReasoningBlockEnd(durationMs)
				}
			}

			try {
				// MCP 工具调用使用混合策略：第一轮 Responses API（支持推理 + 联网搜索），
				// 后续工具轮次使用 Chat Completions API（避免 previous_response_id 链导致 5xx）
				if (hasMcpToolRuntime) {
					yield* smoothStream(wrapWithThinkTagDetection(runMcpHybridToolLoop(), enableReasoning))
					return
				}

				// 非 MCP 路径：使用原生 fetch SSE 流式输出（绕过 OpenAI SDK 内部缓冲）
				if (!enableReasoning && !enableWebSearch) {
					// 无推理/联网搜索时使用 Chat Completions API 原生 fetch 流式
					yield* smoothStream(wrapWithThinkTagDetection(runStreamingChatCompletionByFetch(), enableReasoning))
					return
				}

				// 启用推理或联网搜索时使用 Responses API 原生 fetch 流式
				yield* smoothStream(wrapWithThinkTagDetection(runResponsesStreamByFetch(), enableReasoning))
				return
				} catch (error) {
					// MCP 路径：优先保证流式，失败后在桌面端依次降级到 fetch-stream / requestUrl responses
					if (hasMcpToolRuntime) {
						if (Platform.isDesktopApp) {
							try {
								yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithDesktopFetchSse(), enableReasoning))
								return
							} catch (desktopMcpStreamError) {
								try {
									yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithDesktopRequestUrl(), enableReasoning))
									return
								} catch (desktopMcpError) {
									throw desktopMcpError
								}
							}
						}
						throw error
					}

				// 429 等速率限制错误不应再触发额外请求
				const errorStatus = resolveErrorStatus(error)
				if (errorStatus === 429) {
					throw error
				}

				// 原生 fetch 失败时降级到 OpenAI SDK 流式
				if (!enableReasoning && !enableWebSearch) {
					try {
						yield* smoothStream(wrapWithThinkTagDetection(runStreamingChatCompletion(), enableReasoning))
						return
					} catch (sdkChatError) {
						const sdkChatStatus = resolveErrorStatus(sdkChatError)
						if (sdkChatStatus === 429) throw sdkChatError
						// 继续降级到 Responses API SDK 流式
					}
					try {
						yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithOpenAISdk(), enableReasoning))
						return
					} catch (responsesError) {
						const responsesStatus = resolveErrorStatus(responsesError)
						if (responsesStatus === 429) throw responsesError
						// 继续降级到桌面端回退链
					}
				} else {
					// 推理/联网搜索路径：原生 fetch 失败后降级到 SDK
					try {
						yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithOpenAISdk(), enableReasoning))
						return
					} catch (sdkResponsesError) {
						const sdkStatus = resolveErrorStatus(sdkResponsesError)
						if (sdkStatus === 429) throw sdkResponsesError
						// 继续降级到桌面端回退链
					}
				}

					if (Platform.isDesktopApp) {
						try {
							yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithDesktopFetchSse(), enableReasoning))
							return
						} catch (desktopStreamError) {
							const desktopStreamErrorStatus = resolveErrorStatus(desktopStreamError)
							if (desktopStreamErrorStatus === 429) {
								throw desktopStreamError
							}
							try {
								yield* smoothStream(wrapWithThinkTagDetection(runResponsesWithDesktopRequestUrl(), enableReasoning))
								return
							} catch (desktopError) {
								const desktopErrorStatus = resolveErrorStatus(desktopError)
								if (desktopErrorStatus === 429) {
									throw desktopError
								}
								const desktopCanFallbackToChat = shouldFallbackToChatCompletions(desktopError)
								if (desktopCanFallbackToChat) {
									yield* smoothStream(wrapWithThinkTagDetection(runChatCompletionFallback(), enableReasoning))
									return
								}
								throw desktopError
							}
						}
					}

				const canFallbackToChat = shouldFallbackToChatCompletions(error)
				if (canFallbackToChat) {
					yield* smoothStream(wrapWithThinkTagDetection(runChatCompletionFallback(), enableReasoning))
					return
				}

				throw error
			}
		} catch (error) {
			const status = resolveErrorStatus(error)
			if (status !== undefined && status >= 500) {
				const detail = error instanceof Error ? error.message : String(error)
				const enriched = new Error(
					`${detail}\nPoe 上游 provider 返回 5xx（临时故障或模型工具链不稳定）。建议切换到 Claude-Sonnet-4.5 或 GPT-5.2 后重试。`
				) as Error & { status?: number }
				enriched.status = status
				throw normalizeProviderError(enriched, 'Poe request failed')
			}
			throw normalizeProviderError(error, 'Poe request failed')
		}
	}

export const poeVendor: Vendor = {
	name: 'Poe',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.poe.com/v1',
		model: 'Claude-Sonnet-4.5',
		enableReasoning: false,
		enableWebSearch: false,
		parameters: {}
	} as PoeOptions,
	sendRequestFunc,
	models: ['Claude-Sonnet-4.5', 'GPT-5.2', 'Gemini-3-Pro', 'Grok-4'],
	websiteToObtainKey: 'https://poe.com/api_key',
	capabilities: ['Text Generation', 'Image Vision', 'Web Search', 'Reasoning']
}
