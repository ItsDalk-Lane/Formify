import { BUILTIN_TOOL_SEARCH_SERVER_ID } from 'src/builtin-mcp/constants'
import type { ToolLibrarySearchResult } from 'src/builtin-mcp/tool-library-types'
import type {
	McpCallToolFnForProvider,
	McpGetToolsFnForProvider,
	McpToolDefinitionForProvider,
} from '../providers'
import { McpClientManager } from './McpClientManager'

const TOOL_SEARCH_TOOL_NAMES = new Set(['find_tool', 'get_tool_info', 'list_tools'])
const DEFAULT_FIND_TOOL_LIMIT = 3
const MAX_CANDIDATE_COUNT = 3
const SCORE_GAP_THRESHOLD = 20
const DIRECT_EXECUTION_MIN_SCORE = 100
const DIRECT_EXECUTION_TOOL_NAMES = new Set([
	'read_file',
	'write_file',
	'list_directory',
	'open_file',
	'get_first_link_path',
	'search_files',
	'search_path',
	'search_folder',
	'search_content',
	'search_tags',
	'search_line',
	'search_block',
	'search_section',
	'search_tasks',
	'quick_search',
	'advanced_search',
	'file_only_search',
	'content_only_search',
	'tag_search',
	'write_plan',
	'delegate_to_agent',
	'sequentialthinking',
])

type SearchArgs = {
	task: string
	serverIds?: string[]
	categories?: string[]
	limit?: number
}

type CandidateMatch = {
	searchResult: ToolLibrarySearchResult
	tool: McpToolDefinitionForProvider
}

interface ChatTwoPhaseToolControllerOptions {
	manager: McpClientManager
	callTool: McpCallToolFnForProvider
	initialTools: McpToolDefinitionForProvider[]
	latestUserRequest: string
	allowedServerIds?: string[]
}

interface ChatTwoPhaseToolController {
	getCurrentTools: McpGetToolsFnForProvider
	callTool: McpCallToolFnForProvider
}

type HandleFindToolOptions = {
	skipDirectExecution?: boolean
}

const isToolExecutionErrorText = (text: string): boolean =>
	text.startsWith('[工具执行错误]')

const stripToolExecutionErrorPrefix = (text: string): string =>
	text.replace(/^\[工具执行错误\]\s*/, '').trim()

const dedupeTools = (
	tools: McpToolDefinitionForProvider[]
): McpToolDefinitionForProvider[] => {
	const seen = new Set<string>()
	const result: McpToolDefinitionForProvider[] = []
	for (const tool of tools) {
		const key = `${tool.serverId}:${tool.name}`
		if (seen.has(key)) continue
		seen.add(key)
		result.push(tool)
	}
	return result
}

const getSchemaRequiredKeys = (
	schema: Record<string, unknown> | undefined
): string[] => {
	if (!schema || typeof schema !== 'object' || !Array.isArray(schema.required)) {
		return []
	}
	return schema.required.filter((item): item is string => typeof item === 'string')
}

const hasAllRequiredArgs = (
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>
): boolean =>
	getSchemaRequiredKeys(schema).every((key) => {
		const value = args[key]
		return value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())
	})

