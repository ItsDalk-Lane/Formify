import {
	DEFAULT_TOOL_EXECUTION_SETTINGS,
	resolveToolExecutionSettings,
	syncToolExecutionSettings,
} from './settings';

describe('tool execution settings', () => {
	it('resolves shared settings from legacy MCP and tool agent fields', () => {
		const resolved = resolveToolExecutionSettings({
			mcp: {
				servers: [],
				maxToolCallLoops: 14,
			},
			toolAgent: {
				modelTag: '',
				enabled: false,
				defaultConstraints: {
					maxToolCalls: 9,
					timeoutMs: 42000,
					allowShell: false,
					allowScript: false,
				},
			},
		} as any);

		expect(resolved).toEqual({
			maxToolCalls: 14,
			timeoutMs: 42000,
		});
	});

	it('syncs shared settings back into legacy fields', () => {
		const settings = {
			mcp: {
				servers: [],
				maxToolCallLoops: 3,
			},
			toolAgent: {
				modelTag: '',
				enabled: true,
				defaultConstraints: {
					maxToolCalls: 7,
					timeoutMs: 9000,
					allowShell: true,
					allowScript: false,
				},
			},
		} as any;

		const synced = syncToolExecutionSettings(settings, {
			maxToolCalls: 18,
			timeoutMs: 55000,
		});

		expect(synced).toEqual({
			maxToolCalls: 18,
			timeoutMs: 55000,
		});
		expect(settings.toolExecution).toEqual({
			maxToolCalls: 18,
			timeoutMs: 55000,
		});
		expect(settings.mcp.maxToolCallLoops).toBe(18);
		expect(settings.toolAgent.defaultConstraints).toMatchObject({
			maxToolCalls: 18,
			timeoutMs: 55000,
			allowShell: true,
			allowScript: false,
		});
	});

	it('falls back to defaults when no values are configured', () => {
		expect(resolveToolExecutionSettings(undefined)).toEqual(
			DEFAULT_TOOL_EXECUTION_SETTINGS
		);
	});
});
