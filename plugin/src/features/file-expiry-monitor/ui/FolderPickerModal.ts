import { App, Modal, Setting } from 'obsidian';
import FolderSuggest from 'src/component/combobox/FolderSuggest';
import { localInstance } from 'src/i18n/locals';
import { consumeFormifyTestResponse, recordFormifyTestEvent } from 'src/testing/FormifyTestHooks';

/**
 * 文件夹选择模态框
 * 使用 FolderSuggest 提供文件夹自动补全
 */
export class FolderPickerModal extends Modal {
	private selectedFolder = '';
	private readonly onChoose: (folder: string) => void;

	constructor(app: App, onChoose: (folder: string) => void) {
		super(app);
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('fem-folder-picker-modal');
		recordFormifyTestEvent('folder-picker-opened');

		const presetFolder = consumeFormifyTestResponse('folderPicker');
		if (typeof presetFolder === 'string' && presetFolder.trim().length > 0) {
			recordFormifyTestEvent('folder-picker-auto-selected', {
				folder: presetFolder,
			});
			this.onChoose(presetFolder.trim());
			this.close();
			return;
		}

		new Setting(contentEl)
			.setName(localInstance.choose_folder)
			.addText((cb) => {
				cb.setPlaceholder('folder/subfolder');
				cb.onChange((v) => {
					this.selectedFolder = v;
				});

				const suggest = new FolderSuggest(this.app, cb.inputEl);
				suggest.onSelect((folder) => {
					cb.setValue(folder.path);
					this.selectedFolder = folder.path;
					suggest.close();
				});

				// 自动聚焦
				setTimeout(() => cb.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText(localInstance.cancel)
					.onClick(() => this.close());
			})
			.addButton((btn) => {
				btn
					.setCta()
					.setButtonText(localInstance.save)
					.onClick(() => {
						if (this.selectedFolder.trim()) {
							this.onChoose(this.selectedFolder.trim());
							this.close();
						}
					});
			});
	}

	onClose(): void {
		recordFormifyTestEvent('folder-picker-closed');
		this.contentEl.empty();
	}
}
