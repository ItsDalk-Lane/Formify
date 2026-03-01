/**
 * MCP 工具调用循环处理器
 *
 * 为 AI Provider 提供 MCP 工具调用支持
 * 将 MCP 工具转换为各 Provider 格式，处理工具调用循环
 */

import OpenAI from 'openai'
import { DebugLogger } from 'src/utils/DebugLogger'
import type {
	BaseOptions,
	McpCallToolFnForProvider,
	McpToolDefinitionForProvider,
	Message,
	ResolveEmbedAsBinary,
	SendRequest,
} from '../providers'
import {
	convertEmbedToImageUrl,
	REASONING_BLOCK_START_MARKER,
	REASONING_BLOCK_END_MARKER,
	formatReasoningDuration,
} from '../providers/utils'

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
	/** DeepSeek 推理模型的思维链内容（工具调用循环中需回传给 API） */
	reasoning_content?: string
	/** OpenRouter/OpenAI 兼容字段：部分模型使用 reasoning 返回推理文本 */
	reasoning?: string
	/** OpenRouter/OpenAI 兼容字段：结构化推理详情（可用于后续轮次上下文） */
	reasoning_details?: unknown
}

/**
 * 对工具参数做基础校验（仅覆盖对象根节点常见约束）
 * 目标：在明显参数错误时提前返回，避免远端 MCP 服务报 5xx。
 */
function validateToolArgs(
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): string[] {
	if (!schema || typeof schema !== 'object') return []

	const required = Array.isArray(schema.required)
		? schema.required.filter((key): key is string => typeof key === 'string')
		: []
	const properties =
		typeof schema.properties === 'object' && schema.properties !== null
			? (schema.properties as Record<string, unknown>)
			: {}

	const errors: string[] = []

	for (const key of required) {
		if (!(key in args) || args[key] === undefined || args[key] === null) {
			errors.push(`缺少必填参数: ${key}`)
		}
	}

	for (const [key, value] of Object.entries(args)) {
		const propSchema = properties[key]
		if (!propSchema || typeof propSchema !== 'object') continue

		const expectedType = (propSchema as { type?: unknown }).type
		if (typeof expectedType !== 'string') continue

		const actualType = Array.isArray(value) ? 'array' : typeof value
		const normalizedActualType =
			actualType === 'object' && value !== null ? 'object' : actualType

		const matches = (
			(expectedType === 'string' && normalizedActualType === 'string')
			|| (expectedType === 'number' && normalizedActualType === 'number')
			|| (expectedType === 'integer' && typeof value === 'number' && Number.isInteger(value))
			|| (expectedType === 'boolean' && normalizedActualType === 'boolean')
			|| (expectedType === 'array' && Array.isArray(value))
			|| (
				expectedType === 'object'
				&& normalizedActualType === 'object'
				&& value !== null
				&& !Array.isArray(value)
			)
		)

		if (!matches) {
			errors.push(`参数类型不匹配: ${key} 期望 ${expectedType}，实际 ${normalizedActualType}`)
		}
	}

	return errors
}

function getSchemaMeta(schema: Record<string, unknown> | undefined): {
	required: string[]
	properties: Record<string, unknown>
} {
	if (!schema || typeof schema !== 'object') {
		return { required: [], properties: {} }
	}

	const required = Array.isArray(schema.required)
		? schema.required.filter((key): key is string => typeof key === 'string')
		: []
	const properties =
		typeof schema.properties === 'object' && schema.properties !== null
			? (schema.properties as Record<string, unknown>)
			: {}

	return { required, properties }
}

function isRepoLikeKey(key: string): boolean {
	return /(repo|repository|project)/i.test(key)
}

function isUrlLikeKey(key: string): boolean {
	return /(url|uri|link|endpoint)/i.test(key)
}

function isGithubRepoSlug(value: string): boolean {
	return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/.test(value.trim())
}

function isGithubUrl(value: string): boolean {
	return /^https?:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?(?:\/.*)?$/i.test(
		value.trim(),
	)
}

function toGithubUrl(value: string): string {
	const trimmed = value.trim().replace(/^github\.com\//i, '')
	if (isGithubUrl(trimmed)) return trimmed
	if (isGithubRepoSlug(trimmed)) return `https://github.com/${trimmed}`
	return value.trim()
}

function toGithubSlug(value: string): string {
	const trimmed = value.trim()
	if (!isGithubUrl(trimmed)) return trimmed
	const matched = trimmed.match(/^https?:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:\.git)?(?:\/.*)?$/i)
	return matched ? matched[1] : trimmed
}