const getQuotedSegments = (text: string): string[] => {
	const patterns = [
		/`([^`]+)`/g,
		/"([^"\n]+)"/g,
		/'([^'\n]+)'/g,
		/“([^”\n]+)”/g,
		/‘([^’\n]+)’/g,
	]
	const values: string[] = []
	for (const pattern of patterns) {
		let matched: RegExpExecArray | null = pattern.exec(text)
		while (matched) {
			const value = matched[1]?.trim()
			if (value) {
				values.push(value)
			}
			matched = pattern.exec(text)
		}
	}
	return Array.from(new Set(values))
}

const getCodeBlockSegments = (text: string): string[] => {
	const values: string[] = []
	const pattern = /```(?:[\w-]+)?\n([\s\S]*?)```/g
	let matched: RegExpExecArray | null = pattern.exec(text)
	while (matched) {
		const value = matched[1]?.trim()
		if (value) {
			values.push(value)
		}
		matched = pattern.exec(text)
	}
	return values
}

const getWikiLinkTargets = (text: string): string[] => {
	const values: string[] = []
	const pattern = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
	let matched: RegExpExecArray | null = pattern.exec(text)
	while (matched) {
		const value = matched[1]?.trim()
		if (value) {
			values.push(value)
		}
		matched = pattern.exec(text)
	}
	return Array.from(new Set(values))
}

const getHashTags = (text: string): string[] => {
	const values: string[] = []
	const pattern = /(^|\s)(#[^\s#]+)/g
	let matched: RegExpExecArray | null = pattern.exec(text)
	while (matched) {
		const value = matched[2]?.trim()
		if (value) {
			values.push(value)
		}
		matched = pattern.exec(text)
	}
	return Array.from(new Set(values))
}

const looksLikePath = (value: string): boolean =>
	/(^|\/)[^/\n]+/.test(value) && (value.includes('/') || /\.[A-Za-z0-9_-]+$/.test(value))

const getPathCandidates = (text: string): string[] => {
	const candidates = [
		...getQuotedSegments(text),
		...text.match(/(?:[^\s"'`“”‘’]+\/)+[^\s"'`“”‘’]+(?:\.[A-Za-z0-9_-]+)?/g) ?? [],
	]
	return Array.from(
		new Set(
			candidates
				.map((item) => item.trim().replace(/[.,，。；;]+$/g, ''))
				.filter((item) => item.length > 0 && looksLikePath(item))
		)
	)
}

const pickSingleValue = (values: string[]): string | null =>
	values.length === 1 ? values[0] : null

const stripLeadingIntent = (text: string): string => {
	let next = text.trim()
	const patterns = [
		/^(请|帮我|麻烦|帮忙)\s*/i,
		/^(在文件名中|在路径中|在文件夹中|在正文中|在标签中)\s*/i,
		/^(搜索|查找|搜|找|检索|search)\s*/i,
	]
	for (const pattern of patterns) {
		next = next.replace(pattern, '').trim()
	}
	return next
}

const extractSearchQuery = (text: string): string | null => {
	const quoted = getQuotedSegments(text).filter((item) => !looksLikePath(item))
	const tag = pickSingleValue(getHashTags(text))
	if (tag) return tag
	const wiki = pickSingleValue(getWikiLinkTargets(text))
	if (wiki) return wiki
	const quotedValue = pickSingleValue(quoted)
	if (quotedValue) return quotedValue

	const stripped = stripLeadingIntent(text)
	if (
		stripped
		&& !stripped.includes('\n')
		&& stripped.length <= 80
		&& !/[，。；;]/.test(stripped)
	) {
		return stripped
	}

	return null
}

const extractWriteFileArgs = (text: string): Record<string, unknown> | null => {
	const path = pickSingleValue(getPathCandidates(text))
	if (!path) return null

	const codeBlocks = getCodeBlockSegments(text)
	if (codeBlocks.length === 1) {
		return {
			path,
			content: codeBlocks[0],
			mode: /\b(append|追加)\b/i.test(text) ? 'append' : 'write',
		}
	}

	const quoted = getQuotedSegments(text).filter((item) => item !== path)
	const content = pickSingleValue(quoted)
	if (!content) return null

	return {
		path,
		content,
		mode: /\b(append|追加)\b/i.test(text) ? 'append' : 'write',
	}
}

const extractWritePlanArgs = (text: string): Record<string, unknown> | null => {
	for (const block of getCodeBlockSegments(text)) {
		try {
			const parsed = JSON.parse(block) as Record<string, unknown>
			if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
				return parsed
			}
		} catch {
			continue
		}
	}
	return null
}

