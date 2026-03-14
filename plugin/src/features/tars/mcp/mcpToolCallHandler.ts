/**
 * MCP 工具调用处理器
 *
 * 提供 MCP 工具的格式转换、参数校验、执行等能力
 * 循环控制逻辑已迁移至 agent-loop 模块
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import { getBuiltinToolHint, type ToolHintCoercion } from './toolHints'
import type {
	BaseOptions,
	McpCallToolFnForProvider,
	McpToolDefinitionForProvider,
} from '../providers'

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

interface ToolFailureTrackerEntry {
	count: number
	lastContent: string
}

type ToolFailureTracker = Map<string, ToolFailureTrackerEntry>

function hasUsableValue(value: unknown): boolean {
	if (value === undefined || value === null) return false
	if (typeof value === 'string') return value.trim().length > 0
	if (Array.isArray(value)) return value.length > 0
	return true
}

function toSnakeCaseKey(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.toLowerCase()
}

function trimArgsDeep(value: unknown): unknown {
	if (typeof value === 'string') return value.trim()
	if (Array.isArray(value)) return value.map((item) => trimArgsDeep(item))
	if (!value || typeof value !== 'object') return value
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
			key,
			trimArgsDeep(nestedValue),
		]),
	)
}

function coerceValue(value: unknown, coercion: ToolHintCoercion): unknown {
	if (coercion === 'string_array') {
		if (Array.isArray(value)) {
			return value
				.map((item) => (typeof item === 'string' ? item.trim() : item))
				.filter((item) => typeof item === 'string' && item.length > 0)
		}
		if (typeof value === 'string') {
			return value
				.split(',')
				.map((part) => part.trim())
				.filter(Boolean)
		}
		return value
	}

	if (coercion === 'boolean' && typeof value === 'string') {
		if (/^(true|false)$/i.test(value.trim())) {
			return value.trim().toLowerCase() === 'true'
		}
		return value
	}

	if ((coercion === 'number' || coercion === 'integer') && typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) return value
		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed)) return value
		if (coercion === 'integer' && !Number.isInteger(parsed)) return value
		return parsed
	}

	return value
}

function getSchemaType(propertySchema: unknown): string | null {
	if (!propertySchema || typeof propertySchema !== 'object') return null
	const type = (propertySchema as { type?: unknown }).type
	return typeof type === 'string' ? type : null
}

function getSchemaEnum(propertySchema: unknown): string[] | null {
	if (!propertySchema || typeof propertySchema !== 'object') return null
	const enumValues = (propertySchema as { enum?: unknown }).enum
	if (!Array.isArray(enumValues)) return null
	return enumValues.filter((value): value is string => typeof value === 'string')
}

function validateToolArgs(
	toolName: string,
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): string[] {
	if (!schema || typeof schema !== 'object') return []

	const toolHint = getBuiltinToolHint(toolName)
	const required = Array.isArray(schema.required)
		? schema.required.filter((key): key is string => typeof key === 'string')
		: []
	const properties =
		typeof schema.properties === 'object' && schema.properties !== null
			? (schema.properties as Record<string, unknown>)
			: {}

	const errors: string[] = []
	const propertyNames = new Set(Object.keys(properties))
	const shouldRejectUnknownFields = propertyNames.size > 0 || Boolean(toolHint)

	for (const key of required) {
		if (!hasUsableValue(args[key])) {
			errors.push(`缺少必填参数: ${key}`)
		}
	}

	for (const key of Object.keys(args)) {
		if (shouldRejectUnknownFields && !propertyNames.has(key)) {
			errors.push(`未知参数: ${key}`)
		}
	}

	for (const [key, value] of Object.entries(args)) {
		const propSchema = properties[key]
		if (!propSchema || typeof propSchema !== 'object') continue

		const expectedType = getSchemaType(propSchema)
		if (!expectedType) continue

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
			continue
		}

		const enumValues = getSchemaEnum(propSchema)
		if (enumValues && typeof value === 'string' && !enumValues.includes(value)) {
			errors.push(`参数取值无效: ${key} 仅接受 ${enumValues.join(', ')}`)
		}

		if (expectedType === 'array' && Array.isArray(value)) {
			const itemType = getSchemaType((propSchema as { items?: unknown }).items)
			if (itemType) {
				const hasInvalid = value.some((item) => {
					const itemActualType = Array.isArray(item) ? 'array' : typeof item
					if (itemType === 'integer') {
						return typeof item !== 'number' || !Number.isInteger(item)
					}
					return itemActualType !== itemType
				})
				if (hasInvalid) {
					errors.push(`数组参数类型不匹配: ${key} 的元素必须是 ${itemType}`)
				}
			}
		}
	}

	for (const group of toolHint?.mutuallyExclusive ?? []) {
		const activeFields = group.filter((field) => hasUsableValue(args[field]))
		if (activeFields.length > 1) {
			errors.push(`参数互斥: ${activeFields.join(', ')} 不能同时提供`)
		}
	}

	for (const rule of toolHint?.conditionalRules ?? []) {
		if (args[rule.field] !== rule.when) continue
		for (const requiredField of rule.requires ?? []) {
			if (!hasUsableValue(args[requiredField])) {
				errors.push(rule.message ?? `参数依赖: 当 ${rule.field}=${String(rule.when)} 时必须提供 ${requiredField}`)
			}
		}
		for (const forbiddenField of rule.forbids ?? []) {
			if (hasUsableValue(args[forbiddenField])) {
				errors.push(rule.message ?? `参数不兼容: 当 ${rule.field}=${String(rule.when)} 时不能提供 ${forbiddenField}`)
			}
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
	toolName: string,
	schema: Record<string, unknown> | undefined,
	rawArgs: Record<string, unknown>,
): { args: Record<string, unknown>; notes: string[] } {
	const toolHint = getBuiltinToolHint(toolName)
	const { required } = getSchemaMeta(schema)
	const notes: string[] = []
	const properties =
		schema && typeof schema === 'object' && typeof schema.properties === 'object' && schema.properties !== null
			? (schema.properties as Record<string, unknown>)
			: {}
	const aliasMap = toolHint?.aliases ?? {}
	let preNormalized = trimArgsDeep(rawArgs) as Record<string, unknown>

	if (toolHint?.normalize) {
		const normalizedByHint = toolHint.normalize(preNormalized)
		preNormalized = normalizedByHint.args
		notes.push(...normalizedByHint.notes)
	}

	const normalized: Record<string, unknown> = {}

	for (const [rawKey, value] of Object.entries(preNormalized)) {
		if (value === undefined) continue
		const aliasTarget = aliasMap[rawKey]
		const snakeKey = toSnakeCaseKey(rawKey)
		const canonicalKey =
			aliasTarget
			|| (rawKey in properties ? rawKey : undefined)
			|| (snakeKey in properties ? snakeKey : undefined)
			|| rawKey
		if (canonicalKey !== rawKey) {
			notes.push(`已将 ${rawKey} 映射为 ${canonicalKey}`)
		}
		if (!(canonicalKey in normalized) || !hasUsableValue(normalized[canonicalKey])) {
			normalized[canonicalKey] = value
		}
	}

	for (const [key, value] of Object.entries(normalized)) {
		const coercion =
			toolHint?.valueCoercions?.[key]
			|| ((): ToolHintCoercion | undefined => {
				const propSchema = properties[key]
				const schemaType = getSchemaType(propSchema)
				if (schemaType === 'integer') return 'integer'
				if (schemaType === 'number') return 'number'
				if (schemaType === 'boolean') return 'boolean'
				if (
					schemaType === 'array'
					&& getSchemaType((propSchema as { items?: unknown }).items) === 'string'
				) {
					return 'string_array'
				}
				return undefined
			})()
		if (coercion) {
			const next = coerceValue(value, coercion)
			if (next !== value) {
				normalized[key] = next
				notes.push(`${key}: 已自动转换为 ${coercion}`)
			}
		}

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
		/(repo|repository|github|structure|search_doc)/i.test(toolName)
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

function stableToolValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stableToolValue(item))
	}
	if (!value || typeof value !== 'object') {
		return value
	}

	return Object.keys(value as Record<string, unknown>)
		.sort()
		.reduce<Record<string, unknown>>((acc, key) => {
			acc[key] = stableToolValue((value as Record<string, unknown>)[key])
			return acc
		}, {})
}

function buildToolFailureSignature(toolName: string, args: Record<string, unknown>): string {
	return `${toolName}:${JSON.stringify(stableToolValue(args))}`
}

function isToolFailureContent(content: string): boolean {
	const trimmed = content.trim()
	return trimmed.startsWith('工具调用失败:') || trimmed.startsWith('[工具执行错误]')
}

function recordToolFailure(
	failureTracker: ToolFailureTracker | undefined,
	signature: string,
	content: string,
): ToolFailureTrackerEntry | null {
	if (!failureTracker) return null
	const previous = failureTracker.get(signature)
	const next: ToolFailureTrackerEntry = {
		count: (previous?.count ?? 0) + 1,
		lastContent: content,
	}
	failureTracker.set(signature, next)
	return next
}

function clearToolFailure(
	failureTracker: ToolFailureTracker | undefined,
	signature: string,
): void {
	failureTracker?.delete(signature)
}

function getToolFailure(
	failureTracker: ToolFailureTracker | undefined,
	signature: string,
): ToolFailureTrackerEntry | undefined {
	return failureTracker?.get(signature)
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

function buildToolRecoveryHint(toolName: string): string {
	const toolHint = getBuiltinToolHint(toolName)
	const parts: string[] = []
	if (toolHint?.usageHint) {
		parts.push(`使用建议=${toolHint.usageHint}`)
	}
	if (toolHint?.fallbackTool) {
		parts.push(`如果当前工具不适合，请改用 ${toolHint.fallbackTool}`)
	}
	return parts.join('。')
}

/**
 * 将 MCP 工具转换为 OpenAI 兼容格式
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
 * @deprecated 使用 agent-loop 的 resolveCurrentTools 代替
 */
