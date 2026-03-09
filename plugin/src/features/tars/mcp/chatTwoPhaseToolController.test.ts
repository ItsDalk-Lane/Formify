import { BUILTIN_TOOL_SEARCH_SERVER_ID } from 'src/builtin-mcp/constants'
import type { ToolLibrarySearchResult } from 'src/builtin-mcp/tool-library-types'
import { createChatTwoPhaseToolController } from './chatTwoPhaseToolController'

const initialTools = [
	{
		name: 'find_tool',
		description: 'find tool',
		inputSchema: {},
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
	},
	{
		name: 'get_tool_info',
		description: 'get tool info',
		inputSchema: {},
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
	},
	{
		name: 'list_tools',
		description: 'list tools',
		inputSchema: {},
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
	},
]

const createSearchResult = (
	name: string,
	score: number
): ToolLibrarySearchResult => ({
	entry: {
		filePath: `${name}.md`,
		body: '',
		summary: `${name} summary`,
		metadata: {
			name,
			serverId: `server:${name}`,
			serverName: `Server ${name}`,
			category: 'search',
			keywords: [name],
			scenarios: [name],
			decisionGuide: [],
			capabilities: [],
			parameters: [],
			examples: [],
		},
	},
	score,
	exactKeywordMatches: [name],
	partialKeywordMatches: [],
	scenarioMatches: [],
})