function normalizeToolArgs(
	schema: Record<string, unknown> | undefined,
	rawArgs: Record<string, unknown>,
): { args: Record<string, unknown>; notes: string[] } {
	const { required } = getSchemaMeta(schema)
	const notes: string[] = []
	const normalized: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(rawArgs)) {
		if (value === undefined) continue
		normalized[key] = typeof value === 'string' ? value.trim() : value
	}

	for (const [key, value] of Object.entries(normalized)) {
		if (typeof value !== 'string' || !value) continue

		if (isUrlLikeKey(key) || (isRepoLikeKey(key) && /url|uri/i.test(key))) {
			const next = toGithubUrl(value)
			if (next !== value) {
				normalized[key] = next
				notes.push(`${key}: repo 标识已转为 URL`)
			}
			continue
		}

		if (isRepoLikeKey(key) && !isUrlLikeKey(key) && isGithubUrl(value)) {
			const next = toGithubSlug(value)
			if (next !== value) {
				normalized[key] = next
				notes.push(`${key}: GitHub URL 已转为 owner/repo`)
			}
		}
	}

	const missingRequired = required.filter((key) => {
		const val = normalized[key]
		return val === undefined || val === null || (typeof val === 'string' && !val.trim())
	})

	if (missingRequired.length === 1) {
		const targetKey = missingRequired[0]
		const aliases = Object.entries(normalized).filter(([key, val]) => {
			if (typeof val !== 'string' || !val.trim()) return false
			if (key === targetKey) return false

			if (isUrlLikeKey(targetKey)) {
				return isRepoLikeKey(key) || isUrlLikeKey(key)
			}
			if (isRepoLikeKey(targetKey)) {
				return isRepoLikeKey(key) || isUrlLikeKey(key)
			}
			return false
		})

		if (aliases.length > 0) {
			const aliasVal = aliases[0][1] as string
			normalized[targetKey] = isUrlLikeKey(targetKey) ? toGithubUrl(aliasVal) : aliasVal
			notes.push(`已将 ${aliases[0][0]} 映射为必填字段 ${targetKey}`)
		} else {
			const stringValues = Object.values(normalized).filter(
				(v): v is string => typeof v === 'string' && !!v.trim(),
			)
			if (stringValues.length === 1) {
				normalized[targetKey] = isUrlLikeKey(targetKey)
					? toGithubUrl(stringValues[0])
					: stringValues[0]
				notes.push(`已将唯一字符串参数映射为必填字段 ${targetKey}`)
			}
		}
	}

	return { args: normalized, notes }
}

function maybeBuildAlternateArgsForServerError(
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): Record<string, unknown> | null {
	const { required } = getSchemaMeta(schema)
	if (required.length !== 1) return null

	const key = required[0]
	const current = args[key]
	if (typeof current !== 'string' || !current.trim()) return null

	if (isUrlLikeKey(key) && isGithubRepoSlug(current)) {
		return { ...args, [key]: toGithubUrl(current) }
	}

	if (isRepoLikeKey(key) && !isUrlLikeKey(key) && isGithubUrl(current)) {
		return { ...args, [key]: toGithubSlug(current) }
	}

	return null
}

function getNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed ? trimmed : null
}

function extractRepoHints(args: Record<string, unknown>): {
	owner?: string
	repoName?: string
	slug?: string
	url?: string
} {
	const owner =
		getNonEmptyString(args.owner)
		?? getNonEmptyString(args.repo_owner)
		?? getNonEmptyString(args.org)
		?? getNonEmptyString(args.organization)
		?? undefined
	const repoName =
		getNonEmptyString(args.repo)
		?? getNonEmptyString(args.repository)
		?? getNonEmptyString(args.repo_name)
		?? getNonEmptyString(args.name)
		?? undefined

	let slug: string | undefined
	let url: string | undefined

	for (const [key, val] of Object.entries(args)) {
		if (typeof val !== 'string') continue
		const text = val.trim()
		if (!text) continue
		if (isGithubUrl(text) && !url) {
			url = text
			if (!slug) slug = toGithubSlug(text)
		}
		if ((isRepoLikeKey(key) || isUrlLikeKey(key)) && isGithubRepoSlug(text) && !slug) {
			slug = text.replace(/\.git$/i, '')
		}
	}

	if (!slug && owner && repoName) {
		slug = `${owner}/${repoName}`.replace(/\.git$/i, '')
	}
	if (!url && slug) {
		url = toGithubUrl(slug)
	}

	return { owner, repoName, slug, url }
}

