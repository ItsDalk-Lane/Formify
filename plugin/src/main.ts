import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './settings/PluginSettings';
import { SettingsManager } from './settings/SettingsManager';
import { FeatureCoordinator } from './features/FeatureCoordinator';
import { ServiceContainer } from './service/ServiceContainer';
import { PluginSettingTab } from './settings/PluginSettingTab';
import './style/base.css'
import './style/chat.css'
import { FormFlowApi } from './api/FormFlowApi';
import { cloneTarsSettings } from './features/tars';
import { DebugLogger } from './utils/DebugLogger';
import { getStartupFormService } from './service/command/StartupFormService';

export default class FormPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	api!: FormFlowApi;

	private settingsManager = new SettingsManager(this);
	private featureCoordinator = new FeatureCoordinator(this);
	private services = new ServiceContainer();


	async onload() {
		await this.loadSettings();

		// 初始化需要 App 实例的服务
		this.services.initializeWithApp(this.app);

		this.api = new FormFlowApi(this.app, this.services.formService);

		this.addSettingTab(new PluginSettingTab(this));
		await this.services.applicationCommandService.initialize(this, this.services);
		await this.services.applicationFileViewService.initialize(this);
		await this.services.formIntegrationService.initialize(this);
		await this.services.contextMenuService.initialize(this, this.services);
		this.featureCoordinator.initializeTars(this.settings);

		this.app.workspace.onLayoutReady(async () => {
			this.featureCoordinator.initializeChat(this.settings);
			await this.services.formScriptService.initialize(this.app, this.settings.scriptFolder);
			await this.executeStartupForms();
		});
	}

	/**
	 * 执行标记为"启动时运行"的表单
	 */
	private async executeStartupForms(): Promise<void> {
		try {
			const startupFormService = getStartupFormService(this.app);
			await startupFormService.executeStartupForms();
		} catch (error) {
			DebugLogger.error('[FormPlugin] 执行启动表单失败', error);
		}
	}


	onunload() {
		this.services.dispose();
		this.services.applicationCommandService.unload(this);
		this.services.applicationFileViewService.unload(this);
		this.featureCoordinator.dispose();
	}

	private async loadSettings() {
		this.settings = await this.settingsManager.load();
		this.applyDebugSettings();
	}

	async replaceSettings(value: Partial<PluginSettings>) {
		const { tars, chat, ...rest } = value;
		this.settings = {
			...this.settings,
			...rest,
			chat: { ...this.settings.chat, ...(chat ?? {}) },
			tars: {
				settings: cloneTarsSettings({ ...this.settings.tars.settings, ...(tars?.settings ?? {}) })
			}
		};
		await this.saveSettings();
	}

	async saveSettings() {
		await this.settingsManager.save(this.settings);
		await this.applyRuntimeUpdates();
	}

	private async applyRuntimeUpdates() {
		this.applyDebugSettings();
		await this.services.formScriptService.refresh(this.settings.scriptFolder);
		await this.services.formIntegrationService.initialize(this, true);
		this.services.contextMenuService.refreshContextMenuItems();
		this.featureCoordinator.refresh(this.settings);
	}

	private applyDebugSettings() {
		DebugLogger.setDebugMode(this.settings.tars?.settings?.debugMode ?? false);
		DebugLogger.setDebugLevel(this.settings.tars?.settings?.debugLevel ?? 'error');
	}
}
