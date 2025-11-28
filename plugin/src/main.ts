import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './settings/PluginSettings';
import { formScriptService } from './service/extend/FormScriptService';
import { formIntegrationService } from './service/command/FormIntegrationService';
import { applicationCommandService } from './service/command/ApplicationCommandService';
import { applicationFileViewService } from './service/file-view/ApplicationFileViewService';
import { PluginSettingTab } from './settings/PluginSettingTab';
import './style/base.css'
import './style/chat.css'
import { FormFlowApi } from './api/FormFlowApi';
import { TarsFeatureManager, cloneTarsSettings } from './features/tars';
import { encryptApiKey, decryptApiKey } from './features/tars/utils/cryptoUtils';
import { DebugLogger } from './utils/DebugLogger';
import { ChatFeatureManager } from './features/chat';
import { AutoCompletionFeatureManager } from './features/auto-completion';

export default class FormPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	private tarsFeatureManager: TarsFeatureManager | null = null;
	private chatFeatureManager: ChatFeatureManager | null = null;
	private autoCompletionFeatureManager: AutoCompletionFeatureManager | null = null;

	api: FormFlowApi = new FormFlowApi(this.app);

	async onload() {
		await this.loadSettings();

		// 初始化调试日志系统
		DebugLogger.setDebugMode(this.settings.tars?.settings?.debugMode ?? false);
		DebugLogger.setDebugLevel(this.settings.tars?.settings?.debugLevel ?? 'error');

		this.addSettingTab(new PluginSettingTab(this));
		await applicationCommandService.initialize(this);
		await applicationFileViewService.initialize(this);
		await formIntegrationService.initialize(this);
		this.refreshTarsFeature();

		// 在工作区准备就绪后再初始化聊天功能
		this.app.workspace.onLayoutReady(async () => {
			// 添加短暂延迟确保所有组件都已完全加载
			await new Promise(resolve => setTimeout(resolve, 200));

			// 现在安全地初始化聊天功能
			this.initializeChatFeature();

			// 初始化自动补全功能
			this.initializeAutoCompletionFeature();

			// 然后初始化脚本服务
			formScriptService.initialize(this.app, this.settings.scriptFolder);
		});
	}

	onunload() {
		formScriptService.unload();
		applicationCommandService.unload(this);
		applicationFileViewService.unload(this);
		formIntegrationService.cleanup();
		this.tarsFeatureManager?.dispose();
		this.tarsFeatureManager = null;
		this.chatFeatureManager?.dispose();
		this.chatFeatureManager = null;
		this.autoCompletionFeatureManager?.dispose();
		this.autoCompletionFeatureManager = null;
	}

	async loadSettings() {
		const persisted = (await this.loadData()) ?? {};
		const defaultSettings = { ...DEFAULT_SETTINGS };
		
		// 解密存储的 Tars 设置中的 API 密钥
		let decryptedTarsSettings = persisted?.tars?.settings
		if (decryptedTarsSettings?.providers) {
			DebugLogger.debug('[Main] 开始解密 API 密钥')
			decryptedTarsSettings = {
				...decryptedTarsSettings,
				providers: decryptedTarsSettings.providers.map((provider: any) => ({
					...provider,
					options: {
						...provider.options,
						apiKey: decryptApiKey(provider.options.apiKey || ''),
						// 如果有 apiSecret 字段也需要解密
						...(provider.options.apiSecret && {
							apiSecret: decryptApiKey(provider.options.apiSecret)
						})
					}
				}))
			}
			DebugLogger.debug('[Main] API 密钥解密完成')
		}
		
		this.settings = {
			...defaultSettings,
			...persisted,
			tars: {
				settings: cloneTarsSettings(decryptedTarsSettings),
			},
			chat: {
				...defaultSettings.chat,
				...(persisted.chat ?? {})
			},
			autoCompletion: {
				...defaultSettings.autoCompletion,
				...(persisted.autoCompletion ?? {})
			}
		};
	}

	async replaceSettings(value: Partial<PluginSettings>) {
		const { tars, ...rest } = value;
		this.settings = Object.assign({}, this.settings, rest);
		if (tars) {
			this.settings.tars = {
				settings: cloneTarsSettings({ ...this.settings.tars.settings, ...tars.settings })
			};
		}
		await this.saveSettings();
	}

	async saveSettings() {
		// 在保存前加密 Tars 设置中的 API 密钥
		const settingsToSave = { ...this.settings }
		if (settingsToSave.tars?.settings?.providers) {
			DebugLogger.debug('[Main] 开始加密 API 密钥')
			settingsToSave.tars = {
				...settingsToSave.tars,
				settings: {
					...settingsToSave.tars.settings,
					providers: settingsToSave.tars.settings.providers.map((provider) => {
						const encryptedOptions: any = {
							...provider.options,
							apiKey: encryptApiKey(provider.options.apiKey || '')
						}
						
						// 如果有 apiSecret 字段也需要加密
						if ('apiSecret' in provider.options && (provider.options as any).apiSecret) {
							encryptedOptions.apiSecret = encryptApiKey((provider.options as any).apiSecret)
						}
						
						return {
							...provider,
							options: encryptedOptions
						}
					})
				}
			}
			DebugLogger.debug('[Main] API 密钥加密完成')
		}
		
		await this.saveData(settingsToSave);
		
		// 更新调试日志设置
		DebugLogger.setDebugMode(this.settings.tars?.settings?.debugMode ?? false);
		DebugLogger.setDebugLevel(this.settings.tars?.settings?.debugLevel ?? 'error');
		
		formScriptService.refresh(this.settings.scriptFolder)
		formIntegrationService.initialize(this, true);
		this.refreshTarsFeature();
		this.chatFeatureManager?.updateChatSettings(this.settings.chat);
		this.chatFeatureManager?.updateProviderSettings(this.settings.tars.settings);
		this.autoCompletionFeatureManager?.updateSettings(
			this.settings.autoCompletion,
			this.settings.tars.settings
		);
	}

	private refreshTarsFeature() {
		const { tars } = this.settings;
		// Tars功能始终启用，移除启用/禁用逻辑
		
		if (!this.tarsFeatureManager) {
			this.tarsFeatureManager = new TarsFeatureManager(
				this,
				tars.settings
			);
			this.tarsFeatureManager.initialize();
			this.chatFeatureManager?.updateProviderSettings(tars.settings);
			return;
		}

		this.tarsFeatureManager.updateSettings(tars.settings);
		this.chatFeatureManager?.updateProviderSettings(tars.settings);
	}

	private initializeChatFeature() {
		if (!this.chatFeatureManager) {
			this.chatFeatureManager = new ChatFeatureManager(this);
			this.chatFeatureManager.initialize(this.settings.chat);
			return;
		}
		this.chatFeatureManager.updateChatSettings(this.settings.chat);
	}

	private initializeAutoCompletionFeature() {
		if (!this.autoCompletionFeatureManager) {
			this.autoCompletionFeatureManager = new AutoCompletionFeatureManager(
				this, 
				this.settings.autoCompletion,
				this.settings.tars.settings
			);
			this.autoCompletionFeatureManager.initialize();
			return;
		}
		this.autoCompletionFeatureManager.updateSettings(
			this.settings.autoCompletion,
			this.settings.tars.settings
		);
	}
}
