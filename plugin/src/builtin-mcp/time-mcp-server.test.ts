import { Settings } from 'luxon';
import { createTimeBuiltinRuntime } from './time-mcp-server';

const FIXED_TS = Date.parse('2024-01-01T00:00:00.000Z');

describe('createTimeBuiltinRuntime', () => {
	const originalNow = Settings.now;

	beforeEach(() => {
		Settings.now = () => FIXED_TS;
	});

	afterEach(() => {
		Settings.now = originalNow;
	});

	it('should expose time tools and execute get_current_time', async () => {
		const runtime = await createTimeBuiltinRuntime({} as any);

		const tools = await runtime.listTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			'get_current_time',
			'convert_time',
		]);

		const result = await runtime.callTool('get_current_time', {
			timezone: 'Europe/London',
		});

		expect(JSON.parse(result)).toMatchObject({
			timezone: 'Europe/London',
			datetime: '2024-01-01T00:00:00+00:00',
			is_dst: false,
		});

		await runtime.close();
	});
});