const extractDelegateArgs = (text: string): Record<string, unknown> | null => {
	const idMatch = text.match(/(?:id|agent|代理)\s*[:=]\s*([A-Za-z0-9._:-]+)/i)
	if (!idMatch?.[1]) {
		return null
	}

	const taskMatch =
		text.match(/(?:task|任务)\s*[:=]\s*([\s\S]+)/i)
		?? text.match(/委托(?:给代理)?\s+[A-Za-z0-9._:-]+\s+执行[:：]?\s*([\s\S]+)/i)

	const task = taskMatch?.[1]?.trim()
	if (!task) {
		return null
	}

	return {
		id: idMatch[1].trim(),
		task,
	}
}

const extractSequentialThinkingArgs = (
	text: string
): Record<string, unknown> | null => {
	for (const block of getCodeBlockSegments(text)) {
		try {
			const parsed = JSON.parse(block) as Record<string, unknown>
			if (
				typeof parsed.thought === 'string'
				&& typeof parsed.thoughtNumber === 'number'
				&& typeof parsed.totalThoughts === 'number'
				&& typeof parsed.nextThoughtNeeded === 'boolean'
			) {
				return parsed
			}
		} catch {
			continue
		}
	}
	return null
}

const extractDirectExecutionArgs = (
	tool: McpToolDefinitionForProvider,
	sourceText: string
): Record<string, unknown> | null => {
	const text = sourceText.trim()
	if (!text) return null

	switch (tool.name) {
		case 'read_file':
		case 'list_directory':
		case 'open_file': {
			const path = pickSingleValue(getPathCandidates(text))
			return path ? { path } : null
		}
		case 'get_first_link_path': {
			const internalLink = pickSingleValue(getWikiLinkTargets(text))
			return internalLink ? { internalLink } : null
		}
		case 'write_file':
			return extractWriteFileArgs(text)
		case 'search_tasks': {
			const query = extractSearchQuery(text)
			if (!query) return null
			if (/(未完成|todo)/i.test(text)) {
				return { query, taskStatus: 'todo' }
			}
			if (/(已完成|done)/i.test(text)) {
				return { query, taskStatus: 'done' }
			}
			return { query }
		}
		case 'search_files':
		case 'search_path':
		case 'search_folder':
		case 'search_content':
		case 'search_tags':
		case 'search_line':
		case 'search_block':
		case 'search_section':
		case 'quick_search':
		case 'advanced_search':
		case 'file_only_search':
		case 'content_only_search':
		case 'tag_search': {
			const query = extractSearchQuery(text)
			return query ? { query } : null
		}
		case 'write_plan':
			return extractWritePlanArgs(text)
		case 'delegate_to_agent':
			return extractDelegateArgs(text)
		case 'sequentialthinking':
			return extractSequentialThinkingArgs(text)
		default:
			return null
	}
}

const isRecoverableParameterError = (message: string): boolean =>
	/(缺少必填参数|参数类型不匹配|不能为空|required|invalid|schema|argument|zod)/i.test(message)

const buildDirectExecutionText = (
	findToolText: string,
	tool: McpToolDefinitionForProvider,
	args: Record<string, unknown>,
	result: string
): string =>
	[
		findToolText,
		'',
		'## 调度层直接执行',
		`- 真实工具：${tool.name}`,
		`- 参数：${JSON.stringify(args)}`,
		'',
		'### 工具结果',
		result,
	].join('\n')

class ChatTwoPhaseControllerImpl implements ChatTwoPhaseToolController {
	private readonly phaseOneTools: McpToolDefinitionForProvider[]
	private currentTools: McpToolDefinitionForProvider[]
	private latestFindArgs: SearchArgs | null = null
	private currentCandidates: McpToolDefinitionForProvider[] = []

	constructor(private readonly options: ChatTwoPhaseToolControllerOptions) {
		this.phaseOneTools = dedupeTools([...options.initialTools])
		this.currentTools = [...this.phaseOneTools]
	}