describe('createChatTwoPhaseToolController', () => {
	it('should keep phase one limited to tool-search tools initially', async () => {
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue([]),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([]),
			} as any,
			callTool: jest.fn(),
			initialTools,
			latestUserRequest: '查找工具',
		})

		await expect(controller.getCurrentTools()).resolves.toEqual(initialTools)
	})

	it('should inject top 2 candidates when score gap is within threshold', async () => {
		const searchResults = [
			createSearchResult('read_file', 180),
			createSearchResult('open_file', 170),
			createSearchResult('search_content', 120),
		]
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue(searchResults),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([
					{
						name: 'read_file',
						description: 'read file',
						inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						serverId: 'server:read_file',
					},
					{
						name: 'open_file',
						description: 'open file',
						inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						serverId: 'server:open_file',
					},
					{
						name: 'search_content',
						description: 'search content',
						inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
						serverId: 'server:search_content',
					},
				]),
			} as any,
			callTool: jest.fn(async (_serverId, toolName) =>
				toolName === 'find_tool' ? '# Tool Search\nfind results' : ''
			),
			initialTools,
			latestUserRequest: '读取 Roadmap.md',
		})

		await controller.callTool(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '读取文件',
		})
		const tools = await controller.getCurrentTools()

		expect(tools.map((tool) => tool.name)).toEqual([
			'find_tool',
			'get_tool_info',
			'list_tools',
			'read_file',
			'open_file',
		])
	})

	it('should directly execute write_file when request contains explicit path and content', async () => {
		const callTool = jest.fn(async (_serverId, toolName) => {
			if (toolName === 'find_tool') return '# Tool Search\nwrite_file'
			if (toolName === 'write_file') return 'written'
			return ''
		})
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue([
					createSearchResult('write_file', 140),
				]),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([
					{
						name: 'write_file',
						description: 'write file',
						inputSchema: {
							type: 'object',
							properties: {
								path: { type: 'string' },
								content: { type: 'string' },
								mode: { type: 'string' },
							},
							required: ['path', 'content'],
						},
						serverId: 'server:write_file',
					},
				]),
			} as any,
			callTool,
			initialTools,
			latestUserRequest: '请把下面内容写入 `Projects/test.md`\n```md\n# Hello\n```',
		})

		const result = await controller.callTool(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '写入文件',
		})

		expect(callTool).toHaveBeenCalledWith('server:write_file', 'write_file', {
			path: 'Projects/test.md',
			content: '# Hello',
			mode: 'write',
		})
		expect(result).toContain('调度层直接执行')
		expect(result).toContain('written')
		await expect(controller.getCurrentTools()).resolves.toEqual(initialTools)
	})

	it('should directly execute write_plan from explicit JSON payload', async () => {
		const callTool = jest.fn(async (_serverId, toolName) => {
			if (toolName === 'find_tool') return '# Tool Search\nwrite_plan'
			if (toolName === 'write_plan') return '{"title":"计划","summary":{"total":1}}'
			return ''
		})
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue([
					createSearchResult('write_plan', 160),
				]),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([
					{
						name: 'write_plan',
						description: 'write plan',
						inputSchema: {
							type: 'object',
							properties: {
								title: { type: 'string' },
								tasks: { type: 'array' },
							},
							required: ['tasks'],
						},
						serverId: 'server:write_plan',
					},
				]),
			} as any,
			callTool,
			initialTools,
			latestUserRequest:
				'请直接写计划：\n```json\n{"title":"计划","tasks":[{"name":"任务1","status":"todo"}]}\n```',
		})

		const result = await controller.callTool(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '创建计划',
		})

		expect(callTool).toHaveBeenCalledWith('server:write_plan', 'write_plan', {
			title: '计划',
			tasks: [{ name: '任务1', status: 'todo' }],
		})
		expect(result).toContain('调度层直接执行')
		expect(result).toContain('"summary"')
	})

	it('should fallback to get_tool_info when candidate tool fails with parameter-like error', async () => {
		const callTool = jest.fn(async (_serverId, toolName) => {
			if (toolName === 'find_tool') return '# Tool Search\nread_file'
			if (toolName === 'read_file') return '[工具执行错误] 缺少必填参数: path'
			if (toolName === 'get_tool_info') return '# read_file\n参数说明'
			return ''
		})
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue([
					createSearchResult('read_file', 180),
					createSearchResult('open_file', 175),
				]),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([
					{
						name: 'read_file',
						description: 'read file',
						inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						serverId: 'server:read_file',
					},
					{
						name: 'open_file',
						description: 'open file',
						inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						serverId: 'server:open_file',
					},
				]),
			} as any,
			callTool,
			initialTools,
			latestUserRequest: '读取某个文件',
		})

		await controller.callTool(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '读取文件',
		})
		const result = await controller.callTool('server:read_file', 'read_file', {})

		expect(result).toContain('已自动回退到 get_tool_info')
		expect(result).toContain('# read_file')
		expect(callTool).toHaveBeenCalledWith(BUILTIN_TOOL_SEARCH_SERVER_ID, 'get_tool_info', {
			name: 'read_file',
		})
	})

	it('should rerun find_tool when candidate tool fails with execution error', async () => {
		const callTool = jest.fn(async (_serverId, toolName) => {
			if (toolName === 'find_tool') return '# Tool Search\nrefreshed candidates'
			if (toolName === 'read_file') return '[工具执行错误] 路径不存在: Missing.md'
			return ''
		})
		const controller = createChatTwoPhaseToolController({
			manager: {
				searchToolLibrary: jest.fn().mockResolvedValue([
					createSearchResult('read_file', 200),
				]),
				getAvailableToolsWithLazyStart: jest.fn().mockResolvedValue([
					{
						name: 'read_file',
						description: 'read file',
						inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						serverId: 'server:read_file',
					},
				]),
			} as any,
			callTool,
			initialTools,
			latestUserRequest: '读取一个文件',
		})

		await controller.callTool(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '读取文件',
		})
		const result = await controller.callTool('server:read_file', 'read_file', {
			path: 'Missing.md',
		})

		expect(result).toContain('已自动重新执行 find_tool')
		expect(callTool).toHaveBeenCalledWith(BUILTIN_TOOL_SEARCH_SERVER_ID, 'find_tool', {
			task: '读取文件',
			serverIds: undefined,
			categories: undefined,
			limit: 3,
		})
	})
})
