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
			getEnabled: () => plugin.settings.tars.enabled,
			setEnabled: async (value: boolean) => {
				plugin.settings.tars.enabled = value;
				await plugin.saveSettings();
			},
			saveSettings: async () => {
				await plugin.saveSettings();
			},
		});

		panel.render(containerRef.current);

		return () => {
			containerRef.current?.replaceChildren();
		};
	}, [plugin]);

	return <div ref={containerRef} />;
};
