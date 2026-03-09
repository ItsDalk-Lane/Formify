import { createToolSearchBuiltinRuntime } from './tool-search-mcp-server';

describe('createToolSearchBuiltinRuntime', () => {
	it('should list all 3 tool-search tools', async () => {
		const manager = {
			searchTools: jest.fn().mockResolvedValue([]),
			formatFindToolResults: jest.fn().mockReturnValue('find results'),
			getEntry: jest.fn().mockResolvedValue(null),
			formatToolInfo: jest.fn(),
			listEntries: jest.fn().mockResolvedValue([]),
			formatList: jest.fn().mockReturnValue('list results'),
		};

		const runtime = await createToolSearchBuiltinRuntime({} as any, manager as any);
		const tools = await runtime.listTools();

		expect(tools).toHaveLength(3);
		expect(tools.map((tool) => tool.name)).toEqual([
			'find_tool',
			'get_tool_info',
			'list_tools',
		]);

		await runtime.close();
	});

	it('should use default limit=3 when calling find_tool', async () => {
		const manager = {
			searchTools: jest.fn().mockResolvedValue([]),
			formatFindToolResults: jest.fn().mockReturnValue('formatted find results'),
			getEntry: jest.fn().mockResolvedValue(null),
			formatToolInfo: jest.fn(),
			listEntries: jest.fn().mockResolvedValue([]),
			formatList: jest.fn().mockReturnValue('list results'),
		};

		const runtime = await createToolSearchBuiltinRuntime({} as any, manager as any);
		const result = await runtime.callTool('find_tool', {
			task: '我想找未完成任务',
		});

		expect(manager.searchTools).toHaveBeenCalledWith({
			task: '我想找未完成任务',
			serverIds: undefined,
			categories: undefined,
			limit: 3,
		});
		expect(result).toBe('formatted find results');

		await runtime.close();
	});

	it('should return full guide from get_tool_info', async () => {
		const entry = {
			metadata: {
				name: 'search_tasks',
			},
		};
		const manager = {
			searchTools: jest.fn().mockResolvedValue([]),
			formatFindToolResults: jest.fn().mockReturnValue('find results'),
			getEntry: jest.fn().mockResolvedValue(entry),
			formatToolInfo: jest.fn().mockReturnValue('# search_tasks\n完整说明'),
			listEntries: jest.fn().mockResolvedValue([]),
			formatList: jest.fn().mockReturnValue('list results'),
		};

		const runtime = await createToolSearchBuiltinRuntime({} as any, manager as any);
		const result = await runtime.callTool('get_tool_info', {
			name: 'search_tasks',
		});

		expect(manager.getEntry).toHaveBeenCalledWith('search_tasks');
		expect(manager.formatToolInfo).toHaveBeenCalledWith(entry);
		expect(result).toContain('完整说明');

		await runtime.close();
	});

	it('should pass list_tools filters through to the manager', async () => {
		const manager = {
			searchTools: jest.fn().mockResolvedValue([]),
			formatFindToolResults: jest.fn().mockReturnValue('find results'),
			getEntry: jest.fn().mockResolvedValue(null),
			formatToolInfo: jest.fn(),
			listEntries: jest.fn().mockResolvedValue([{ metadata: { name: 'search_content' } }]),
			formatList: jest.fn().mockReturnValue('# Tool List\nsearch_content'),
		};

		const runtime = await createToolSearchBuiltinRuntime({} as any, manager as any);
		const result = await runtime.callTool('list_tools', {
			serverIds: ['builtin.obsidian-search'],
			categories: ['search'],
		});

		expect(manager.listEntries).toHaveBeenCalledWith({
			serverIds: ['builtin.obsidian-search'],
			categories: ['search'],
		});
		expect(manager.formatList).toHaveBeenCalledWith(
			[{ metadata: { name: 'search_content' } }],
			{
				serverIds: ['builtin.obsidian-search'],
				categories: ['search'],
			}
		);
		expect(result).toContain('Tool List');

		await runtime.close();
	});
});
