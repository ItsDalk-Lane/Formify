import {
	executeMcpToolCalls,
	type OpenAIToolCall,
} from './mcpToolCallHandler'
import type { McpToolDefinitionForProvider } from '../providers'

describe('executeMcpToolCalls', () => {
	it('should normalize legacy camelCase filesystem arguments before calling the tool', async () => {
		const toolCalls: OpenAIToolCall[] = [
			{
				id: 'call_1',
				type: 'function',
				function: {
					name: 'search_content',
					arguments: JSON.stringify({
						pattern: 'TODO',
						scope_path: 'notes',
						fileType: 'md,tsx',
						maxResults: '5',
						caseSensitive: 'true',
						contextLines: '2',
					}),
				},
			},
		]

		const tools: McpToolDefinitionForProvider[] = [
			{
				name: 'search_content',
				description: '搜索文件内容',
				inputSchema: {
					type: 'object',
					required: ['pattern'],
					properties: {
						pattern: { type: 'string' },
						scope_path: { type: 'string' },
						file_types: { type: 'array', items: { type: 'string' } },
						max_results: { type: 'integer' },
						case_sensitive: { type: 'boolean' },
						context_lines: { type: 'integer' },
					},
				},
				serverId: 'builtin-filesystem',
			},
		]

		const callTool = jest.fn().mockResolvedValue('ok')
		const results = await executeMcpToolCalls(toolCalls, tools, callTool)

		expect(callTool).toHaveBeenCalledWith('builtin-filesystem', 'search_content', {
			pattern: 'TODO',
			scope_path: 'notes',
			file_types: ['md', 'tsx'],
			max_results: 5,
			case_sensitive: true,
			context_lines: 2,
		})
		expect(results[0]).toMatchObject({
			role: 'tool',
			name: 'search_content',
			content: 'ok',
		})
	})

	it('should return actionable validation guidance when the wrong tool shape is used', async () => {
		const toolCalls: OpenAIToolCall[] = [
			{
				id: 'call_2',
				type: 'function',
				function: {
					name: 'query_index',
					arguments: JSON.stringify({
						target_path: 'notes/alpha.md',
					}),
				},
			},
		]

		const tools: McpToolDefinitionForProvider[] = [
			{
				name: 'query_index',
				description: '查询结构化索引',
				inputSchema: {
					type: 'object',
					required: ['data_source', 'select'],
					properties: {
						data_source: { type: 'string', enum: ['file', 'property', 'tag', 'task'] },
						select: { type: 'object' },
						limit: { type: 'integer' },
					},
				},
				serverId: 'builtin-filesystem',
			},
		]

		const callTool = jest.fn()
		const results = await executeMcpToolCalls(toolCalls, tools, callTool)

		expect(callTool).not.toHaveBeenCalled()
		expect(results[0].content).toContain('参数校验失败')
		expect(results[0].content).toContain('未知参数: target_path')
		expect(results[0].content).toContain('如果当前工具不适合，请改用 find_paths')
	})

	it('should normalize common filesystem aliases like path, files, and responseFormat', async () => {
		const toolCalls: OpenAIToolCall[] = [
			{
				id: 'call_3',
				type: 'function',
				function: {
					name: 'list_directory',
					arguments: JSON.stringify({
						path: 'notes',
						includeSizes: 'true',
						responseFormat: 'json',
					}),
				},
			},
			{
				id: 'call_4',
				type: 'function',
				function: {
					name: 'read_files',
					arguments: JSON.stringify({
						files: ['notes/a.md', 'notes/b.md'],
						readMode: 'head',
						lineCount: '10',
						responseFormat: 'json',
					}),
				},
			},
		]

		const tools: McpToolDefinitionForProvider[] = [
			{
				name: 'list_directory',
				description: '浏览目录',
				inputSchema: {
					type: 'object',
					required: ['directory_path'],
					properties: {
						directory_path: { type: 'string' },
						include_sizes: { type: 'boolean' },
						response_format: { type: 'string', enum: ['json', 'text'] },
					},
				},
				serverId: 'builtin-filesystem',
			},
			{
				name: 'read_files',
				description: '批量读取文件',
				inputSchema: {
					type: 'object',
					required: ['file_paths'],
					properties: {
						file_paths: { type: 'array', items: { type: 'string' } },
						read_mode: { type: 'string', enum: ['segment', 'head'] },
						line_count: { type: 'integer' },
						response_format: { type: 'string', enum: ['json', 'text'] },
					},
				},
				serverId: 'builtin-filesystem',
			},
		]

		const callTool = jest.fn().mockResolvedValue('ok')
		await executeMcpToolCalls(toolCalls, tools, callTool)

		expect(callTool).toHaveBeenNthCalledWith(1, 'builtin-filesystem', 'list_directory', {
			directory_path: 'notes',
			include_sizes: true,
			response_format: 'json',
		})
		expect(callTool).toHaveBeenNthCalledWith(2, 'builtin-filesystem', 'read_files', {
			file_paths: ['notes/a.md', 'notes/b.md'],
			read_mode: 'head',
			line_count: 10,
			response_format: 'json',
		})
	})

	it('should block repeated identical tool failures instead of retrying forever', async () => {
		const toolCalls: OpenAIToolCall[] = [
			{
				id: 'call_5',
				type: 'function',
				function: {
					name: 'query_index',
					arguments: JSON.stringify({
						target_path: 'notes/alpha.md',
					}),
				},
			},
		]

		const tools: McpToolDefinitionForProvider[] = [
			{
				name: 'query_index',
				description: '结构化索引查询',
				inputSchema: {
					type: 'object',
					required: ['data_source', 'select'],
					properties: {
						data_source: { type: 'string', enum: ['file', 'property', 'tag', 'task'] },
						select: { type: 'object' },
					},
				},
				serverId: 'builtin-filesystem',
			},
		]

		const callTool = jest.fn()
		const failureTracker = new Map()
		const firstResults = await executeMcpToolCalls(toolCalls, tools, callTool, failureTracker)
		const secondResults = await executeMcpToolCalls(toolCalls, tools, callTool, failureTracker)

		expect(callTool).not.toHaveBeenCalled()
		expect(firstResults[0].content).toContain('参数校验失败')
		expect(secondResults[0].content).toContain('工具调用已阻止')
		expect(secondResults[0].content).toContain('请不要继续使用同一组参数重试')
	})
})
