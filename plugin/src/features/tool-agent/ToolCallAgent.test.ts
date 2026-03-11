import { ToolCallAgent } from './ToolCallAgent';

describe('ToolCallAgent', () => {
	it('passes the full available tool set into the prompt builder', async () => {
		const promptBuilder = {
			build: jest.fn().mockReturnValue({
				systemPrompt: 'system',
				userPrompt: 'user',
				modelTools: [
					{
						name: 'read_file',
						serverId: '__builtin__:vault-tools',
						description: 'Read file',
						inputSchema: {},
					},
					{
						name: 'search_content',
						serverId: 'builtin.obsidian-search',
						description: 'Search content',
						inputSchema: {},
					},
				],
			}),
		};
		const runner = {
			run: jest.fn().mockResolvedValue({
				content: JSON.stringify({
					status: 'success',
					summary: 'done',
				}),
				messages: [],
			}),
		};

		const agent = new ToolCallAgent({
			getSettings: () => ({
				enabled: true,
				modelTag: 'tool-model',
				defaultConstraints: {
					maxToolCalls: 6,
					timeoutMs: 5000,
					allowShell: false,
					allowScript: false,
				},
			}),
			resolveProviderByTag: () => null,
			getVendorByName: () => undefined,
			callTool: jest.fn(),
			getAvailableTools: async () => [
				{
					name: 'read_file',
					serverId: '__builtin__:vault-tools',
					description: 'Read file',
					inputSchema: {},
				},
				{
					name: 'search_content',
					serverId: 'builtin.obsidian-search',
					description: 'Search content',
					inputSchema: {},
				},
			],
			promptBuilder: promptBuilder as any,
			runner: runner as any,
		});

		const result = await agent.execute({
			task: '读取并总结当前文件',
		});

		expect(promptBuilder.build).toHaveBeenCalledWith(expect.objectContaining({
			tools: expect.arrayContaining([
				expect.objectContaining({ name: 'read_file' }),
				expect.objectContaining({ name: 'search_content' }),
			]),
		}));
		expect(result.status).toBe('success');
		expect(result.summary).toBe('done');
	});
});