export async function resolveCurrentMcpTools(
	mcpTools: BaseOptions['mcpTools'],
	mcpGetTools?: BaseOptions['mcpGetTools'],
): Promise<McpToolDefinitionForProvider[]> {
	if (typeof mcpGetTools === 'function') {
		try {
			const nextTools = await mcpGetTools()
			if (Array.isArray(nextTools) && nextTools.length > 0) {
				return nextTools
			}
		} catch (error) {
			DebugLogger.warn('[MCP] 读取动态工具集失败，回退静态工具集', error)
		}
	}

	return Array.isArray(mcpTools) ? mcpTools : []
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
 */
export async function executeMcpToolCalls(
	toolCalls: OpenAIToolCall[],
	mcpTools: McpToolDefinitionForProvider[],
	mcpCallTool: McpCallToolFnForProvider,
	failureTracker?: ToolFailureTracker,
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

		const normalized = normalizeToolArgs(toolName, toolDef?.inputSchema, args)
		args = normalized.args
		if (normalized.notes.length > 0) {
			DebugLogger.warn(`[MCP] 工具参数已自动修正: ${toolName}`, normalized.notes)
		}
		const failureSignature = buildToolFailureSignature(toolName, args)
		const previousFailure = getToolFailure(failureTracker, failureSignature)
		if (previousFailure) {
			const recoveryHint = buildToolRecoveryHint(toolName)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content:
					`工具调用已阻止: 相同参数已失败 ${previousFailure.count} 次。` +
					`请不要继续使用同一组参数重试。最近错误=${previousFailure.lastContent}。${recoveryHint}`,
			})
			continue
		}

		const argValidationErrors = validateToolArgs(toolName, toolDef?.inputSchema, args)
		if (argValidationErrors.length > 0) {
			const validationText = argValidationErrors.join('; ')
			const recoveryHint = buildToolRecoveryHint(toolName)
			DebugLogger.warn(`[MCP] 工具参数校验失败: ${toolName}: ${validationText}`)
			const failureContent =
				`工具调用失败: 参数校验失败（${validationText}）。当前参数=${safeJsonPreview(args)}。` +
				`参数约束=${summarizeSchema(toolDef?.inputSchema)}。${recoveryHint}`
			recordToolFailure(failureTracker, failureSignature, failureContent)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: failureContent,
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
				if (typeof result === 'string' && isToolFailureContent(result)) {
					recordToolFailure(failureTracker, failureSignature, result)
				} else {
					clearToolFailure(failureTracker, failureSignature)
				}
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
			const recoveryHint = buildToolRecoveryHint(toolName)
			const failureContent =
				`工具调用失败: ${errorMsg}。最后参数=${safeJsonPreview(lastTriedArgs)}。` +
				`参数约束=${summarizeSchema(toolDef?.inputSchema)}。${recoveryHint}`
			recordToolFailure(failureTracker, failureSignature, failureContent)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: failureContent,
			})
		}
	}

	return results
}
