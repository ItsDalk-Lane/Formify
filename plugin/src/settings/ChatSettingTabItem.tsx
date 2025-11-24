import { Setting } from "obsidian";
import { useEffect, useRef } from "react";
import FolderSuggest from "src/component/combobox/FolderSuggest";
import FormPlugin from "src/main";
import type { ChatSettings } from "src/features/chat";

export const ChatSettingTabItem = ({ plugin }: { plugin: FormPlugin }) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty();

		const updateSettings = async (partial: Partial<ChatSettings>) => {
			plugin.settings.chat = {
				...plugin.settings.chat,
				...partial,
			};
			await plugin.saveSettings();
		};

		new Setting(el)
			.setName("聊天历史保存目录")
			.setDesc("AI聊天记录将以Markdown格式保存在此目录中")
			.addText((text) => {
				text.setValue(plugin.settings.chat.chatFolder);
				text.setPlaceholder("AI Chats");
				text.onChange(async (value) => {
					await updateSettings({ chatFolder: value });
				});
				const suggest = new FolderSuggest(plugin.app, text.inputEl);
				suggest.onSelect(async (folder) => {
					text.setValue(folder.path);
					await updateSettings({ chatFolder: folder.path });
				});
			});

		new Setting(el)
			.setName("默认AI模型")
			.setDesc("为新建聊天会话预设的模型")
			.addDropdown((dropdown) => {
				const providers = plugin.settings.tars.settings.providers;
				const defaultValue =
					plugin.settings.chat.defaultModel ||
					providers[0]?.tag ||
					"";
				if (!providers.length) {
					dropdown.addOption("", "尚未配置模型");
					dropdown.setDisabled(true);
				} else {
					providers.forEach((provider) => {
						dropdown.addOption(
							provider.tag,
							`${provider.tag} · ${provider.options.model}`
						);
					});
					dropdown.setValue(defaultValue);
				}
				dropdown.onChange(async (value) => {
					await updateSettings({ defaultModel: value });
				});
			});

		new Setting(el)
			.setName("自动保存聊天记录")
			.setDesc("在每次AI回复完成后自动将会话写入历史文件")
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.chat.autosaveChat);
				toggle.onChange(async (value) => {
					await updateSettings({ autosaveChat: value });
				});
			});

		// 动态获取打开方式的描述
		const getOpenModeDescription = (mode: string) => {
			switch (mode) {
				case 'sidebar':
					return '插件加载后自动在右侧边栏显示AI聊天界面';
				case 'tab':
					return '插件加载后自动在编辑区标签页显示AI聊天界面';
				case 'window':
					return '插件加载后自动在新窗口显示AI聊天界面';
				default:
					return '插件加载后自动显示AI聊天界面';
			}
		};

		// 创建打开方式设置项
		const openModeSetting = new Setting(el)
			.setName("AI Chat 打开方式")
			.setDesc("选择AI Chat界面的默认打开位置")
			.addDropdown((dropdown) => {
				dropdown.addOption('sidebar', '右侧边栏');
				dropdown.addOption('tab', '编辑区标签页');
				dropdown.addOption('window', '新窗口');
				dropdown.setValue(plugin.settings.chat.openMode);
				dropdown.onChange(async (value) => {
					await updateSettings({ openMode: value as 'sidebar' | 'tab' | 'window' });
					// 更新自动打开设置的描述文本
					autoOpenSetting.setDesc(getOpenModeDescription(value));
				});
			});

		// 创建自动打开设置项，使用动态描述
		const autoOpenSetting = new Setting(el)
			.setName("自动打开AI Chat界面")
			.setDesc(getOpenModeDescription(plugin.settings.chat.openMode))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.chat.showSidebarByDefault);
				toggle.onChange(async (value) => {
					await updateSettings({ showSidebarByDefault: value });
				});
			});

		return () => {
			el.empty();
		};
	}, [plugin]);

	return <div ref={containerRef}></div>;
};

