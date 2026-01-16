import { Setting } from "obsidian";
import { useEffect, useRef, useState } from "react";
import { localInstance } from "src/i18n/locals";
import FolderSuggest from "src/component/combobox/FolderSuggest";
import FormPlugin from "src/main";
import { DEFAULT_SETTINGS } from "./PluginSettings";
import "./GeneralSettingTabItem.css";

export function GeneralSettingTabItem(props: { plugin: FormPlugin }) {
	const { plugin } = props;
	const settings = {
		...DEFAULT_SETTINGS,
		...plugin.settings,
	};
	const app = plugin.app;
	const formRef = useRef<HTMLDivElement>(null);

	const [settingsValue, setSettingsValue] = useState(settings);
	useEffect(() => {
		plugin.replaceSettings(settingsValue);
	}, [settingsValue]);

	useEffect(() => {
		if (!formRef.current) {
			return;
		}
		const el = formRef.current;
		el.empty();

		new Setting(el).setName("V" + plugin.manifest.version).setDesc("");

		// component form file folder setting
		new Setting(el)
			.setName(localInstance.default_location_for_form_file)
			.setDesc(localInstance.default_location_for_form_file_desc)
			.addText((cb) => {
				cb.setValue(settingsValue.formFolder);
				cb.setPlaceholder(
					localInstance.default_location_for_form_placeholder
				);
				cb.onChange((v) => {
					setSettingsValue((prev) => {
						return {
							...prev,
							formFolder: v,
						};
					});
				});

				const suggest = new FolderSuggest(app, cb.inputEl);
				suggest.onSelect((folder) => {
					cb.setValue(folder.path);
					setSettingsValue((prev) => {
						return {
							...prev,
							formFolder: folder.path,
						};
					});
					suggest.close();
				});
			});

		// script folder setting
		new Setting(el)
			.setName(localInstance.script_folder_for_form)
			.setDesc(localInstance.script_folder_for_form_desc)
			.addText((cb) => {
				cb.setValue(settingsValue.scriptFolder);
				cb.setPlaceholder(
					localInstance.script_folder_for_form_placeholder
				);
				cb.onChange((v) => {
					setSettingsValue((prev) => {
						return {
							...prev,
							scriptFolder: v,
						};
					});
				});
				const suggest = new FolderSuggest(app, cb.inputEl);
				suggest.onSelect((folder) => {
					cb.setValue(folder.path);
					setSettingsValue((prev) => {
						return {
							...prev,
							scriptFolder: folder.path,
						};
					});
					suggest.close();
				});
			});

		// prompt template folder setting
		new Setting(el)
			.setName(localInstance.prompt_template_folder)
			.setDesc(localInstance.prompt_template_folder_desc)
			.addText((cb) => {
				cb.setValue(settingsValue.promptTemplateFolder);
				cb.setPlaceholder(
					localInstance.prompt_template_folder_placeholder
				);
				cb.onChange((v) => {
					setSettingsValue((prev) => {
						return {
							...prev,
							promptTemplateFolder: v,
						};
					});
				});
				const suggest = new FolderSuggest(app, cb.inputEl);
				suggest.onSelect((folder) => {
					cb.setValue(folder.path);
					setSettingsValue((prev) => {
						return {
							...prev,
							promptTemplateFolder: folder.path,
						};
					});
					suggest.close();
				});
			});

		return () => {
			el.empty();
		};
	}, [plugin.manifest.version]);

	return (
		<div>
			<div ref={formRef}></div>
		</div>
	);
}
