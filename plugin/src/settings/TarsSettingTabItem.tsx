import { useEffect, useRef } from "react";
import type FormPlugin from "src/main";
import { TarsSettingTab } from "src/features/tars/settingTab";

interface Props {
	plugin: FormPlugin;
}

export const TarsSettingTabItem = ({ plugin }: Props) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		const panel = new TarsSettingTab(plugin.app, {
			getSettings: () => plugin.settings.tars.settings,
			getChatSettings: () => plugin.settings.chat,
			getPromptTemplateFolder: () => plugin.settings.promptTemplateFolder || 'System/ai prompts',
			saveSettings: async () => {
				await plugin.saveSettings();
			},
			updateChatSettings: async (partial) => {
				plugin.settings.chat = {
					...plugin.settings.chat,
					...partial,
				};
				await plugin.saveSettings();
			},
			refreshSkillsCache: async () => {
				// 通过插件实例访问 FeatureCoordinator 来刷新技能缓存
				await plugin.featureCoordinator.refreshSkillsCache();
			},
		});

		panel.render(containerRef.current);

		return () => {
			containerRef.current?.replaceChildren();
		};
	}, [plugin]);

	return <div ref={containerRef} />;
};
