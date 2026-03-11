import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import { localInstance } from 'src/i18n/locals';
import { t } from '../lang/helper';
import type { McpServerConfig, McpToolInfo } from './types';

export class McpServerEditModal extends Modal {
	private server: McpServerConfig;
	private readonly isNew: boolean;

	constructor(
		app: App,
		existingServer: McpServerConfig | null,
		private readonly onSave: (server: McpServerConfig) => Promise<void>,
	) {
		super(app);
		this.isNew = !existingServer;

		if (existingServer) {
			this.server = {
				...existingServer,
				transportType:
					existingServer.transportType === 'sse'
						? 'stdio'
						: existingServer.transportType,
			};
		} else {
			this.server = {
				id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
				name: '',
				enabled: true,
				transportType: 'stdio',
				timeout: 30000,
			};
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', {
			text: this.isNew
				? localInstance.mcp_settings_add_server
				: localInstance.mcp_edit_server,
		});

		new Setting(contentEl)
			.setName(t('MCP server name'))
			.setDesc(t('MCP server name desc'))
			.addText((text) =>
				text
					.setPlaceholder('filesystem')
					.setValue(this.server.name)
					.onChange((value) => {
						this.server = { ...this.server, name: value };
					})
			);

		new Setting(contentEl)
			.setName(t('MCP transport type'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('stdio', t('MCP transport stdio'))
					.addOption('websocket', t('MCP transport websocket'))
					.addOption('http', t('MCP transport http'))
					.addOption('remote-sse', t('MCP transport remote sse'))
					.setValue(this.server.transportType)
					.onChange((value) => {
						this.server = {
							...this.server,
							transportType: value as McpServerConfig['transportType'],
						};
						this.renderTransportFields(contentEl);
					})
			);

		const transportFieldsContainer = contentEl.createDiv({
			cls: 'mcp-transport-fields',
		});
		this.renderTransportFieldsInto(transportFieldsContainer);

		new Setting(contentEl)
			.setName(t('MCP timeout'))
			.setDesc(t('MCP timeout desc'))
			.addText((text) =>
				text
					.setPlaceholder('30000')
					.setValue(String(this.server.timeout))
					.onChange((value) => {
						const nextValue = Number.parseInt(value, 10);
						if (!Number.isNaN(nextValue) && nextValue > 0) {
							this.server = { ...this.server, timeout: nextValue };
						}
					})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(localInstance.save)
					.setCta()
					.onClick(async () => {
						if (!this.server.name.trim()) {
							new Notice(t('MCP server name required'));
							return;
						}
						if (
							this.isLocalProcessTransport(this.server.transportType)
							&& !this.server.command?.trim()
						) {
							new Notice(t('MCP command required'));
							return;
						}
						if (
							this.isRemoteUrlTransport(this.server.transportType)
							&& !this.server.url?.trim()
						) {
							new Notice(t('MCP url required'));
							return;
						}
						await this.onSave(this.server);
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(localInstance.cancel)
					.onClick(() => this.close())
			);
	}

	private renderTransportFields(contentEl: HTMLElement): void {
		const container = contentEl.querySelector('.mcp-transport-fields') as HTMLElement | null;
		if (!container) {
			return;
		}
		container.empty();
		this.renderTransportFieldsInto(container);
	}

	private renderTransportFieldsInto(container: HTMLElement): void {
		if (this.isLocalProcessTransport(this.server.transportType)) {
			new Setting(container)
				.setName(t('MCP command'))
				.setDesc(t('MCP command desc'))
				.addText((text) =>
					text
						.setPlaceholder('npx')
						.setValue(this.server.command ?? '')
						.onChange((value) => {
							this.server = { ...this.server, command: value };
						})
				);

			new Setting(container)
				.setName(t('MCP args'))
				.setDesc(t('MCP args desc'))
				.addText((text) =>
					text
						.setPlaceholder('-y,@modelcontextprotocol/server-filesystem,/path')
						.setValue((this.server.args ?? []).join(','))
						.onChange((value) => {
							this.server = {
								...this.server,
								args: value
									? value.split(',').map((item) => item.trim())
									: [],
							};
						})
				);

			new Setting(container)
				.setName(t('MCP env'))
				.setDesc(t('MCP env desc'))
				.addTextArea((text) => {
					text
						.setPlaceholder('NODE_ENV=production\nDEBUG=true')
						.setValue(
							Object.entries(this.server.env ?? {})
								.map(([key, value]) => `${key}=${value}`)
								.join('\n')
						)
						.onChange((value) => {
							const env: Record<string, string> = {};
							for (const line of value.split('\n')) {
								const separatorIndex = line.indexOf('=');
								if (separatorIndex <= 0) {
									continue;
								}
								env[line.slice(0, separatorIndex).trim()] = line
									.slice(separatorIndex + 1)
									.trim();
							}
							this.server = { ...this.server, env };
						});
					text.inputEl.rows = 3;
				});

			new Setting(container)
				.setName(t('MCP cwd'))
				.setDesc(t('MCP cwd desc'))
				.addText((text) =>
					text
						.setPlaceholder(t('MCP cwd desc'))
						.setValue(this.server.cwd ?? '')
						.onChange((value) => {
							this.server = {
								...this.server,
								cwd: value || undefined,
							};
						})
				);
			return;
		}

		if (this.server.transportType === 'websocket') {
			new Setting(container)
				.setName(t('MCP websocket url'))
				.addText((text) =>
					text
						.setPlaceholder('ws://localhost:8080')
						.setValue(this.server.url ?? '')
						.onChange((value) => {
							this.server = { ...this.server, url: value };
						})
				);
			return;
		}

		new Setting(container)
			.setName(t('MCP url'))
			.setDesc(t('MCP url desc'))
			.addText((text) =>
				text
					.setPlaceholder('https://example.com/mcp')
					.setValue(this.server.url ?? '')
					.onChange((value) => {
						this.server = { ...this.server, url: value };
					})
			);

		this.renderHeadersEditor(container);
	}

	private renderHeadersEditor(container: HTMLElement): void {
		const headerRows = Object.entries(this.server.headers ?? {}).map(([key, value]) => ({
			key,
			value,
		}));

		const updateHeaders = () => {
			const headers: Record<string, string> = {};
			for (const row of headerRows) {
				const key = row.key.trim();
				if (!key) {
					continue;
				}
				headers[key] = row.value;
			}
			this.server = {
				...this.server,
				headers: Object.keys(headers).length > 0 ? headers : undefined,
			};
		};

		const rowsContainer = container.createDiv({ cls: 'mcp-header-rows' });
		rowsContainer.style.cssText =
			'display: flex; flex-direction: column; gap: 8px; margin-top: 8px;';

		const renderRows = () => {
			rowsContainer.empty();
			for (let index = 0; index < headerRows.length; index += 1) {
				const row = headerRows[index];
				const rowEl = rowsContainer.createDiv({ cls: 'mcp-header-row' });
				rowEl.style.cssText = 'display: flex; gap: 8px; align-items: center;';

				const keyInput = new TextComponent(rowEl);
				keyInput
					.setPlaceholder(t('MCP header key placeholder'))
					.setValue(row.key)
					.onChange((value) => {
						row.key = value;
						updateHeaders();
					});
				keyInput.inputEl.style.flex = '1';

				const valueInput = new TextComponent(rowEl);
				valueInput
					.setPlaceholder(t('MCP header value placeholder'))
					.setValue(row.value)
					.onChange((value) => {
						row.value = value;
						updateHeaders();
					});
				valueInput.inputEl.style.flex = '1';

				const removeBtn = rowEl.createEl('button', {
					text: t('MCP remove header'),
					cls: 'mod-muted',
				});
				removeBtn.addEventListener('click', () => {
					headerRows.splice(index, 1);
					updateHeaders();
					renderRows();
				});
			}
		};

		new Setting(container)
			.setName(t('MCP headers'))
			.setDesc(t('MCP headers desc'))
			.addButton((btn) =>
				btn.setButtonText(t('MCP add header')).onClick(() => {
					headerRows.push({ key: '', value: '' });
					renderRows();
				})
			);

		renderRows();
		updateHeaders();
	}

	private isLocalProcessTransport(type: McpServerConfig['transportType']): boolean {
		return type === 'stdio' || type === 'sse';
	}

	private isRemoteUrlTransport(type: McpServerConfig['transportType']): boolean {
		return type === 'websocket' || type === 'http' || type === 'remote-sse';
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface McpImportModalOptions {
	title: string;
	description: string;
	label: string;
	placeholder: string;
	confirmText: string;
}

export class McpImportModal extends Modal {
	constructor(
		app: App,
		private readonly options: McpImportModalOptions,
		private readonly onImport: (jsonContent: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: this.options.title });
		contentEl.createEl('p', {
			text: this.options.description,
			cls: 'setting-item-description',
		});

		let jsonValue = '';
		const jsonLabel = contentEl.createDiv({ text: this.options.label });
		jsonLabel.style.cssText = 'font-weight: 600; margin: 10px 0 8px 0;';

		const textarea = contentEl.createEl('textarea');
		textarea.placeholder = this.options.placeholder;
		textarea.rows = 13;
		textarea.style.cssText = 'width: 100%; font-family: monospace;';
		textarea.addEventListener('input', () => {
			jsonValue = textarea.value;
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(this.options.confirmText)
					.setCta()
					.onClick(async () => {
						if (!jsonValue.trim()) {
							new Notice(localInstance.mcp_json_required);
							return;
						}
						await this.onImport(jsonValue);
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(localInstance.cancel)
					.onClick(() => this.close())
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class BuiltinMcpToolsModal extends Modal {
	constructor(
		app: App,
		private readonly serverName: string,
		private readonly tools: McpToolInfo[],
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', {
			text: localInstance.mcp_builtin_tools_title.replace('{name}', this.serverName),
		});
		contentEl.createEl('p', {
			text: localInstance.mcp_builtin_tools_desc,
			cls: 'setting-item-description',
		});

		if (this.tools.length === 0) {
			const empty = contentEl.createDiv({
				text: localInstance.mcp_builtin_tools_empty,
				cls: 'setting-item-description',
			});
			empty.style.cssText = 'padding: 8px 0 12px;';
		} else {
			const list = contentEl.createDiv();
			list.style.cssText =
				'display: flex; flex-direction: column; gap: 8px; margin: 8px 0 12px;';
			for (const tool of this.tools) {
				const item = list.createDiv();
				item.style.cssText =
					'padding: 8px 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px;';
				item.createEl('div', { text: tool.name }).style.cssText =
					'font-weight: 600;';
				item.createEl('div', {
					text: tool.description || localInstance.mcp_builtin_tool_no_description,
					cls: 'setting-item-description',
				});
			}
		}

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(localInstance.close)
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