function buildToolArgCandidates(
	toolName: string,
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): Record<string, unknown>[] {
	const { required, properties } = getSchemaMeta(schema)
	const hints = extractRepoHints(args)
	const candidates: Record<string, unknown>[] = []
	const seen = new Set<string>()

	const addCandidate = (candidate: Record<string, unknown>): void => {
		const key = safeJsonPreview(candidate, 2000)
		if (seen.has(key)) return
		seen.add(key)
		candidates.push(candidate)
	}

	addCandidate(args)

	// 某些服务端对可选字段处理不稳定，优先追加“仅必填字段”候选
	if (required.length > 0) {
		const requiredOnly: Record<string, unknown> = {}
		for (const key of required) {
			if (key in args) {
				requiredOnly[key] = args[key]
			}
		}
		if (Object.keys(requiredOnly).length > 0) {
			addCandidate(requiredOnly)
		}
	}

	const legacyAlternate = maybeBuildAlternateArgsForServerError(schema, args)
	if (legacyAlternate) addCandidate(legacyAlternate)

	const isRepoTool =
		/(repo|repository|github|structure|read_file|search_doc)/i.test(toolName)
		|| Object.keys(properties).some((name) => isRepoLikeKey(name) || isUrlLikeKey(name))
	if (!isRepoTool) {
		return candidates
	}

	const schemaKeys = Object.keys(properties)
	const repoLikeKeys = schemaKeys.filter((name) => isRepoLikeKey(name) || isUrlLikeKey(name))
	const targetKeys =
		repoLikeKeys.length > 0
			? repoLikeKeys
			: required.length > 0
				? required
				: ['repo_url', 'repository_url', 'repo', 'repository']
	const genericRepoKeys = ['repo_url', 'repository_url', 'repo', 'repository', 'repo_name']
	const allCandidateKeys = Array.from(new Set([...targetKeys, ...genericRepoKeys]))

	for (const key of allCandidateKeys) {
		if (hints.url && (isUrlLikeKey(key) || /repo_url|repository_url/i.test(key))) {
			addCandidate({ ...args, [key]: hints.url })
			if (required.length > 0) {
				const requiredOnly: Record<string, unknown> = {}
				for (const reqKey of required) {
					if (reqKey in args) requiredOnly[reqKey] = args[reqKey]
				}
				addCandidate({ ...requiredOnly, [key]: hints.url })
			}
		}
		if (hints.slug && (isRepoLikeKey(key) || /repo|repository/i.test(key))) {
			addCandidate({ ...args, [key]: hints.slug })
			if (required.length > 0) {
				const requiredOnly: Record<string, unknown> = {}
				for (const reqKey of required) {
					if (reqKey in args) requiredOnly[reqKey] = args[reqKey]
				}
				addCandidate({ ...requiredOnly, [key]: hints.slug })
			}
		}
	}

	if (hints.owner && hints.repoName) {
		addCandidate({ ...args, owner: hints.owner, repo: hints.repoName })
		addCandidate({ owner: hints.owner, repo: hints.repoName })
		addCandidate({ ...args, owner: hints.owner, repository: hints.repoName })
	}

	// 保持尝试数量可控，避免长时间阻塞
	return candidates.slice(0, 8)
}

function isRecoverableServerToolError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
	return (
		/\bmcp 错误 \[-?5\d\d\]/i.test(msg) ||
		/\b5\d\d\b/.test(msg) ||
		/(unexpected system error|internal server error|try again later)/i.test(msg)
	)
}

function safeJsonPreview(value: unknown, maxLen = 400): string {
	try {
		const text = JSON.stringify(value)
		return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
	} catch {
		const text = String(value)
		return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
	}
}

function summarizeSchema(schema: Record<string, unknown> | undefined): string {
	const { required, properties } = getSchemaMeta(schema)
	const propSummary = Object.entries(properties)
		.slice(0, 8)
		.map(([name, def]) => {
			const type = (def as { type?: unknown })?.type
			return `${name}:${typeof type === 'string' ? type : 'any'}`
		})
		.join(', ')
	return `required=[${required.join(', ')}], props=[${propSummary}]`
}

