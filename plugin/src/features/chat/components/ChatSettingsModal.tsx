import { App, Modal, Notice } from 'obsidian';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { ObsidianAppContext } from 'src/context/obsidianAppContext';
import { Tab, type TabItem } from 'src/component/tab/Tab';
import { ToggleSwitch } from 'src/component/toggle-switch/ToggleSwitch';
import { localInstance } from 'src/i18n/locals';
import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_VAULT_SERVER_ID,
	DEFAULT_MCP_SETTINGS,
	McpConfigImporter,
	type McpServerConfig,
	type McpServerState,
	type McpSettings,
} from 'src/features/tars/mcp';
import {
	BuiltinMcpToolsModal,
	McpImportModal,
	McpServerEditModal,
} from 'src/features/tars/mcp/McpConfigModals';
import { SystemPromptManagerPanel } from 'src/features/tars/system-prompts/SystemPromptManagerModal';
import type { TarsSettings } from 'src/features/tars/settings';
import type { ChatOpenMode, ChatSettings } from '../types/chat';
import type { ChatService } from '../services/ChatService';
import {
	formatProviderOptionLabel,
	getBuiltinToolEntries,
	getMcpStatusColor,
	getMcpStatusText,
	getOpenModeAutoOpenDescription,
	type BuiltinToolEntry,
} from './chatSettingsHelpers';
import './ChatSettingsModal.css';

type ChatSettingsTabId =
	| 'ai-chat'
	| 'system-prompts'
	| 'mcp-servers'
	| 'tools';

interface ChatSettingsModalProps {
	app: App;
	service: ChatService;
}

interface ExternalMcpEntry {
	server: McpServerConfig;
}

const DEFAULT_CHAT_SETTINGS_TAB_ID: ChatSettingsTabId = 'ai-chat';

const cloneValue = <T,>(value: T): T =>
	JSON.parse(JSON.stringify(value)) as T;

const getOpenModeOptions = (): Array<{ value: ChatOpenMode; label: string }> => [
	{ value: 'sidebar', label: localInstance.chat_settings_open_mode_sidebar },
	{ value: 'left-sidebar', label: localInstance.chat_settings_open_mode_left_sidebar },
	{ value: 'tab', label: localInstance.chat_settings_open_mode_tab },
	{ value: 'window', label: localInstance.chat_settings_open_mode_window },
	{ value: 'persistent-modal', label: localInstance.chat_settings_open_mode_persistent_modal },
];

const updateBuiltinMcpEnabled = (
	mcpSettings: McpSettings,
	serverId: string,
	enabled: boolean
): McpSettings => {
	const nextMcpSettings = cloneValue(mcpSettings);
	switch (serverId) {
		case BUILTIN_VAULT_SERVER_ID:
			nextMcpSettings.builtinVaultEnabled = enabled;
			break;
		case BUILTIN_MEMORY_SERVER_ID:
			nextMcpSettings.builtinMemoryEnabled = enabled;
			break;
		case BUILTIN_OBSIDIAN_SEARCH_SERVER_ID:
			nextMcpSettings.builtinObsidianSearchEnabled = enabled;
			break;
		case BUILTIN_SEQUENTIAL_THINKING_SERVER_ID:
			nextMcpSettings.builtinSequentialThinkingEnabled = enabled;
			break;
		default:
			break;
	}
	return nextMcpSettings;
};

export class ChatSettingsModal extends Modal {
	private root: Root | null = null;

	constructor(
		app: App,
		private readonly service: ChatService,
		private readonly onRequestClose?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('chat-settings-modal-content');
		modalEl.addClass('chat-settings-modal');
		titleEl.textContent = localInstance.chat_settings_modal_title;

		this.root = createRoot(contentEl);
		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<ChatSettingsModalApp app={this.app} service={this.service} />
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
		this.onRequestClose?.();
	}
}

