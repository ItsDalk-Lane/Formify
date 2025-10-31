import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './settings/PluginSettings';
import { formScriptService } from './service/extend/FormScriptService';
import { formIntegrationService } from './service/command/FormIntegrationService';
import { applicationCommandService } from './service/command/ApplicationCommandService';
import { applicationFileViewService } from './service/file-view/ApplicationFileViewService';
import { PluginSettingTab } from './settings/PluginSettingTab';
import './style/base.css'
import { FormFlowApi } from './api/FormFlowApi';
import { TarsFeatureManager, cloneTarsSettings } from './features/tars';

export default class FormPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	private tarsFeatureManager: TarsFeatureManager | null = null;

	api: FormFlowApi = new FormFlowApi(this.app);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new PluginSettingTab(this));
		await applicationCommandService.initialize(this);
		await applicationFileViewService.initialize(this);
		await formIntegrationService.initialize(this);
		this.refreshTarsFeature();
		this.app.workspace.onLayoutReady(async () => {
			formIntegrationService.clearStale();
			formScriptService.initialize(this.app, this.settings.scriptFolder);
		});
	}

	onunload() {
		formScriptService.unload();
		applicationCommandService.unload(this);
		applicationFileViewService.unload(this);
		this.tarsFeatureManager?.dispose();
		this.tarsFeatureManager = null;
	}

	async loadSettings() {
		const persisted = (await this.loadData()) ?? {};
		const defaultSettings = { ...DEFAULT_SETTINGS };
		this.settings = {
			...defaultSettings,
			...persisted,
			formIntegrations: persisted.formIntegrations ?? defaultSettings.formIntegrations,
			tars: {
				enabled: persisted?.tars?.enabled ?? defaultSettings.tars.enabled,
				settings: cloneTarsSettings(persisted?.tars?.settings),
			}
		};
	}

	async replaceSettings(value: Partial<PluginSettings>) {
		const { tars, ...rest } = value;
		this.settings = Object.assign({}, this.settings, rest);
		if (tars) {
			this.settings.tars = {
				enabled: tars.enabled ?? this.settings.tars.enabled,
				settings: cloneTarsSettings({ ...this.settings.tars.settings, ...tars.settings })
			};
		}
		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		formScriptService.refresh(this.settings.scriptFolder)
		formIntegrationService.initialize(this);
		this.refreshTarsFeature();
	}

	private refreshTarsFeature() {
		const { tars } = this.settings;
		if (!tars?.enabled) {
			if (this.tarsFeatureManager) {
				this.tarsFeatureManager.dispose();
				this.tarsFeatureManager = null;
			}
			return;
		}

		if (!this.tarsFeatureManager) {
			this.tarsFeatureManager = new TarsFeatureManager(
				this,
				tars.settings,
				async () => {
					await this.saveSettings();
				}
			);
			this.tarsFeatureManager.initialize();
			return;
		}

		this.tarsFeatureManager.updateSettings(tars.settings);
	}
}
