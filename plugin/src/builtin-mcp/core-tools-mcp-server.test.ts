import { createCoreToolsBuiltinRuntime } from './core-tools-mcp-server';

describe('createCoreToolsBuiltinRuntime', () => {
	it('should list only the 3 core tools', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const tools = await runtime.listTools();

		expect(tools.map((tool) => tool.name)).toEqual([
			'execute_script',
			'call_shell',
			'write_plan',
		]);

		await runtime.close();
	});

	it('should keep write_plan available after moving it out of vault runtime', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const rawResult = await runtime.callTool('write_plan', {
			title: '核心工具计划',
			tasks: [
				{
					name: '迁移 write_plan',
					status: 'in_progress',
					acceptance_criteria: ['live plan 可继续同步'],
				},
			],
		});

		expect(JSON.parse(rawResult)).toMatchObject({
			title: '核心工具计划',
			tasks: [
				{
					name: '迁移 write_plan',
					status: 'in_progress',
					acceptance_criteria: ['live plan 可继续同步'],
				},
			],
		});

		await runtime.close();
	});
});