const ChatSettingsModalApp = ({ app, service }: ChatSettingsModalProps) => {
	const [chatSettings, setChatSettings] = useState<ChatSettings>(() =>
		service.getChatSettingsSnapshot()
	);
	const [tarsSettings, setTarsSettings] = useState<TarsSettings>(() =>
		service.getTarsSettingsSnapshot()
	);
	const [mcpStates, setMcpStates] = useState<McpServerState[]>(() =>
		service.getMcpClientManager()?.getAllStates() ?? []
	);

	const providers = tarsSettings.providers ?? service.getProviders();
	const providerOptions = useMemo(
		() =>
			providers.map((provider) => ({
				value: provider.tag,
				label: formatProviderOptionLabel(provider),
			})),
		[providers]
	);
	const mcpSettings = useMemo<McpSettings>(
		() => ({
			...DEFAULT_MCP_SETTINGS,
			...(tarsSettings.mcp ?? {}),
			servers: cloneValue(tarsSettings.mcp?.servers ?? []),
		}),
		[tarsSettings.mcp]
	);

	const reloadSnapshots = useCallback(() => {
		setChatSettings(service.getChatSettingsSnapshot());
		setTarsSettings(service.getTarsSettingsSnapshot());
		setMcpStates(service.getMcpClientManager()?.getAllStates() ?? []);
	}, [service]);

	useEffect(() => {
		reloadSnapshots();
	}, [reloadSnapshots]);

	useEffect(() => {
		const manager = service.getMcpClientManager();
		if (!manager) {
			setMcpStates([]);
			return undefined;
		}

		setMcpStates(manager.getAllStates());
		return manager.onStateChange((states) => {
			setMcpStates(states);
		});
	}, [service]);

	const persistChatSettings = useCallback(async (partial: Partial<ChatSettings>): Promise<boolean> => {
		const previousChatSettings = chatSettings;
		setChatSettings((current) => ({ ...current, ...partial }));

		try {
			await service.persistChatSettings(partial);
			reloadSnapshots();
			return true;
		} catch {
			setChatSettings(previousChatSettings);
			reloadSnapshots();
			return false;
		}
	}, [chatSettings, reloadSnapshots, service]);

	const persistGlobalSystemPrompts = useCallback(async (enabled: boolean): Promise<boolean> => {
		const previousTarsSettings = tarsSettings;
		setTarsSettings((current) => ({
			...current,
			enableGlobalSystemPrompts: enabled,
		}));

		try {
			await service.persistGlobalSystemPromptsEnabled(enabled);
			reloadSnapshots();
			return true;
		} catch {
			setTarsSettings(previousTarsSettings);
			reloadSnapshots();
			return false;
		}
	}, [reloadSnapshots, service, tarsSettings]);

	const persistMcpSettings = useCallback(async (nextMcpSettings: McpSettings): Promise<boolean> => {
		const previousTarsSettings = tarsSettings;
		setTarsSettings((current) => ({
			...current,
			mcp: cloneValue(nextMcpSettings),
		}));

		try {
			await service.persistMcpSettings(nextMcpSettings);
			reloadSnapshots();
			return true;
		} catch {
			setTarsSettings(previousTarsSettings);
			reloadSnapshots();
			return false;
		}
	}, [reloadSnapshots, service, tarsSettings]);

	const openBuiltinToolsModal = useCallback(async (entry: BuiltinToolEntry) => {
		const manager = service.getMcpClientManager();
		const tools = manager ? await manager.getToolsForServer(entry.serverId) : [];
		new BuiltinMcpToolsModal(app, entry.name, tools).open();
	}, [app, service]);

	const openMcpServerEditor = useCallback((existingServer: McpServerConfig | null) => {
		new McpServerEditModal(app, existingServer, async (serverConfig) => {
			const nextServers = existingServer
				? mcpSettings.servers.map((server) =>
					server.id === existingServer.id ? serverConfig : server
				)
				: [...mcpSettings.servers, serverConfig];

			const success = await persistMcpSettings({
				...mcpSettings,
				servers: nextServers,
			});
			if (!success) {
				throw new Error(localInstance.chat_settings_save_failed);
			}
		}).open();
	}, [app, mcpSettings, persistMcpSettings]);

	const openMcpJsonImportModal = useCallback((manual: boolean) => {
		new McpImportModal(
			app,
			manual
				? {
					title: localInstance.mcp_manual_config_title,
					description: localInstance.mcp_manual_config_desc,
					label: localInstance.mcp_manual_config_label,
					placeholder:
						'{\n  "mcpServers": {\n    "zread": {\n      "type": "streamable-http",\n      "url": "https://open.bigmodel.cn/api/mcp/zread/mcp",\n      "headers": {\n        "Authorization": "Bearer your_api_key"\n      }\n    }\n  }\n}',
					confirmText: localInstance.mcp_manual_config_confirm,
				}
				: {
					title: localInstance.mcp_import_title,
					description: localInstance.mcp_import_desc,
					label: localInstance.mcp_import_label,
					placeholder:
						'{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n    }\n  }\n}',
					confirmText: localInstance.mcp_import_confirm,
				},
			async (jsonContent) => {
				const result = McpConfigImporter.importFromJson(jsonContent, mcpSettings.servers);
				const success = await persistMcpSettings({
					...mcpSettings,
					servers: result.merged,
				});
				if (!success) {
					throw new Error(localInstance.chat_settings_save_failed);
				}
				new Notice(
					`${manual ? localInstance.mcp_manual_config_confirm : localInstance.mcp_import_confirm}: +${result.added.length} / ${result.skipped.length}`
				);
			}
		).open();
	}, [app, mcpSettings, persistMcpSettings]);

	const updateMcpConnectionState = useCallback(async (serverId: string, enabled: boolean) => {
		const manager = service.getMcpClientManager();
		if (!manager) {
			return;
		}

		try {
			if (enabled) {
				await manager.connectServer(serverId);
			} else {
				await manager.disconnectServer(serverId);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`${localInstance.mcp_server_toggle_failed}: ${message}`);
		}
	}, [service]);

	const handleToggleBuiltinToolServer = useCallback(async (entry: BuiltinToolEntry, enabled: boolean) => {
		const success = await persistMcpSettings(
			updateBuiltinMcpEnabled(mcpSettings, entry.serverId, enabled)
		);
		if (!success) {
			return;
		}
		await updateMcpConnectionState(entry.serverId, enabled);
	}, [mcpSettings, persistMcpSettings, updateMcpConnectionState]);

	const handleToggleExternalMcpServer = useCallback(async (entry: ExternalMcpEntry, enabled: boolean) => {
		const success = await persistMcpSettings({
			...mcpSettings,
			servers: mcpSettings.servers.map((server) =>
				server.id === entry.server.id
					? { ...server, enabled }
					: server
			),
		});
		if (!success) {
			return;
		}
		await updateMcpConnectionState(entry.server.id, enabled);
	}, [mcpSettings, persistMcpSettings, updateMcpConnectionState]);

	const handleDeleteExternalMcpServer = useCallback(async (serverId: string) => {
		void persistMcpSettings({
			...mcpSettings,
			servers: mcpSettings.servers.filter((server) => server.id !== serverId),
		});
	}, [mcpSettings, persistMcpSettings]);

	const builtinToolEntries = useMemo(
		() => getBuiltinToolEntries(mcpSettings, localInstance.mcp_settings_transport_in_memory),
		[mcpSettings]
	);
	const externalMcpEntries = useMemo<ExternalMcpEntry[]>(
		() => mcpSettings.servers.map((server) => ({ server })),
		[mcpSettings.servers]
	);
	const mcpStateMap = useMemo(
		() => new Map(mcpStates.map((state) => [state.serverId, state])),
		[mcpStates]
	);

	const aiChatTab = (
		<section className="chat-settings-panel">
			<div className="chat-settings-fields">
				<label className="chat-settings-field">
					<span className="chat-settings-field__title">
						{localInstance.chat_settings_default_model}
					</span>
					<span className="chat-settings-field__desc">
						{localInstance.chat_settings_default_model_desc}
					</span>
					<select
						className="chat-settings-input"
						value={chatSettings.defaultModel || providers[0]?.tag || ''}
						disabled={providers.length === 0}
						onChange={(event) => {
							void persistChatSettings({ defaultModel: event.target.value });
						}}
					>
						{providers.length === 0 ? (
							<option value="">
								{localInstance.chat_settings_no_models}
							</option>
						) : (
							providerOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))
						)}
					</select>
				</label>

				<div className="chat-settings-switch">
					<div>
						<div className="chat-settings-field__title">
							{localInstance.chat_settings_autosave}
						</div>
						<div className="chat-settings-field__desc">
							{localInstance.chat_settings_autosave_desc}
						</div>
					</div>
					<ToggleSwitch
						checked={chatSettings.autosaveChat}
						onChange={(checked) => {
							void persistChatSettings({ autosaveChat: checked });
						}}
						ariaLabel={localInstance.chat_settings_autosave}
					/>
				</div>

				<label className="chat-settings-field">
					<span className="chat-settings-field__title">
						{localInstance.chat_settings_open_mode}
					</span>
					<span className="chat-settings-field__desc">
						{localInstance.chat_settings_open_mode_desc}
					</span>
					<select
						className="chat-settings-input"
						value={chatSettings.openMode}
						onChange={(event) => {
							void persistChatSettings({
								openMode: event.target.value as ChatOpenMode,
							});
						}}
					>
						{getOpenModeOptions().map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<div className="chat-settings-switch">
					<div>
						<div className="chat-settings-field__title">
							{localInstance.chat_settings_auto_open}
						</div>
						<div className="chat-settings-field__desc">
							{getOpenModeAutoOpenDescription(chatSettings.openMode, localInstance)}
						</div>
					</div>
					<ToggleSwitch
						checked={chatSettings.showSidebarByDefault}
						onChange={(checked) => {
							void persistChatSettings({ showSidebarByDefault: checked });
						}}
						ariaLabel={localInstance.chat_settings_auto_open}
					/>
				</div>

				<div className="chat-settings-switch">
					<div>
						<div className="chat-settings-field__title">
							{localInstance.chat_settings_auto_add_active_file}
						</div>
						<div className="chat-settings-field__desc">
							{localInstance.chat_settings_auto_add_active_file_desc}
						</div>
					</div>
					<ToggleSwitch
						checked={chatSettings.autoAddActiveFile ?? true}
						onChange={(checked) => {
							void persistChatSettings({ autoAddActiveFile: checked });
						}}
						ariaLabel={localInstance.chat_settings_auto_add_active_file}
					/>
				</div>

				<div className="chat-settings-switch">
					<div>
						<div className="chat-settings-field__title">
							{localInstance.chat_settings_show_ribbon_icon}
						</div>
						<div className="chat-settings-field__desc">
							{localInstance.chat_settings_show_ribbon_icon_desc}
						</div>
					</div>
					<ToggleSwitch
						checked={chatSettings.showRibbonIcon ?? true}
						onChange={(checked) => {
							void persistChatSettings({ showRibbonIcon: checked });
						}}
						ariaLabel={localInstance.chat_settings_show_ribbon_icon}
					/>
				</div>

				<div className="chat-settings-grid">
					<label className="chat-settings-field">
						<span className="chat-settings-field__title">
							{localInstance.chat_modal_width}
						</span>
						<span className="chat-settings-field__desc">
							{localInstance.chat_modal_width_desc}
						</span>
						<input
							className="chat-settings-input"
							type="number"
							min={1}
							value={chatSettings.chatModalWidth ?? 700}
							onChange={(event) => {
								const nextValue = Number.parseInt(event.target.value, 10);
								if (Number.isFinite(nextValue) && nextValue > 0) {
									void persistChatSettings({ chatModalWidth: nextValue });
								}
							}}
						/>
					</label>

					<label className="chat-settings-field">
						<span className="chat-settings-field__title">
							{localInstance.chat_modal_height}
						</span>
						<span className="chat-settings-field__desc">
							{localInstance.chat_modal_height_desc}
						</span>
						<input
							className="chat-settings-input"
							type="number"
							min={1}
							value={chatSettings.chatModalHeight ?? 500}
							onChange={(event) => {
								const nextValue = Number.parseInt(event.target.value, 10);
								if (Number.isFinite(nextValue) && nextValue > 0) {
									void persistChatSettings({ chatModalHeight: nextValue });
								}
							}}
						/>
					</label>
				</div>
			</div>
		</section>
	);

	const systemPromptTab = (
		<section className="chat-settings-panel chat-settings-panel--system-prompts">
			<div className="chat-settings-switch chat-settings-switch--stacked">
				<div>
					<div className="chat-settings-field__title">
						{localInstance.enable_global_system_prompts}
					</div>
					<div className="chat-settings-field__desc">
						{localInstance.enable_global_system_prompts_desc}
					</div>
				</div>
				<ToggleSwitch
					checked={tarsSettings.enableGlobalSystemPrompts ?? false}
					onChange={(checked) => {
						void persistGlobalSystemPrompts(checked);
					}}
					ariaLabel={localInstance.enable_global_system_prompts}
				/>
			</div>
			<div className="chat-settings-panel__fill">
				<SystemPromptManagerPanel app={app} embedded />
			</div>
		</section>
	);

	const toolsTab = (
		<section className="chat-settings-panel">
			<div className="chat-settings-list">
				{builtinToolEntries.map((entry) => {
					const serverState = mcpStateMap.get(entry.serverId);
					const status = entry.enabled ? (serverState?.status ?? 'idle') : 'stopped';
					const descriptionParts = [
						`${entry.transportLabel} · ${getMcpStatusText(status, localInstance)}`,
					];
					if (serverState?.lastError && status === 'error') {
						descriptionParts.push(serverState.lastError);
					}

					return (
						<div key={entry.serverId} className="chat-settings-server-card">
							<div className="chat-settings-server-card__header">
								<div className="chat-settings-server-card__title-row">
									<span className="chat-settings-server-card__title">
										{entry.name}
									</span>
									<span
										className="chat-settings-server-card__status-dot"
										style={{ backgroundColor: getMcpStatusColor(status) }}
									/>
								</div>
								<div className="chat-settings-server-card__actions">
									<ToggleSwitch
										checked={entry.enabled}
										onChange={(checked) => {
											void handleToggleBuiltinToolServer(entry, checked);
										}}
										ariaLabel={entry.name}
									/>
									<button
										type="button"
										className="chat-settings-toolbar__button chat-settings-card-button"
										onClick={() => {
											void openBuiltinToolsModal(entry);
										}}
									>
										<Wrench size={16} />
										<span>{localInstance.mcp_view_tools}</span>
									</button>
								</div>
							</div>
							<div className="chat-settings-server-card__desc">
								{descriptionParts.join(' · ')}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);

	const mcpTab = (
		<section className="chat-settings-panel">
			<div className="chat-settings-toolbar">
				<button
					type="button"
					className="mod-cta"
					onClick={() => openMcpServerEditor(null)}
				>
					<Plus size={16} />
					<span>{localInstance.mcp_settings_add_server}</span>
				</button>
				<button
					type="button"
					className="chat-settings-toolbar__button"
					onClick={() => openMcpJsonImportModal(true)}
				>
					{localInstance.mcp_settings_manual_config}
				</button>
				<button
					type="button"
					className="chat-settings-toolbar__button"
					onClick={() => openMcpJsonImportModal(false)}
				>
					{localInstance.mcp_settings_import}
				</button>
			</div>

			<div className="chat-settings-list">
				{externalMcpEntries.map((entry) => {
					const serverState = mcpStateMap.get(entry.server.id);
					const status = entry.server.enabled
						? (serverState?.status ?? 'idle')
						: 'stopped';
					const descriptionParts = [
						`${entry.server.transportType.toUpperCase()} · ${getMcpStatusText(status, localInstance)}`,
					];
					if (serverState?.lastError && status === 'error') {
						descriptionParts.push(serverState.lastError);
					}

					return (
						<div key={entry.server.id} className="chat-settings-server-card">
							<div className="chat-settings-server-card__header">
								<div className="chat-settings-server-card__title-row">
									<span className="chat-settings-server-card__title">
										{entry.server.name || entry.server.id}
									</span>
									<span
										className="chat-settings-server-card__status-dot"
										style={{ backgroundColor: getMcpStatusColor(status) }}
									/>
								</div>
								<div className="chat-settings-server-card__actions">
									<ToggleSwitch
										checked={entry.server.enabled}
										onChange={(checked) => {
											void handleToggleExternalMcpServer(entry, checked);
										}}
										ariaLabel={entry.server.name || entry.server.id}
									/>
									<button
										type="button"
										className="chat-settings-icon-button"
										title={localInstance.mcp_edit_server}
										onClick={() => {
											openMcpServerEditor(entry.server);
										}}
									>
										<Pencil size={16} />
									</button>
									<button
										type="button"
										className="chat-settings-icon-button chat-settings-icon-button--danger"
										title={localInstance.mcp_delete_server}
										onClick={() => {
											void handleDeleteExternalMcpServer(entry.server.id);
										}}
									>
										<Trash2 size={16} />
									</button>
								</div>
							</div>
							<div className="chat-settings-server-card__desc">
								{descriptionParts.join(' · ')}
							</div>
						</div>
					);
				})}
			</div>

			{externalMcpEntries.length === 0 && (
				<div className="chat-settings-empty">
					{localInstance.mcp_settings_no_external_servers}
				</div>
			)}
		</section>
	);

	const tabItems = useMemo<TabItem[]>(
		() => [
			{ id: 'ai-chat', title: localInstance.tab_ai_chat, content: aiChatTab },
			{ id: 'system-prompts', title: localInstance.tab_system_prompts, content: systemPromptTab },
			{ id: 'mcp-servers', title: localInstance.tab_mcp_servers, content: mcpTab },
			{ id: 'tools', title: localInstance.tab_tools, content: toolsTab },
		],
		[aiChatTab, mcpTab, systemPromptTab, toolsTab]
	);

	return (
		<div className="chat-settings-modal-shell">
			<Tab
				items={tabItems}
				defaultValue={DEFAULT_CHAT_SETTINGS_TAB_ID}
				className="chat-settings-modal-tabs"
			/>
		</div>
	);
};