/**
 * 将 MCP 工具转换为 OpenAI 兼容格式
 *
 * 适用于: OpenAI, DeepSeek, Qwen, Ollama, OpenRouter,
 * SiliconFlow, Zhipu, Grok, Kimi, Azure, Doubao, Poe
 */
export function toOpenAITools(mcpTools: McpToolDefinitionForProvider[]): OpenAIToolDefinition[] {
	return mcpTools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}))
}

/**
 * 将 MCP 工具转换为 Anthropic Claude 格式
 */
export function toClaudeTools(mcpTools: McpToolDefinitionForProvider[]): Array<{
	name: string
	description: string
	input_schema: Record<string, unknown>
}> {
	return mcpTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}))
}

/**
 * 查找 MCP 工具对应的 serverId
 */
export function findToolServerId(
	toolName: string,
	mcpTools: McpToolDefinitionForProvider[],
): string | undefined {
	return mcpTools.find((t) => t.name === toolName)?.serverId
}

/**
 * 执行 MCP 工具调用并返回结果
 *
 * @param toolCalls - AI 模型返回的工具调用列表
 * @param mcpTools - 可用的 MCP 工具列表
 * @param mcpCallTool - 工具调用回调
 * @returns 工具结果消息列表（OpenAI tool message 格式）
 */
export async function executeMcpToolCalls(
	toolCalls: OpenAIToolCall[],
	mcpTools: McpToolDefinitionForProvider[],
	mcpCallTool: McpCallToolFnForProvider,
): Promise<ToolLoopMessage[]> {
	const results: ToolLoopMessage[] = []

	for (const call of toolCalls) {
		const toolName = call.function.name
		const toolDef = mcpTools.find((t) => t.name === toolName)
		const serverId = toolDef?.serverId

		if (!serverId) {
			DebugLogger.warn(`[MCP] 未找到工具 "${toolName}" 对应的 MCP 服务器`)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `错误: 未找到工具 "${toolName}"`,
			})
			continue
		}

		let args: Record<string, unknown>
		try {
			const parsed = JSON.parse(call.function.arguments || '{}') as unknown
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('参数必须是 JSON 对象')
			}
			args = parsed as Record<string, unknown>
		} catch (err) {
			const parseError = err instanceof Error ? err.message : String(err)
			DebugLogger.warn(`[MCP] 工具参数解析失败: ${toolName}`, err)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `工具调用失败: 参数 JSON 解析失败（${parseError}）; 原始参数=${(call.function.arguments || '').slice(0, 300)}`,
			})
			continue
		}

		const normalized = normalizeToolArgs(toolDef?.inputSchema, args)
		args = normalized.args
		if (normalized.notes.length > 0) {
			DebugLogger.warn(`[MCP] 工具参数已自动修正: ${toolName}`, normalized.notes)
		}

		const argValidationErrors = validateToolArgs(toolDef?.inputSchema, args)
		if (argValidationErrors.length > 0) {
			const validationText = argValidationErrors.join('; ')
			DebugLogger.warn(`[MCP] 工具参数校验失败: ${toolName}: ${validationText}`)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `工具调用失败: 参数校验失败（${validationText}）。当前参数=${safeJsonPreview(args)}。参数约束=${summarizeSchema(toolDef?.inputSchema)}`,
			})
			continue
		}

		const argCandidates = buildToolArgCandidates(toolName, toolDef?.inputSchema, args)
		let callSucceeded = false
		let lastError: unknown = null
		let lastTriedArgs: Record<string, unknown> = args

		for (let i = 0; i < argCandidates.length; i++) {
			const candidateArgs = argCandidates[i]
			lastTriedArgs = candidateArgs

			try {
				if (i > 0) {
					DebugLogger.warn(
						`[MCP] 正在尝试参数候选 (${i + 1}/${argCandidates.length}): ${toolName}`,
						candidateArgs,
					)
				} else {
					DebugLogger.debug(`[MCP] 执行工具调用: ${toolName}`, candidateArgs)
				}

				const result = await mcpCallTool(serverId, toolName, candidateArgs)
				results.push({
					role: 'tool',
					tool_call_id: call.id,
					name: toolName,
					content: result,
				})
				callSucceeded = true
				break
			} catch (err) {
				lastError = err
				DebugLogger.error(`[MCP] 工具调用失败: ${toolName}`, err)

				const canTryNextCandidate =
					i < argCandidates.length - 1 && isRecoverableServerToolError(err)
				if (!canTryNextCandidate) {
					break
				}
			}
		}

		if (!callSucceeded) {
			const errorMsg = lastError instanceof Error ? lastError.message : String(lastError)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `工具调用失败: ${errorMsg}。最后参数=${safeJsonPreview(lastTriedArgs)}。参数约束=${summarizeSchema(toolDef?.inputSchema)}`,
			})
		}
	}

	return results
}

