import { Settings } from 'luxon';
import { createCoreToolsBuiltinRuntime } from './core-tools-mcp-server';

const FIXED_TS = Date.parse('2024-01-01T00:00:00.000Z');

describe('createCoreToolsBuiltinRuntime', () => {
	const originalNow = Settings.now;

	beforeEach(() => {
		Settings.now = () => FIXED_TS;
	});

	afterEach(() => {
		Settings.now = originalNow;
	});

	it('should list core tools including formify_get_time', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const tools = await runtime.listTools();

		expect(tools.map((tool) => tool.name)).toEqual([
			'formify_execute_script',
			'formify_call_shell',
			'write_plan',
			'formify_get_time',
		]);

		await runtime.close();
	});

	it('should return Beijing time by default through formify_get_time', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const rawResult = await runtime.callTool('formify_get_time', {});
		const result = JSON.parse(rawResult);

		expect(result).toMatchObject({
			mode: 'current',
			timezone: 'Asia/Shanghai',
			month: 1,
			iso_week_of_year: 1,
			iso_week_year: 2024,
		});

		await runtime.close();
	});

	it('should convert time through formify_get_time convert mode', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const rawResult = await runtime.callTool('formify_get_time', {
			mode: 'convert',
			source_timezone: 'Europe/Warsaw',
			target_timezone: 'Europe/London',
			time: '12:00',
		});
		const result = JSON.parse(rawResult);

		expect(result).toMatchObject({
			mode: 'convert',
			time_difference: '-1.0h',
			source: {
				timezone: 'Europe/Warsaw',
			},
			target: {
				timezone: 'Europe/London',
			},
		});

		await runtime.close();
	});

	it('should allow current mode to override the default timezone', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any, {
			builtinTimeDefaultTimezone: 'Asia/Shanghai',
		});

		const rawResult = await runtime.callTool('formify_get_time', {
			timezone: 'Europe/London',
		});
		const result = JSON.parse(rawResult);

		expect(result).toMatchObject({
			mode: 'current',
			timezone: 'Europe/London',
		});

		await runtime.close();
	});

	it('should reject convert-only arguments in current mode', async () => {
		const runtime = await createCoreToolsBuiltinRuntime({} as any);

		const rawResult = await runtime.callTool('formify_get_time', {
			mode: 'current',
			source_timezone: 'Europe/Warsaw',
		});

		expect(rawResult).toContain('[工具执行错误]');
		expect(rawResult).toContain('current 模式不支持参数 source_timezone');

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
