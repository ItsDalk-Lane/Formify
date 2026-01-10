import { App, Modal, Notice } from 'obsidian';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pencil, Trash2, Upload } from 'lucide-react';
import { ObsidianAppContext } from 'src/context/obsidianAppContext';
import { localInstance } from 'src/i18n/locals';
import { ConfirmPopover } from 'src/component/confirm/ConfirmPopover';
import { InteractiveList, InteractiveListItem } from 'src/component/interactive-list/InteractiveList';
import { SystemPromptDataService } from './SystemPromptDataService';
import type { AiFeatureId, SystemPromptItem } from './types';
import { SystemPromptEditorModal } from './SystemPromptEditorModal';
import './SystemPromptModals.css';

export class SystemPromptManagerModal extends Modal {
	private root: Root | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('system-prompt-modal-content');
		this.modalEl.addClass('system-prompt-modal');

		titleEl.textContent = localInstance.system_prompt_manager_title || '系统提示词管理';

		this.root = createRoot(contentEl);
		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<SystemPromptManagerApp app={this.app} onRequestClose={() => this.close()} />
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

function SystemPromptManagerApp(props: { app: App; onRequestClose: () => void }) {
	const [items, setItems] = useState<SystemPromptItem[]>([]);
	const [loading, setLoading] = useState(true);
	const service = useMemo(() => SystemPromptDataService.getInstance(props.app), [props.app]);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const prompts = await service.getSortedPrompts();
			setItems(prompts);
		} finally {
			setLoading(false);
		}
	}, [service]);

	useEffect(() => {
		reload();
	}, [reload]);

	const openCreate = useCallback(() => {
		new SystemPromptEditorModal(props.app, {
			mode: 'create',
			existingPrompts: items,
			onSubmit: async (prompt) => {
				await service.upsertPrompt(prompt);
				await reload();
			}
		}).open();
	}, [props.app, items, service, reload]);

	const openEdit = useCallback((prompt: SystemPromptItem) => {
		new SystemPromptEditorModal(props.app, {
			mode: 'edit',
			prompt,
			existingPrompts: items,
			onSubmit: async (updated) => {
				await service.upsertPrompt(updated);
				await reload();
			}
		}).open();
	}, [props.app, items, service, reload]);

	const handleReorder = useCallback(async (next: SystemPromptItem[]) => {
		setItems(next);
		await service.reorderPrompts(next.map((p) => p.id));
		await reload();
	}, [service, reload]);

	const handleToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
		await service.setPromptEnabled(id, enabled);
		await reload();
	}, [service, reload]);

	const handleDelete = useCallback(async (id: string) => {
		await service.deletePrompt(id);
		new Notice(localInstance.system_prompt_deleted || '已删除');
		await reload();
	}, [service, reload]);

	const exportMarkdown = useCallback(async () => {
		try {
			const prompts = await service.getSortedPrompts();
			const md = await buildExportMarkdown(props.app, prompts);

			const { dialog } = require('@electron/remote');
			const result = await dialog.showSaveDialog({
				title: localInstance.system_prompt_export_dialog_title || '导出系统提示词',
				defaultPath: 'system-prompts.md',
				filters: [{ name: 'Markdown', extensions: ['md'] }]
			});

			if (result.canceled || !result.filePath) {
				new Notice(localInstance.system_prompt_export_canceled || '已取消导出');
				return;
			}

			const fs = require('fs/promises');
			await fs.writeFile(result.filePath, md, 'utf8');
			new Notice((localInstance.system_prompt_export_success || '导出成功') + `: ${result.filePath}`);
		} catch (error: any) {
			new Notice((localInstance.system_prompt_export_failed || '导出失败') + `: ${error?.message || String(error)}`);
		}
	}, [service, props.app]);

	return (
		<div className="system-prompt-manager">
			<div className="system-prompt-manager-toolbar">
				<button className="mod-cta" onClick={openCreate}>
					{localInstance.system_prompt_new_button || '新建系统提示词'}
				</button>
				<button className="mod-cta" onClick={exportMarkdown}>
					<Upload size={16} style={{ marginRight: 6 }} />
					{localInstance.system_prompt_export_button || '导出系统提示词'}
				</button>
			</div>

			<div className="system-prompt-manager-body">
				{loading ? (
					<div className="system-prompt-empty">{localInstance.loading || '加载中...'}</div>
				) : items.length === 0 ? (
					<div className="system-prompt-empty">{localInstance.system_prompt_empty || '暂无系统提示词'}</div>
				) : (
					<InteractiveList
						className="system-prompt-list"
						items={items}
						onChange={handleReorder}
					>
						{(item) => (
							<InteractiveListItem key={item.id} item={item}>
								<div className="system-prompt-row">
									<div className="system-prompt-row-left">
										<div className="system-prompt-name">{item.name}</div>
										<div className="system-prompt-meta">
											{item.sourceType === 'template'
												? (localInstance.system_prompt_source_template || '引入模板')
												: (localInstance.system_prompt_source_custom || '自定义')}
										</div>
									</div>

									<div className="system-prompt-row-right">
										<div className="system-prompt-enabled-radio">
											<label>
												<input
													type="radio"
													name={`enabled_${item.id}`}
													checked={item.enabled === true}
													onChange={() => handleToggleEnabled(item.id, true)}
												/>
												<span>{localInstance.system_prompt_enabled || '启用'}</span>
											</label>
											<label>
												<input
													type="radio"
													name={`enabled_${item.id}`}
													checked={item.enabled === false}
													onChange={() => handleToggleEnabled(item.id, false)}
												/>
												<span>{localInstance.system_prompt_disabled || '禁用'}</span>
											</label>
										</div>

										<button
											className="system-prompt-icon-btn"
											onClick={() => openEdit(item)}
											title={localInstance.skill_edit || '编辑'}
										>
											<Pencil size={16} />
										</button>

										<ConfirmPopover
											title={localInstance.system_prompt_delete_confirm_title || '确认删除'}
											message={localInstance.system_prompt_delete_confirm_message || '删除后无法恢复，是否继续？'}
											onConfirm={() => handleDelete(item.id)}
										>
											<button
												className="system-prompt-icon-btn danger"
												title={localInstance.delete || '删除'}
												type="button"
											>
												<Trash2 size={16} />
											</button>
										</ConfirmPopover>
									</div>
								</div>
							</InteractiveListItem>
						)}
					</InteractiveList>
				)}
			</div>
		</div>
	);
}

