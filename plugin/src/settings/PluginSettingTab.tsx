import { PluginSettingTab as ObPluginSettingTab } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { Tab } from "src/component/tab/Tab";
import { ObsidianAppContext } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import FormPlugin from "src/main";
import { GeneralSettingTabItem } from "./GeneralSettingTabItem";
import { TarsSettingTabItem } from "./TarsSettingTabItem";
import { VariableManagementTabItem } from "./VariableManagementTabItem";
import { CommandIdManagementTabItem } from "./CommandIdManagementTabItem";

export class PluginSettingTab extends ObPluginSettingTab {
	plugin: FormPlugin;
	root: Root;

	constructor(plugin: FormPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		this.root = createRoot(containerEl);
		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<Tab
						items={[
							{
								id: "general_setting",
								title: localInstance.general_setting,
								content: (
									<GeneralSettingTabItem
										plugin={this.plugin}
									/>
								),
							},
							{
								id: "tars_setting",
								title: localInstance.tars_setting,
								content: <TarsSettingTabItem plugin={this.plugin} />,
							},
							{
								id: "variable_management",
								title: localInstance.variable_management,
								content: <VariableManagementTabItem plugin={this.plugin} />,
							},
							{
								id: "command_id_management",
								title: localInstance.command_id_management,
								content: <CommandIdManagementTabItem plugin={this.plugin} />,
							}
						]}
					></Tab>
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}

	hide() {
		this.root.unmount();
		this.containerEl.empty();
	}
}
