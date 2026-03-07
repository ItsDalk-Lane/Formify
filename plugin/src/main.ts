import { Notice, Plugin } from 'obsidian';
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
import { ConflictMonitor } from './service/conflict/ConflictMonitor';
import { MonitorContextMenu } from './features/file-expiry-monitor/service/MonitorContextMenu';
import { ExpiryNoticeManager } from './features/file-expiry-monitor/service/ExpiryNoticeManager';
import { localInstance } from './i18n/locals';
import { ensureAIDataFolders } from './utils/AIPathManager';
import { FormifyTestHooks } from './testing/FormifyTestHooks';

export default class FormPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	api!: FormFlowApi;

	private settingsManager = new SettingsManager(this);
	featureCoordinator = new FeatureCoordinator(this);
	private services = new ServiceContainer();
	private conflictMonitor: ConflictMonitor | null = null;
	private monitorContextMenu: MonitorContextMenu | null = null;
	private expiryNoticeManager: ExpiryNoticeManager | null = null;
	private readonly testHooks = new FormifyTestHooks(this);


	async onload() {
		await this.loadSettings();
		try {
			await this.settingsManager.cleanupLegacyAIStorage();
		} catch (error) {
			DebugLogger.error('[FormPlugin] 旧版快捷操作/系统提示词清理失败（忽略）', error);
		}
		try {
			await ensureAIDataFolders(this.app, this.settings.aiDataFolder);
		} catch (error) {
			DebugLogger.error('[FormPlugin] AI数据文件夹初始化失败，将在下次保存设置时重试', error);
		}
		try {
			await this.settingsManager.migrateAIDataStorage(this.settings);
		} catch (error) {
			DebugLogger.error('[FormPlugin] AI数据目录迁移失败', error);
			new Notice('AI 数据目录迁移失败，请在设置中检查“AI数据总文件夹”并手动调整。');
		}

		// 初始化需要 App 实例的服务
		this.services.initializeWithApp(this.app);

		this.api = new FormFlowApi(this.app, this.services.formService);

		this.addSettingTab(new PluginSettingTab(this));
		await this.services.applicationCommandService.initialize(this, this.services);
		await this.services.applicationFileViewService.initialize(this);
		await this.services.formIntegrationService.initialize(this);
		await this.services.contextMenuService.initialize(this, this.services);
		this.featureCoordinator.initializeTars(this.settings);
		this.featureCoordinator.initializeMcp(this.settings);
		this.testHooks.initialize();

		this.app.workspace.onLayoutReady(async () => {
			this.conflictMonitor = new ConflictMonitor(this.app);
			this.conflictMonitor.start();

			this.featureCoordinator.initializeChat(this.settings);
			await this.services.formScriptService.initialize(this.app, this.settings.scriptFolder);
			await this.executeStartupForms();
			await this.services.autoTriggerService.initialize(this, this.services.formService);

			// 初始化文件过期监控服务
			await this.initializeFileExpiryMonitor();
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

	/**
	 * 初始化文件过期监控服务
	 * 加载数据文件、启动访问追踪和过期检查、注册右键菜单和命令
	 */
	private async initializeFileExpiryMonitor(): Promise<void> {
		try {
			const { monitorDataService, fileAccessTracker, expiryCheckService } = this.services;

			// 先加载持久化数据（包括设置）
			await monitorDataService.loadData();

			// 在 loadData 之后读取设置，确保已从文件恢复
			const monitorSettings = monitorDataService.getSettings();

			// 初始化通知管理器
			this.expiryNoticeManager = new ExpiryNoticeManager(this.app);

			// 初始化右键菜单
			this.monitorContextMenu = new MonitorContextMenu(this, monitorDataService);
			this.monitorContextMenu.initialize();

			// 注册手动检查命令
			this.addCommand({
				id: 'file-expiry-check-now',
				name: localInstance.check_now,
				callback: async () => {
					const expiredFiles = await expiryCheckService.triggerManualCheck();
					if (expiredFiles.length > 0 && this.expiryNoticeManager) {
						this.expiryNoticeManager.show(expiredFiles);
					} else {
						const { Notice } = await import('obsidian');
						new Notice(localInstance.no_expired_files);
					}
				},
			});

			// 仅在功能开启时启动追踪和检查服务
			if (monitorSettings.enabled) {
				fileAccessTracker.initialize();
				expiryCheckService.initialize();

				// 订阅过期文件发现事件
				expiryCheckService.onExpiredFilesFound((expiredFiles) => {
					if (this.expiryNoticeManager && expiredFiles.length > 0) {
						this.expiryNoticeManager.show(expiredFiles);
					}
				});
			}
		} catch (error) {
			DebugLogger.error('[FormPlugin] 初始化文件过期监控失败', error);
		}
	}


	onunload() {
		this.conflictMonitor?.dispose();
		this.conflictMonitor = null;

		this.expiryNoticeManager?.cleanup();
		this.expiryNoticeManager = null;
		this.monitorContextMenu?.cleanup();
		this.monitorContextMenu = null;

		this.services.dispose();
		this.services.applicationCommandService.unload(this);
		this.services.applicationFileViewService.unload(this);
		this.featureCoordinator.dispose();
		this.testHooks.dispose();
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

	/**
	 * 手动触发 AI 数据文件夹创建
	 * 由设置页面在输入框失焦且值有变化时调用
	 * @param folderPath - 可选，指定要创建的文件夹路径；为空时使用当前设置值
	 */
	async tryEnsureAIDataFolders(folderPath?: string): Promise<void> {
		try {
			await ensureAIDataFolders(this.app, folderPath ?? this.settings.aiDataFolder);
		} catch (error) {
			DebugLogger.error('[FormPlugin] AI数据文件夹创建失败', error);
		}
	}

	private async applyRuntimeUpdates() {
		this.applyDebugSettings();
		await this.services.formScriptService.refresh(this.settings.scriptFolder);
		await this.services.formIntegrationService.initialize(this, true);
		this.services.contextMenuService.refreshContextMenuItems();
		this.featureCoordinator.refresh(this.settings);
		this.testHooks.syncWindowBinding();
	}

	private applyDebugSettings() {
		DebugLogger.setDebugMode(this.settings.tars?.settings?.debugMode ?? false);
		DebugLogger.setDebugLevel(this.settings.tars?.settings?.debugLevel ?? 'error');
		DebugLogger.setLlmConsoleLogEnabled(this.settings.tars?.settings?.enableLlmConsoleLog ?? false);
		DebugLogger.setLlmResponsePreviewChars(this.settings.tars?.settings?.llmResponsePreviewChars ?? 100);
	}
}
