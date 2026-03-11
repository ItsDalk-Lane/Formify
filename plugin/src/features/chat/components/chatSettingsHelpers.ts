import type { Local } from 'src/i18n/local';
import type { ProviderSettings } from 'src/features/tars/providers';
import type { McpServerStatus } from 'src/features/tars/mcp/types';
import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
	type McpSettings,
} from 'src/features/tars/mcp';
import type { ChatOpenMode } from '../types/chat';

type OpenModeLocale = Pick<
	Local,
	| 'chat_settings_auto_open_desc_sidebar'
	| 'chat_settings_auto_open_desc_left_sidebar'
	| 'chat_settings_auto_open_desc_tab'
	| 'chat_settings_auto_open_desc_window'
	| 'chat_settings_auto_open_desc_persistent_modal'
	| 'chat_settings_auto_open_desc_default'
>;

type McpStatusLocale = Pick<
	Local,
	| 'mcp_status_idle'
	| 'mcp_status_connecting'
	| 'mcp_status_running'
	| 'mcp_status_stopping'
	| 'mcp_status_stopped'
	| 'mcp_status_error'
>;

type SubAgentStatusLocale = Pick<
	Local,
	| 'sub_agents_status_enabled'
	| 'sub_agents_status_disabled'
>;

export interface BuiltinToolEntry {
	serverId: string;
	name: string;
	enabled: boolean;
	transportLabel: string;
}

export const formatProviderOptionLabel = (provider: ProviderSettings): string =>
	`${provider.tag} · ${provider.vendor}`;

export const getOpenModeAutoOpenDescription = (
	mode: ChatOpenMode,
	local: OpenModeLocale
): string => {
	switch (mode) {
		case 'sidebar':
			return local.chat_settings_auto_open_desc_sidebar;
		case 'left-sidebar':
			return local.chat_settings_auto_open_desc_left_sidebar;
		case 'tab':
			return local.chat_settings_auto_open_desc_tab;
		case 'window':
			return local.chat_settings_auto_open_desc_window;
		case 'persistent-modal':
			return local.chat_settings_auto_open_desc_persistent_modal;
		default:
			return local.chat_settings_auto_open_desc_default;
	}
};

export const getMcpStatusText = (
	status: McpServerStatus,
	local: McpStatusLocale
): string => {
	switch (status) {
		case 'idle':
			return local.mcp_status_idle;
		case 'connecting':
			return local.mcp_status_connecting;
		case 'running':
			return local.mcp_status_running;
		case 'stopping':
			return local.mcp_status_stopping;
		case 'stopped':
			return local.mcp_status_stopped;
		case 'error':
			return local.mcp_status_error;
		default:
			return status;
	}
};

export const getMcpStatusColor = (status: McpServerStatus): string => {
	switch (status) {
		case 'idle':
			return 'var(--text-muted)';
		case 'connecting':
			return 'var(--interactive-accent)';
		case 'running':
			return 'var(--color-green)';
		case 'stopping':
			return 'var(--interactive-accent)';
		case 'stopped':
			return 'var(--text-muted)';
		case 'error':
			return 'var(--color-red)';
		default:
			return 'var(--text-muted)';
	}
};

export const getBuiltinToolEntries = (
	mcpSettings: McpSettings,
	transportLabel: string
): BuiltinToolEntry[] => [
	{
		serverId: BUILTIN_VAULT_SERVER_ID,
		name: BUILTIN_VAULT_SERVER_NAME,
		enabled: mcpSettings.builtinVaultEnabled !== false,
		transportLabel,
	},
	{
		serverId: BUILTIN_MEMORY_SERVER_ID,
		name: BUILTIN_MEMORY_SERVER_NAME,
		enabled: mcpSettings.builtinMemoryEnabled !== false,
		transportLabel,
	},
	{
		serverId: BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
		name: BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
		enabled: mcpSettings.builtinObsidianSearchEnabled !== false,
		transportLabel,
	},
	{
		serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
		name: BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
		enabled: mcpSettings.builtinSequentialThinkingEnabled !== false,
		transportLabel,
	},
];

export const getSubAgentStatusText = (
	enabled: boolean,
	local: SubAgentStatusLocale
): string => (enabled ? local.sub_agents_status_enabled : local.sub_agents_status_disabled);