async function buildExportMarkdown(app: App, prompts: SystemPromptItem[]): Promise<string> {
	const featureLabel = (id: AiFeatureId): string => {
		switch (id) {
			case 'ai_action':
				return localInstance.system_prompt_feature_ai_action || 'AI动作';
			case 'tars_chat':
				return localInstance.system_prompt_feature_tars_chat || 'Tars聊天';
			case 'tab_completion':
				return localInstance.system_prompt_feature_tab_completion || 'Tab补全';
			case 'selection_toolbar':
				return localInstance.system_prompt_feature_selection_toolbar || 'Selection Toolbar';
			default:
				return id;
		}
	};

	const lines: string[] = [];
	lines.push(`# ${localInstance.system_prompt_manager_title || '系统提示词管理'}\n`);

	for (const prompt of prompts) {
		lines.push(`## ${prompt.name}`);
		lines.push('');
		lines.push(`- ${localInstance.system_prompt_source_label || '来源'}：${prompt.sourceType === 'template'
			? (localInstance.system_prompt_source_template || '引入模板')
			: (localInstance.system_prompt_source_custom || '自定义')}`);
		lines.push(`- ${localInstance.system_prompt_status_label || '启用状态'}：${prompt.enabled
			? (localInstance.system_prompt_enabled || '启用')
			: (localInstance.system_prompt_disabled || '禁用')}`);
		lines.push(`- ${localInstance.system_prompt_exclude_label || '排除功能'}：${(prompt.excludeFeatures || []).length
			? (prompt.excludeFeatures || []).map(featureLabel).join(', ')
			: (localInstance.none || '无')}`);
		lines.push('');
		lines.push(`### ${localInstance.system_prompt_content_label || '内容'}`);
		lines.push('');

		if (prompt.sourceType === 'template') {
			const path = prompt.templatePath || '';
			lines.push(`- ${localInstance.system_prompt_template_label || '模板文件'}：${path || (localInstance.none || '无')}`);
			lines.push('');
			if (path) {
				try {
					const file = app.vault.getAbstractFileByPath(path);
					if (file) {
						const content = await app.vault.read(file as any);
						lines.push('```');
						lines.push(content);
						lines.push('```');
					} else {
						lines.push(localInstance.system_prompt_export_template_missing || '模板文件不存在');
					}
				} catch {
					lines.push(localInstance.system_prompt_export_template_read_failed || '读取模板文件失败');
				}
			}
		} else {
			lines.push('```');
			lines.push((prompt.content ?? '').trim());
			lines.push('```');
		}

		lines.push('');
	}

	return lines.join('\n');
}
