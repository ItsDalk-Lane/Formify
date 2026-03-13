import { DEFAULT_BUILTIN_TIME_TIMEZONE } from './mcp/types';
import {
	DEFAULT_TOOL_EXECUTION_SETTINGS,
	cloneTarsSettings,
	resolveToolExecutionSettings,
	syncToolExecutionSettings,
} from './settings';

describe('tool execution settings', () => {
	it('resolves shared settings from toolExecution and MCP fields', () => {
		const resolved = resolveToolExecutionSettings({
			mcp: {
				servers: [],
				maxToolCallLoops: 14,
			},
			toolExecution: {
				maxToolCalls: 9,
				timeoutMs: 42000,
			},
		} as any);

		expect(resolved).toEqual({
			maxToolCalls: 9,
			timeoutMs: 42000,
		});
	});

	it('syncs shared settings back into toolExecution and MCP fields while removing legacy agent config', () => {
		const settings = {
			mcp: {
				servers: [],
				maxToolCallLoops: 3,
			},
			toolExecution: {
				maxToolCalls: 7,
				timeoutMs: 9000,
			},
			toolAgent: {
				modelTag: 'legacy-tool',
			},
			intentAgent: {
				modelTag: 'legacy-intent',
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
		expect('toolAgent' in settings).toBe(false);
		expect('intentAgent' in settings).toBe(false);
	});

	it('drops legacy sub-agent fields when cloning settings', () => {
		const cloned = cloneTarsSettings({
			toolExecution: {
				maxToolCalls: 12,
				timeoutMs: 34000,
			},
			toolAgent: {
				modelTag: 'legacy-tool',
			},
			intentAgent: {
				modelTag: 'legacy-intent',
			},
		} as any);

		expect(cloned.toolExecution).toEqual({
			maxToolCalls: 12,
			timeoutMs: 34000,
		});
		expect('toolAgent' in (cloned as any)).toBe(false);
		expect('intentAgent' in (cloned as any)).toBe(false);
	});

	it('migrates legacy vault/search builtin flags into core tools settings', () => {
		const cloned = cloneTarsSettings({
			mcp: {
				servers: [],
				builtinVaultEnabled: false,
				builtinObsidianSearchEnabled: true,
			} as any,
		} as any);

		expect(cloned.mcp?.builtinCoreToolsEnabled).toBe(false);
		expect('builtinVaultEnabled' in ((cloned.mcp ?? {}) as any)).toBe(false);
		expect('builtinObsidianSearchEnabled' in ((cloned.mcp ?? {}) as any)).toBe(false);
	});

	it('normalizes builtin time default timezone and removes legacy toggle flag', () => {
		const cloned = cloneTarsSettings({
			mcp: {
				servers: [],
				builtinTimeDefaultTimezone: '  America/New_York  ',
				builtinTimeEnabled: false,
			} as any,
		} as any);

		expect(cloned.mcp?.builtinTimeDefaultTimezone).toBe('America/New_York');
		expect('builtinTimeEnabled' in ((cloned.mcp ?? {}) as any)).toBe(false);
	});

	it('falls back to the Beijing timezone when builtin time default timezone is invalid', () => {
		const cloned = cloneTarsSettings({
			mcp: {
				servers: [],
				builtinTimeDefaultTimezone: 'Invalid/Timezone',
			} as any,
		} as any);

		expect(cloned.mcp?.builtinTimeDefaultTimezone).toBe(
			DEFAULT_BUILTIN_TIME_TIMEZONE
		);
	});

	it('falls back to defaults when no values are configured', () => {
		expect(resolveToolExecutionSettings(undefined)).toEqual(
			DEFAULT_TOOL_EXECUTION_SETTINGS
		);
	});
});
