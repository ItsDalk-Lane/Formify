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
					// 保留末尾可能的部分匹配
					const safeLen = Math.max(0, buffer.length - THINK_OPEN_TAG.length)
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
					const safeLen = Math.max(0, buffer.length - THINK_CLOSE_TAG.length)
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
				// 同时维护累积式输入，用于 previous_response_id 链过深遇到 5xx 时回退
				const accumulatedInput: unknown[] = [...(responseInput as unknown[])]

				const buildResponsesRequestData = (
					input: unknown,
					previousId: string | undefined,
					mode: 'default' | 'compat'
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
					if (enableReasoning && data.reasoning === undefined && !isToolContinuation) {
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
					return data
				}

				for (let loop = 0; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					let stream: Awaited<ReturnType<typeof client.responses.create>>
					try {
						stream = await client.responses.create(
							buildResponsesRequestData(currentInput, previousResponseId, 'default') as any,
							{
								signal: controller.signal
							}
						)
					} catch (error) {
						// 链式续轮遇到 5xx 时，降级为累积式输入重试（避免 previous_response_id 链过深）
						const errorStatus = resolveErrorStatus(error)
						if (errorStatus !== undefined && errorStatus >= 500 && loop > 0) {
							stream = await client.responses.create(
								buildAccumulatedRequestData() as any,
								{ signal: controller.signal }
							)
						} else if (shouldRetryFunctionOutputTurn400(error, currentInput)) {
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
							throw error
						}
					}

					let completedResponse: any = null
					let reasoningActive = false
					let reasoningStartMs: number | null = null

					for await (const event of stream as any) {
						if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') {
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

			const runResponsesWithDesktopRequestUrl = async function* () {
				let currentInput: unknown = responseInput
				let previousResponseId: string | undefined
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
					mode: 'default' | 'compat'
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
					if (enableReasoning && data.reasoning === undefined && !isToolContinuation) {
						data.reasoning = { effort: 'medium' }
					}
					return data
				}

				// 构建累积式回退请求数据（不使用 previous_response_id）
				const buildAccumulatedRequestData = (): Record<string, unknown> => {
					const data: Record<string, unknown> = {
						model,
						...responseBaseParams,
						input: accumulatedInput
					}
					if (toolCandidates.length > 0) {
						data.tools = toolCandidates
					}
					return data
				}

				for (let loop = 0; loop <= maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					let response: any
					try {
						response = await requestResponsesWithRetry(
							buildResponsesRequestData(currentInput, previousResponseId, 'default')
						)
					} catch (error) {
						// 链式续轮遇到 5xx 时，降级为累积式输入重试（避免 previous_response_id 链过深）
						const errorStatus = resolveErrorStatus(error)
						if (errorStatus !== undefined && errorStatus >= 500 && loop > 0) {
							response = await requestResponsesWithRetry(buildAccumulatedRequestData())
						} else if (shouldRetryFunctionOutputTurn400(error, currentInput)) {
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
							throw error
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

			// 纯 Chat Completions MCP 工具循环（不支持推理和联网搜索，作为混合策略的后备方案）
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

				for (let loop = 0; loop < maxToolCallLoops; loop++) {
					if (controller.signal.aborted) return

					let chatResponse: any
					if (Platform.isDesktopApp) {
						chatResponse = await withRetry(
							() =>
								requestChatCompletionByRequestUrl(
									ensureCompletionEndpoint(String(baseURL ?? '')),
									String(apiKey),
									{
										model,
										messages: loopMessages,
										...chatFallbackParams,
										tools: chatTools
									}
								),
							{
								...POE_RETRY_OPTIONS,
								signal: controller.signal
							}
						)
					} else {
						chatResponse = await client.chat.completions.create(
							{
								model,
								messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
								...chatFallbackParams,
								tools: chatTools as OpenAI.ChatCompletionTool[]
							},
							{ signal: controller.signal }
						)
					}

					const choice = chatResponse?.choices?.[0]
					const assistantMessage = choice?.message
					if (!assistantMessage) return

					const toolCalls = assistantMessage.tool_calls
					if (!toolCalls || toolCalls.length === 0) {
						// 没有工具调用，输出文本并结束
						const text = extractMessageText(assistantMessage.content)
						if (text) yield text
						return
					}

					// 将 assistant 消息（含 tool_calls）加入历史
					loopMessages.push(assistantMessage)

					// 执行工具调用
					const openAIToolCalls: OpenAIToolCall[] = toolCalls.map((tc: any) => ({
						id: String(tc.id ?? ''),
						type: 'function' as const,
						function: {
							name: String(tc.function?.name ?? ''),
							arguments: String(tc.function?.arguments ?? '{}')
						}
					}))

					const results = await executeMcpToolCalls(openAIToolCalls, mcpTools!, mcpCallTool!)

					// 将工具结果加入历史，并 yield MCP 标记
					for (const result of results) {
						loopMessages.push(result)
						const resultContent = typeof result.content === 'string' ? result.content : ''
						yield `{{FF_MCP_TOOL_START}}:${result.name || ''}:${resultContent}{{FF_MCP_TOOL_END}}:`
					}
				}

				// 达到最大循环次数，最后一次请求不带工具
				let finalResponse: any
				if (Platform.isDesktopApp) {
					finalResponse = await withRetry(
						() =>
							requestChatCompletionByRequestUrl(
								ensureCompletionEndpoint(String(baseURL ?? '')),
								String(apiKey),
								{
									model,
									messages: loopMessages,
									...chatFallbackParams
								}
							),
						{
							...POE_RETRY_OPTIONS,
							signal: controller.signal
						}
					)
				} else {
					finalResponse = await client.chat.completions.create(
						{
							model,
							messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
							...chatFallbackParams
						},
						{ signal: controller.signal }
					)
				}
				const finalText = extractMessageText(finalResponse?.choices?.[0]?.message?.content)
				if (finalText) yield finalText
			}

			// 混合 MCP 工具循环：第一轮 Responses API（推理 + 联网搜索），后续轮次 Chat Completions
			const runMcpHybridToolLoop = async function* () {
				// ── Phase 1: 第一轮使用 Responses API（支持推理、联网搜索、函数工具） ──
				const firstRoundData: Record<string, unknown> = {
					model,
					stream: true,
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
					const stream = await client.responses.create(
						firstRoundData as any,
						{ signal: controller.signal }
					)

					let reasoningActive = false
					let reasoningStartMs: number | null = null

					for await (const event of stream as any) {
						if (
							event.type === 'response.reasoning_text.delta' ||
							event.type === 'response.reasoning_summary_text.delta'
						) {
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
							firstRoundText += text
							yield text
							continue
						}

						if (event.type === 'response.completed') {
							firstCompletedResponse = event.response
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

				// ── Phase 2: 执行工具 → 切换到 Chat Completions 循环 ──
				const executed = await executePoeMcpToolCalls(firstFunctionCalls, mcpTools!, mcpCallTool!)
				for (const marker of executed.markers) {
					yield `{{FF_MCP_TOOL_START}}:${marker.toolName}:${marker.content}{{FF_MCP_TOOL_END}}:`
				}

				// 构建 Chat Completions 消息历史（包含第一轮的 assistant 响应 + 工具结果）
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

				// 后续工具轮次使用 Chat Completions（避免 previous_response_id 链导致 5xx）
				for await (const chunk of runPureChatCompletionsMcpLoop(continuationMessages)) {
					yield chunk
				}
			}

			const runChatCompletionFallback = async function* () {
				const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
				if (Platform.isDesktopApp) {
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
					const text = extractMessageText(message.content)
					if (text) yield text
					return
				}

				const stream = await client.chat.completions.create(
					{
						model,
						messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
						stream: true,
						...chatFallbackParams
					},
					{ signal: controller.signal }
				)

				for await (const part of stream) {
					const delta: any = part.choices[0]?.delta
					const text = delta?.content
					if (text) {
						yield text
					}
				}
			}

			try {
				// MCP 工具调用使用混合策略：第一轮 Responses API（支持推理 + 联网搜索），
				// 后续工具轮次使用 Chat Completions API（避免 previous_response_id 链导致 5xx）
				if (hasMcpToolRuntime) {
					for await (const chunk of wrapWithThinkTagDetection(runMcpHybridToolLoop(), enableReasoning)) {
						yield chunk
					}
					return
				}

				// 非 MCP 路径：使用 Responses API（流式输出）
				for await (const chunk of wrapWithThinkTagDetection(runResponsesWithOpenAISdk(), enableReasoning)) {
					yield chunk
				}
				return
			} catch (error) {
				// MCP 路径直接抛出，不做 Responses→Chat 降级
				if (hasMcpToolRuntime) {
					throw error
				}

				const canFallbackToChat = shouldFallbackToChatCompletions(error)
				if (canFallbackToChat) {
					for await (const chunk of runChatCompletionFallback()) {
						yield chunk
					}
					return
				}

				// 429 等速率限制错误不应再触发额外请求
				const errorStatus = resolveErrorStatus(error)
				if (errorStatus === 429) {
					throw error
				}

				if (Platform.isDesktopApp) {
					try {
						for await (const chunk of runResponsesWithDesktopRequestUrl()) {
							yield chunk
						}
						return
					} catch (desktopError) {
						const desktopCanFallbackToChat = shouldFallbackToChatCompletions(desktopError)
						if (desktopCanFallbackToChat) {
							for await (const chunk of runChatCompletionFallback()) {
								yield chunk
							}
							return
						}
						throw desktopError
					}
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
