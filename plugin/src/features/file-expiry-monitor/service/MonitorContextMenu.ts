import { Menu, TFile, TFolder, TAbstractFile, Notice } from 'obsidian';
import { v4 } from 'uuid';
import FormPlugin from 'src/main';
import { localInstance } from 'src/i18n/locals';
import { DebugLogger } from 'src/utils/DebugLogger';
import type { MonitorConfig } from '../model';
import { MonitorTargetType, DEFAULT_MONITOR_CONFIG } from '../model';
import type { MonitorDataService } from './MonitorDataService';

/**
 * 文件/文件夹右键菜单集成
 * 为文件浏览器添加"加入监控"/"移除监控"菜单项
 */
export class MonitorContextMenu {
	private plugin: FormPlugin;
	private dataService: MonitorDataService;
	private initialized = false;

	constructor(plugin: FormPlugin, dataService: MonitorDataService) {
		this.plugin = plugin;
		this.dataService = dataService;
	}

	/**
	 * 初始化右键菜单事件注册
	 */
	initialize(): void {
		if (this.initialized) return;

		// 监听文件浏览器的右键菜单事件
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, file) => {
				this.handleFileMenu(menu, file);
			})
		);

		this.initialized = true;
		DebugLogger.debug('[MonitorContextMenu] 右键菜单服务已初始化');
	}

	/**
	 * 处理文件菜单事件
	 * 根据文件是否已被监控显示不同的菜单项
	 */
	private handleFileMenu(menu: Menu, file: TAbstractFile): void {
		const settings = this.dataService.getSettings();
		if (!settings.enabled) return;

		// 只处理文件和文件夹，跳过其他类型
		if (!(file instanceof TFile) && !(file instanceof TFolder)) return;

		const isFolder = file instanceof TFolder;
		const path = file.path;

		// 判断该路径是否已有监控配置
		const existingMonitor = this.dataService.getMonitors().find(
			m => m.path === path
		);

		if (existingMonitor) {
			// 已监控 -> 显示"移除监控"
			menu.addItem((item) => {
				item
					.setTitle(localInstance.remove_from_monitor)
					.setIcon('eye-off')
					.onClick(() => {
						this.removeMonitor(existingMonitor.id, path);
					});
			});
		} else {
			// 未监控 -> 显示"加入监控"
			menu.addItem((item) => {
				item
					.setTitle(localInstance.add_to_monitor)
					.setIcon('eye')
					.onClick(() => {
						this.addMonitor(path, isFolder);
					});
			});
		}
	}

	/**
	 * 添加监控配置
	 * 使用默认配置创建新的监控规则
	 */
	private addMonitor(path: string, isFolder: boolean): void {
		const config: MonitorConfig = {
			id: v4(),
			path,
			targetType: isFolder ? MonitorTargetType.FOLDER : MonitorTargetType.FILE,
			expiryDays: DEFAULT_MONITOR_CONFIG.expiryDays,
			recursive: DEFAULT_MONITOR_CONFIG.recursive,
			minStayMinutes: DEFAULT_MONITOR_CONFIG.minStayMinutes,
		};

		this.dataService.addMonitor(config);
		void this.dataService.saveData();
		new Notice(`${localInstance.add_to_monitor}: ${path}`);
		DebugLogger.info(`[MonitorContextMenu] 添加监控: ${path}`);
	}

	/**
	 * 移除监控配置
	 */
	private removeMonitor(id: string, path: string): void {
		this.dataService.removeMonitor(id);
		void this.dataService.saveData();
		new Notice(`${localInstance.remove_from_monitor}: ${path}`);
		DebugLogger.info(`[MonitorContextMenu] 移除监控: ${path}`);
	}

	/**
	 * 清理资源
	 * 事件监听由 plugin.registerEvent 自动管理，无需手动清理
	 */
	cleanup(): void {
		this.initialized = false;
	}
}