/**
 * 从流式响应中累积工具调用
 *
 * OpenAI 流式 API 中 tool_calls 以增量方式返回:
 * - delta.tool_calls[i].id: 首次出现时设置
 * - delta.tool_calls[i].function.name: 首次出现时设置
 * - delta.tool_calls[i].function.arguments: 分多个 chunk 拼接
 */
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

/**
 * 兼容旧式 function_call 增量字段（部分 OpenAI 兼容 Provider 仍返回该格式）
 */
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

/**
 * 将累积的工具调用映射转换为 OpenAIToolCall 数组
 */
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

/**
 * 判断是否应该在 MCP 工具链路失败时回退为普通请求
 *
 * 兼容两类场景：
 * 1. Provider 侧 5xx（常见为 500）
 * 2. Provider 不支持 tools/function_call 参数（常见为 4xx 或语义错误）
 */
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

/**
 * 需要从 API 请求参数中过滤的内部配置键
 *
 * 这些键是插件内部/MCP 使用的，不应传递给 AI Provider API
 *
 * 注意：enableReasoning 是插件内部标志（控制推理内容 UI 展示），不是 API 参数，需要过滤
 * reasoningEffort 同样需要过滤，由 Provider 通过 transformApiParams 转换为对应格式
 * enableThinking 需要传递给某些 Provider（如 Qwen），因此不被过滤
 * enableWebSearch 保留用于某些 Provider 的联网搜索功能
 */
const INTERNAL_OPTION_KEYS = new Set([
	'apiKey', 'baseURL', 'model', 'parameters',
	'apiSecret', 'vendorApiKeys', 'vendorApiKeysByDevice',
	'mcpTools', 'mcpCallTool', 'mcpMaxToolCallLoops',
	'enableReasoning',   // 插件内部标志，非 API 参数（DeepSeek 通过 model 名称启用推理）
	'reasoningEffort',   // 推理努力级别，Provider 通过 transformApiParams 转换为对应格式
	// 'enableThinking',   // 移除：某些 Provider 需要此参数启用思考功能
	// 'enableWebSearch',  // 移除：某些 Provider 需要此参数启用联网搜索
	'tag', 'vendor',
])

/**
 * 从合并后的选项中提取可安全传递给 OpenAI 兼容 API 的参数
 *
 * 过滤掉内部配置键，仅保留 temperature, max_tokens 等 API 参数
 */
function extractApiParams(allOptions: Record<string, unknown>): Record<string, unknown> {
	const apiParams: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(allOptions)) {
		if (INTERNAL_OPTION_KEYS.has(key)) continue
		if (value === undefined || value === null) continue
		// 跳过函数类型（回调等内部逻辑）
		if (typeof value === 'function') continue
		// 跳过以双下划线开头的内部参数（如 __ff_deepseek）
		if (key.startsWith('__')) continue
		apiParams[key] = value
	}
	return apiParams
}

function sanitizeApiParamsForToolLoop(apiParams: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = { ...apiParams }

	// MCP 工具调用由包装器统一注入，避免被用户自定义 parameters 覆盖或污染
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

	// 最终兜底请求不携带工具，避免 tool_choice 等参数导致 4xx/兼容性错误
	delete sanitized.tool_choice
	delete sanitized.parallel_tool_calls

	return sanitized
}

/**
 * 将 ProviderMessage 数组转换为 ToolLoopMessage 数组
 * 处理嵌入的图片（embeds），将其转换为 OpenAI 兼容的多模态内容格式
 * 保留推理内容（reasoning_content）字段
 *
 * @param messages - Provider 消息数组（可能包含 embeds 和 reasoning_content）
 * @param resolveEmbedAsBinary - 嵌入对象的二进制解析回调
 * @returns 适用于 OpenAI SDK 的消息数组
 */
