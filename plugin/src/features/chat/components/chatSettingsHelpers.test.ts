import {
	formatProviderOptionLabel,
	getBuiltinToolEntries,
	getMcpStatusColor,
	getMcpStatusText,
	getOpenModeAutoOpenDescription,
} from './chatSettingsHelpers';

describe('chatSettingsHelpers', () => {
	const locale = {
		chat_settings_auto_open_desc_sidebar: '右侧边栏',
		chat_settings_auto_open_desc_left_sidebar: '左侧边栏',
		chat_settings_auto_open_desc_tab: '标签页',
		chat_settings_auto_open_desc_window: '新窗口',
		chat_settings_auto_open_desc_persistent_modal: '持久化模态框',
		chat_settings_auto_open_desc_default: '默认',
		mcp_status_idle: '空闲',
		mcp_status_connecting: '连接中',
		mcp_status_running: '运行中',
		mcp_status_stopping: '停止中',
		mcp_status_stopped: '已停止',
		mcp_status_error: '错误',
	} as const;

	it('formats provider option labels as tag and vendor', () => {
		expect(
			formatProviderOptionLabel({
				tag: 'deepseek-chat',
				vendor: 'DeepSeek',
				options: {},
			} as any)
		).toBe('deepseek-chat · DeepSeek');
	});

	it('returns the correct auto-open description for each open mode', () => {
		expect(getOpenModeAutoOpenDescription('sidebar', locale)).toBe('右侧边栏');
		expect(getOpenModeAutoOpenDescription('left-sidebar', locale)).toBe('左侧边栏');
		expect(getOpenModeAutoOpenDescription('tab', locale)).toBe('标签页');
		expect(getOpenModeAutoOpenDescription('window', locale)).toBe('新窗口');
		expect(getOpenModeAutoOpenDescription('persistent-modal', locale)).toBe('持久化模态框');
	});

	it('maps MCP statuses to localized text and theme colors', () => {
		expect(getMcpStatusText('idle', locale)).toBe('空闲');
		expect(getMcpStatusText('running', locale)).toBe('运行中');
		expect(getMcpStatusText('error', locale)).toBe('错误');
		expect(getMcpStatusColor('idle')).toBe('var(--text-muted)');
		expect(getMcpStatusColor('connecting')).toBe('var(--interactive-accent)');
		expect(getMcpStatusColor('running')).toBe('var(--color-green)');
		expect(getMcpStatusColor('error')).toBe('var(--color-red)');
	});

	it('builds builtin tool entries from MCP settings flags', () => {
		const entries = getBuiltinToolEntries(
			{
				builtinCoreToolsEnabled: true,
				builtinFilesystemEnabled: true,
				builtinFetchEnabled: false,
				builtinTimeEnabled: true,
				builtinMemoryEnabled: false,
				builtinSequentialThinkingEnabled: true,
				servers: [],
				maxToolCallLoops: 10,
			} as any,
			'IN-MEMORY'
		);

		expect(entries).toHaveLength(6);
		expect(entries[0]).toMatchObject({
			enabled: true,
			transportLabel: 'IN-MEMORY',
		});
		expect(entries[1]).toMatchObject({
			enabled: true,
		});
		expect(entries[2]).toMatchObject({
			enabled: false,
		});
		expect(entries[3]).toMatchObject({
			enabled: true,
		});
		expect(entries[4]).toMatchObject({
			enabled: false,
		});
		expect(entries[5]).toMatchObject({
			enabled: true,
		});
	});
});