	getCurrentTools = async (): Promise<McpToolDefinitionForProvider[]> =>
		dedupeTools([...this.currentTools])

	callTool = async (
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<string> => {
		if (
			serverId === BUILTIN_TOOL_SEARCH_SERVER_ID
			&& toolName === 'find_tool'
		) {
			return await this.handleFindTool(args as SearchArgs)
		}

		const candidateTool = this.currentCandidates.find(
			(tool) => tool.serverId === serverId && tool.name === toolName
		)
		if (candidateTool) {
			return await this.handleCandidateToolCall(candidateTool, args)
		}

		return await this.executeRawTool(serverId, toolName, args)
	}

	private async handleFindTool(
		args: SearchArgs,
		options: HandleFindToolOptions = {}
	): Promise<string> {
		const normalizedArgs: SearchArgs = {
			task: typeof args.task === 'string' ? args.task.trim() : '',
			serverIds: Array.isArray(args.serverIds) ? args.serverIds : undefined,
			categories: Array.isArray(args.categories) ? args.categories : undefined,
			limit:
				typeof args.limit === 'number' && Number.isFinite(args.limit)
					? Math.max(1, Math.floor(args.limit))
					: DEFAULT_FIND_TOOL_LIMIT,
		}
		const findToolText = await this.executeRawTool(
			BUILTIN_TOOL_SEARCH_SERVER_ID,
			'find_tool',
			normalizedArgs as Record<string, unknown>
		)

		if (!normalizedArgs.task) {
			this.resetToPhaseOne()
			return findToolText
		}

		this.latestFindArgs = normalizedArgs
		const candidates = await this.resolveCandidates(normalizedArgs)
		if (candidates.length === 0) {
			this.resetToPhaseOne()
			return findToolText
		}

		const [topCandidate] = candidates
		if (
			!options.skipDirectExecution
			&& this.canDirectExecute(topCandidate, candidates)
		) {
			const requestText = [this.options.latestUserRequest, normalizedArgs.task]
				.filter(Boolean)
				.join('\n\n')
			const directArgs = extractDirectExecutionArgs(topCandidate.tool, requestText)
			if (directArgs && hasAllRequiredArgs(topCandidate.tool.inputSchema, directArgs)) {
				try {
					const directResult = await this.executeRawTool(
						topCandidate.tool.serverId,
						topCandidate.tool.name,
						directArgs
					)
					this.resetToPhaseOne()
					return buildDirectExecutionText(
						findToolText,
						topCandidate.tool,
						directArgs,
						directResult
					)
				} catch (error) {
					return await this.handleToolFailure(
						topCandidate.tool,
						directArgs,
						error,
						true
					)
				}
			}
		}

		this.currentCandidates = candidates.map((item) => item.tool)
		this.currentTools = dedupeTools([
			...this.phaseOneTools,
			...this.currentCandidates,
		])
		return findToolText
	}

	private async handleCandidateToolCall(
		tool: McpToolDefinitionForProvider,
		args: Record<string, unknown>
	): Promise<string> {
		try {
			return await this.executeRawTool(tool.serverId, tool.name, args)
		} catch (error) {
			return await this.handleToolFailure(tool, args, error, false)
		}
	}

	private async handleToolFailure(
		tool: McpToolDefinitionForProvider,
		args: Record<string, unknown>,
		error: unknown,
		resetOnSuccess: boolean
	): Promise<string> {
		const errorText = error instanceof Error ? error.message : String(error)
		if (isRecoverableParameterError(errorText)) {
			const toolInfo = await this.safeCallToolSearchTool('get_tool_info', {
				name: tool.name,
			})
			if (resetOnSuccess) {
				this.resetToPhaseOne()
			}
			return [
				`[候选工具调用失败] ${tool.name}: ${errorText}`,
				'',
				'已自动回退到 get_tool_info，供下一轮修正参数。',
				toolInfo ? `\n${toolInfo}` : '',
			]
				.join('\n')
				.trim()
		}

		if (this.latestFindArgs) {
			const refreshed = await this.handleFindTool(this.latestFindArgs, {
				skipDirectExecution: true,
			})
			return [
				`[候选工具调用失败] ${tool.name}: ${errorText}`,
				'',
				'已自动重新执行 find_tool，并刷新候选工具。',
				'',
				refreshed,
			].join('\n')
		}

		if (resetOnSuccess) {
			this.resetToPhaseOne()
		}
		return `[候选工具调用失败] ${tool.name}: ${errorText}`
	}

	private async safeCallToolSearchTool(
		toolName: 'get_tool_info' | 'find_tool',
		args: Record<string, unknown>
	): Promise<string | null> {
		try {
			return await this.executeRawTool(
				BUILTIN_TOOL_SEARCH_SERVER_ID,
				toolName,
				args
			)
		} catch {
			return null
		}
	}

	private async resolveCandidates(args: SearchArgs): Promise<CandidateMatch[]> {
		const searchResults = await this.options.manager.searchToolLibrary({
			task: args.task,
			serverIds: args.serverIds,
			categories: args.categories,
			limit: Math.max(DEFAULT_FIND_TOOL_LIMIT, args.limit ?? DEFAULT_FIND_TOOL_LIMIT),
		})
		const allowedTools = await this.getAllowedRuntimeTools()
		const allowedToolMap = new Map(
			allowedTools.map((tool) => [tool.name.toLowerCase(), tool] as const)
		)
		const matches: CandidateMatch[] = []
		for (const result of searchResults) {
			const tool = allowedToolMap.get(result.entry.metadata.name.toLowerCase())
			if (!tool) continue
			matches.push({
				searchResult: result,
				tool,
			})
		}

		if (matches.length === 0) {
			return []
		}

		const [first] = matches
		if (!first) {
			return []
		}

		const selected: CandidateMatch[] = [first]
		for (const match of matches.slice(1, MAX_CANDIDATE_COUNT)) {
			if (first.searchResult.score - match.searchResult.score <= SCORE_GAP_THRESHOLD) {
				selected.push(match)
			}
		}
		return selected
	}

	private canDirectExecute(
		topCandidate: CandidateMatch,
		candidates: CandidateMatch[]
	): boolean {
		if (TOOL_SEARCH_TOOL_NAMES.has(topCandidate.tool.name)) {
			return false
		}
		if (!DIRECT_EXECUTION_TOOL_NAMES.has(topCandidate.tool.name)) {
			return false
		}
		if (topCandidate.searchResult.score < DIRECT_EXECUTION_MIN_SCORE) {
			return false
		}
		return candidates.length === 1
	}

	private async getAllowedRuntimeTools(): Promise<McpToolDefinitionForProvider[]> {
		const availableTools = await this.options.manager.getAvailableToolsWithLazyStart()
		const allowedServerIds =
			Array.isArray(this.options.allowedServerIds)
			&& this.options.allowedServerIds.length > 0
				? new Set(this.options.allowedServerIds)
				: null
		return availableTools
			.filter((tool) => {
				if (!allowedServerIds) {
					return !TOOL_SEARCH_TOOL_NAMES.has(tool.name)
				}
				return (
					allowedServerIds.has(tool.serverId)
					&& !TOOL_SEARCH_TOOL_NAMES.has(tool.name)
				)
			})
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				serverId: tool.serverId,
			}))
	}

	private async executeRawTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<string> {
		const result = await this.options.callTool(serverId, toolName, args)
		if (isToolExecutionErrorText(result)) {
			throw new Error(stripToolExecutionErrorPrefix(result))
		}
		return result
	}

	private resetToPhaseOne(): void {
		this.currentCandidates = []
		this.currentTools = [...this.phaseOneTools]
	}
}

export function createChatTwoPhaseToolController(
	options: ChatTwoPhaseToolControllerOptions
): ChatTwoPhaseToolController {
	return new ChatTwoPhaseControllerImpl(options)
}