async function buildLoopMessages(
	messages: readonly Message[],
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
): Promise<ToolLoopMessage[]> {
	const result: ToolLoopMessage[] = []

	for (const msg of messages) {
		// 构建 ToolLoopMessage，保留 reasoning_content 字段
		const loopMsg: ToolLoopMessage = {
			role: msg.role,
			content: msg.content,
		}

		// 保留推理内容字段（如果存在）
		if (typeof msg === 'object' && msg !== null && 'reasoning_content' in msg) {
			;(loopMsg as { reasoning_content?: string }).reasoning_content = (msg as { reasoning_content?: string }).reasoning_content
		}

		// 无 embeds → 直接使用纯文本消息
		if (!msg.embeds || msg.embeds.length === 0) {
			result.push(loopMsg)
			continue
		}

		// 有 embeds → 构建多模态内容数组（text + image_url）
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
				DebugLogger.warn(`[MCP] 处理嵌入图片失败: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		loopMsg.content = contentParts.length > 0 ? contentParts : msg.content ?? ''
		result.push(loopMsg)
	}

	return result
}

/**
 * withOpenAIMcpToolCallSupport 的可选配置
 * - transformBaseURL: 对 baseURL 做自定义转换（用于 Ollama、Gemini 等需要转换路径的 Provider）
 * - createClient: 自定义 OpenAI 客户端工厂（用于 Azure 等需要非标准初始化的 Provider）
 */
export interface OpenAIMcpSupportOptions {
	transformBaseURL?: (url: string) => string
	createClient?: (allOptions: Record<string, unknown>) => OpenAI
	/**
	 * 对部分 Provider（如 Kimi）使用非流式 tools 循环更稳定：
	 * chat.completions.create(stream=false) -> message.tool_calls
	 */
	preferNonStreamingToolLoop?: boolean
	/**
	 * 在发送 API 请求前转换参数
	 * 用于 Provider 特定的参数格式转换
	 * 例如 OpenRouter 需要将 enableReasoning+reasoningEffort 转换为 reasoning: { effort: ... }
	 */
	transformApiParams?: (apiParams: Record<string, unknown>, allOptions: Record<string, unknown>) => Record<string, unknown>
}

/**
 * 推理内容累积器状态
 */
interface ReasoningAccumulator {
	startMs: number
	content: string
	isActive: boolean
}

interface ExtractedReasoningDelta {
	displayText: string
	reasoningContent?: string
	reasoning?: string
	reasoningDetails?: unknown
}

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

/**
 * 流式输出包装器：支持推理内容检测和转换
 *
 * 检测 OpenAI 兼容 API 返回的推理内容（reasoning_content 字段或内联标签），
 * 将其转换为 {{FF_REASONING_START}}:timestamp:content:{{FF_REASONING_END}}:durationMs: 格式
 */
async function* wrapWithReasoningDetection(
	source: AsyncGenerator<string, void, undefined>,
	enableReasoning: boolean,
): AsyncGenerator<string, void, unknown> {
	if (!enableReasoning) {
		yield* source
		return
	}

	const reasoningAccumulator: ReasoningAccumulator = {
		startMs: 0,
		content: '',
		isActive: false,
	}

	for await (const chunk of source) {
		// 检查是否是推理块的开始或结束标记
		if (chunk.includes(REASONING_BLOCK_START_MARKER)) {
			// 开始新的推理块
			const match = chunk.match(new RegExp(`${REASONING_BLOCK_START_MARKER.replace(/[{}]/g, '\\$&')}:(\\d+):`))
			if (match) {
				reasoningAccumulator.startMs = parseInt(match[1], 10)
				reasoningAccumulator.content = ''
				reasoningAccumulator.isActive = true
				// 输出推理块开始标记
				yield chunk
			}
			continue
		}

		if (chunk.includes(REASONING_BLOCK_END_MARKER)) {
			// 结束推理块
			const match = chunk.match(new RegExp(`:${REASONING_BLOCK_END_MARKER.replace(/[{}]/g, '\\$&')}:(\\d+):`))
			if (match && reasoningAccumulator.isActive) {
				reasoningAccumulator.isActive = false
				// 输出推理块结束标记
				yield chunk
			}
			continue
		}

		// 检查是否包含 MCP 工具标记
		if (chunk.includes('{{FF_MCP_TOOL_START}}') || chunk.includes('{{FF_MCP_TOOL_END}}')) {
			yield chunk
			continue
		}

		yield chunk
	}
}

export function withOpenAIMcpToolCallSupport(
	originalFactory: (settings: BaseOptions) => SendRequest,
	mcpOptions?: OpenAIMcpSupportOptions,
): (settings: BaseOptions) => SendRequest {
	return (settings: BaseOptions): SendRequest => {
		const { mcpTools, mcpCallTool } = settings
		if (!mcpTools?.length || !mcpCallTool) {
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
					typeof settings.mcpMaxToolCallLoops === 'number' && settings.mcpMaxToolCallLoops > 0
						? settings.mcpMaxToolCallLoops
						: DEFAULT_MAX_TOOL_CALL_LOOPS

				// 提取可传递给 API 的参数（temperature, max_tokens 等）
				let apiParams = extractApiParams(allOptions)

				// 允许 Provider 自定义 API 参数转换（如 OpenRouter 的 reasoning 参数格式）
				if (mcpOptions?.transformApiParams) {
					apiParams = mcpOptions.transformApiParams(apiParams, allOptions)
				}
				const apiParamsForToolLoop = sanitizeApiParamsForToolLoop(apiParams)
				const apiParamsForFinalRequest = sanitizeApiParamsForFinalRequest(apiParams)

				// 创建 OpenAI 兼容客户端
				// - 优先使用自定义工厂（Azure 等）
				// - 其次使用 transformBaseURL 转换路径（Ollama、Gemini 等）
				// - 默认：移除 /chat/completions 后缀后创建标准 OpenAI 客户端
				let client: OpenAI
				if (mcpOptions?.createClient) {
					client = mcpOptions.createClient(allOptions as Record<string, unknown>)
				} else {
					let normalizedBaseURL: string
					if (mcpOptions?.transformBaseURL) {
						normalizedBaseURL = mcpOptions.transformBaseURL(baseURL as string)
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

				const tools = toOpenAITools(mcpTools)
				const rawThinkingType = (settings as { thinkingType?: unknown }).thinkingType
				const hasThinkingTypeEnabled =
					typeof rawThinkingType === 'string' && rawThinkingType.toLowerCase() !== 'disabled'
				const enableReasoning =
					(settings as { enableReasoning?: boolean }).enableReasoning === true ||
					(settings as { enableThinking?: boolean }).enableThinking === true ||
					hasThinkingTypeEnabled
				const preferNonStreamingToolLoop = mcpOptions?.preferNonStreamingToolLoop === true

				DebugLogger.debug(
					`[MCP] 工具调用循环启动: ${mcpTools.length} 个工具可用, model=${model}, ` +
					`maxLoops=${maxToolCallLoops}, enableReasoning=${enableReasoning}, ` +
					`preferNonStreamingToolLoop=${preferNonStreamingToolLoop}, ` +
					`apiParams=${JSON.stringify(Object.keys(apiParams))}`,
				)

				// 将原始消息转换为工具循环格式，保留多模态图片内容和推理内容
				const loopMessages: ToolLoopMessage[] = await buildLoopMessages(
					messages,
					resolveEmbedAsBinary,
				)

					for (let loop = 0; loop < maxToolCallLoops; loop++) {
						if (controller.signal.aborted) return

						DebugLogger.debug(`[MCP] 工具调用循环 #${loop + 1}`)

						if (preferNonStreamingToolLoop) {
							const completion = await client.chat.completions.create(
								{
									model: model as string,
									messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
									tools,
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
							const toolCalls = toOpenAIToolCallsFromMessage(message.tool_calls)

							if (toolCalls.length === 0) {
								if (contentBuffer) {
									yield contentBuffer
								}
								return
							}

							const assistantMsg: ToolLoopMessage = {
								role: 'assistant',
								content: contentBuffer || null,
								tool_calls: toolCalls,
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
							for (const call of toolCalls) {
								const singleResults = await executeMcpToolCalls([call], mcpTools, mcpCallTool)
								toolResults.push(...singleResults)

								const resultContent = typeof singleResults[0]?.content === 'string'
									? singleResults[0].content
									: ''
								yield `{{FF_MCP_TOOL_START}}:${call.function.name}:${resultContent}{{FF_MCP_TOOL_END}}:`
							}

							loopMessages.push(...toolResults)

							DebugLogger.debug(
								`[MCP] 已执行 ${toolCalls.length} 个工具调用（非流式），继续循环`,
							)
							continue
						}

						// 流式请求（含工具定义和 Provider 参数）
						const stream = await client.chat.completions.create(
							{
								model: model as string,
								messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
								tools,
								stream: true,
								...apiParamsForToolLoop,
							},
							{ signal: controller.signal },
						)

					let contentBuffer = ''
					let reasoningBuffer = ''
					let reasoningForMessage = '' // 回传给 reasoning_content（保持 DeepSeek 兼容）
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

						// 处理推理内容（兼容 reasoning_content / reasoning / reasoning_details）
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

						// 累积文本内容
						const textContent = delta.content as string | undefined
						if (textContent) {
							// 如果之前有推理内容，现在推理结束
							// 注意：某些模型（如 DeepSeek）在推理后直接返回 tool_calls 而不是 content
							// 所以只有当确实有 content 时才结束推理块
							if (reasoningActive && reasoningBuffer.length > 0) {
								const reasoningDurationMs = Date.now() - reasoningStartMs
								yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
								reasoningActive = false
								reasoningForMessage += reasoningBuffer
								reasoningBuffer = ''
							}

							contentBuffer += textContent
							// 如果还没检测到 tool_calls，先流式输出文本
							// 注意：OpenAI 不会同时返回 content 和 tool_calls
							if (!hasToolCalls) {
								yield textContent
							}
						}

						// 累积工具调用
						const deltaToolCalls = delta.tool_calls as
							| Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
							| undefined
						if (deltaToolCalls) {
							// 如果之前有推理内容，现在推理结束
							// 推理模型会在思考后直接调用工具（不返回 content）
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
							// 兼容旧式 function_call：推理后可直接进入工具调用
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

					// 如果推理块还未结束，现在结束它
					if (reasoningActive && reasoningBuffer.length > 0) {
						const reasoningDurationMs = Date.now() - reasoningStartMs
						yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
						reasoningActive = false
						reasoningForMessage += reasoningBuffer
					}

					if (!hasToolCalls) {
						// 无工具调用，文本已流式输出，结束
						return
					}

					// 有工具调用 → 逐个执行，每完成一个立即 yield 对应的 MCP 工具标记
					const toolCalls = finalizeToolCalls(toolCallsMap)

					// DeepSeek 思考模式要求在工具调用循环中回传 reasoning_content
					// 否则 API 会返回 400 错误，导致无法继续多轮工具调用
					const assistantMsg: ToolLoopMessage = {
						role: 'assistant',
						content: contentBuffer || null,
						tool_calls: toolCalls,
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
					for (const call of toolCalls) {
						const singleResults = await executeMcpToolCalls([call], mcpTools, mcpCallTool)
						toolResults.push(...singleResults)

						// 将工具调用结果注入流式输出，使聊天界面实时展示
						const resultContent = typeof singleResults[0]?.content === 'string'
							? singleResults[0].content
							: ''
						yield `{{FF_MCP_TOOL_START}}:${call.function.name}:${resultContent}{{FF_MCP_TOOL_END}}:`
					}

					loopMessages.push(...toolResults)

					DebugLogger.debug(
						`[MCP] 已执行 ${toolCalls.length} 个工具调用，继续循环`,
					)
				}

					// 达到最大循环次数，做最后一次流式请求（不带工具）
					DebugLogger.warn(`[MCP] 达到最大工具调用循环次数 (${maxToolCallLoops})`)

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

						// 处理推理内容（兼容 reasoning_content / reasoning / reasoning_details）
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

						// 处理普通文本内容
						const text = delta.content as string | undefined
						if (text) {
							// 如果之前有推理内容，现在推理结束
							if (finalReasoningActive && finalReasoningBuffer.length > 0) {
								const reasoningDurationMs = Date.now() - finalReasoningStartMs
								yield `:${REASONING_BLOCK_END_MARKER}:${reasoningDurationMs}:`
								finalReasoningActive = false
								finalReasoningBuffer = ''
							}
							yield text
						}
					}

				// 如果推理块还未结束，现在结束它
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
					`[MCP] 工具调用链路失败，回退普通请求（不带 MCP 工具）: ${errorText}`,
					err,
				)

				// 向用户发出回退通知，避免静默丢弃工具导致幻觉
				try {
					const { Notice } = await import('obsidian')
					new Notice(
						`⚠️ MCP 工具调用失败，已回退为普通请求。\n原因: ${errorText.slice(0, 120)}`,
						8000,
					)
				} catch {
					// Notice 不可用时忽略（不影响核心功能）
				}

				const fallbackSettings: BaseOptions = {
					...settings,
					mcpTools: undefined,
					mcpCallTool: undefined,
				}
				const fallbackSendRequest = originalFactory(fallbackSettings)
				for await (const chunk of fallbackSendRequest(messages, controller, resolveEmbedAsBinary, saveAttachment)) {
					yield chunk
				}
			}
		}
	}
}
