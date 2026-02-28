import { DebugLogger } from 'src/utils/DebugLogger';
import { MonitorDataService } from './MonitorDataService';

/**
 * 过期文件信息
 */
export interface ExpiredFileInfo {
	/** 文件路径 */
	filePath: string;
	/** 过期天数（实际未访问天数） */
	daysSinceAccess: number;
	/** 配置的过期阈值天数 */
	expiryDays: number;
}

/**
 * 过期检查结果回调类型
 */
export type ExpiryCheckCallback = (expiredFiles: ExpiredFileInfo[]) => void;

/** 24 小时（毫秒） */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 首次启动延迟 2 分钟（毫秒） */
const INITIAL_DELAY_MS = 2 * 60 * 1000;

/**
 * 过期检查服务
 * 定时扫描所有监控配置下的文件，检测超过配置天数未访问的文件
 */
export class ExpiryCheckService {
	/** 定时器 ID */
	private intervalId: number | null = null;

	/** 初始延迟定时器 ID */
	private initialTimerId: number | null = null;

	/** 过期文件发现回调列表 */
	private callbacks: ExpiryCheckCallback[] = [];

	/** 是否已初始化 */
	private initialized = false;

	constructor(private dataService: MonitorDataService) {}

	/**
	 * 初始化过期检查服务
	 * 启动首次延迟检查和 24 小时定时检查
	 */
	initialize(): void {
		if (this.initialized) return;

		// 首次启动延迟 2 分钟后执行一次检查
		this.initialTimerId = window.setTimeout(async () => {
			this.initialTimerId = null;
			await this.runCheck();
		}, INITIAL_DELAY_MS);

		// 启动 24 小时定时检查
		this.intervalId = window.setInterval(async () => {
			await this.runCheck();
		}, CHECK_INTERVAL_MS);

		this.initialized = true;
		DebugLogger.debug('[ExpiryCheckService] 初始化完成，定时器已启动');
	}

	/**
	 * 注册过期文件发现回调
	 * @param callback - 回调函数
	 */
	onExpiredFilesFound(callback: ExpiryCheckCallback): void {
		this.callbacks.push(callback);
	}

	/**
	 * 移除过期文件发现回调
	 * @param callback - 要移除的回调函数
	 */
	offExpiredFilesFound(callback: ExpiryCheckCallback): void {
		this.callbacks = this.callbacks.filter(cb => cb !== callback);
	}

	/**
	 * 检查所有过期文件
	 * 遍历所有监控配置，比对最后打开时间与当前时间的差值
	 * @returns 所有过期文件的信息列表
	 */
	checkExpiredFiles(): ExpiredFileInfo[] {
		const now = Date.now();
		const expiredFiles: ExpiredFileInfo[] = [];
		const monitors = this.dataService.getMonitors();

		for (const monitor of monitors) {
			// 展开该监控配置下的所有文件
			const monitoredFiles = this.getFilesForMonitor(monitor.id);
			// 支持小时粒度：若配置了 expiryHours 则以小时为单位计算过期阈值，否则使用 expiryDays（向后兼容）
			const expiryMs = (
				monitor.expiryHours !== undefined
					? monitor.expiryHours * 60 * 60 * 1000
					: monitor.expiryDays * 24 * 60 * 60 * 1000
			);

			for (const filePath of monitoredFiles) {
				const record = this.dataService.getAccessRecord(filePath);

				// 没有访问记录的文件，跳过（可能是新配置尚未初始化记录）
				if (!record) continue;

				// 正在打开的文件视为"已访问"，不算过期
				if (record.isCurrentlyOpen) continue;

				const elapsed = now - record.lastOpenedAt;
				if (elapsed > expiryMs) {
					// 计算访问间隔：如果以小时为单位配置，则以小时为单位向下取整，否则以整天计算
					const daysSinceAccess = Math.floor(elapsed / (24 * 60 * 60 * 1000));
					expiredFiles.push({
						filePath,
						daysSinceAccess,
						expiryDays: monitor.expiryDays,
					});
				}
			}
		}

		return expiredFiles;
	}

	/**
	 * 手动触发过期检查
	 * @returns 过期文件信息列表
	 */
	async triggerManualCheck(): Promise<ExpiredFileInfo[]> {
		return this.runCheck();
	}

	// ============================
	// 内部方法
	// ============================

	/**
	 * 执行一次完整的过期检查流程
	 */
	private async runCheck(): Promise<ExpiredFileInfo[]> {
		try {
			const expiredFiles = this.checkExpiredFiles();

			// 更新上次检查时间
			this.dataService.updateLastCheckAt(Date.now());
			await this.dataService.saveData();

			// 通知订阅者
			if (expiredFiles.length > 0) {
				this.notifyCallbacks(expiredFiles);
			}

			DebugLogger.debug(
				`[ExpiryCheckService] 检查完成，发现 ${expiredFiles.length} 个过期文件`
			);

			return expiredFiles;
		} catch (error) {
			DebugLogger.error('[ExpiryCheckService] 过期检查执行失败', error);
			return [];
		}
	}

	/**
	 * 获取指定监控配置下的所有文件
	 * @param monitorId - 监控配置 ID
	 */
	private getFilesForMonitor(monitorId: string): string[] {
		const monitors = this.dataService.getMonitors();
		const monitor = monitors.find(m => m.id === monitorId);
		if (!monitor) return [];

		// 复用 dataService 的路径展开能力
		// 通过临时构造仅包含该 monitor 的配置来获取文件列表
		const allFiles = this.dataService.getAllMonitoredFiles();
		// 注意：getAllMonitoredFiles 返回所有监控配置的合集
		// 这里需要精确获取单个监控的文件列表，使用 getMonitorConfigForFile 反向匹配
		return allFiles.filter(f => {
			const config = this.dataService.getMonitorConfigForFile(f);
			return config?.id === monitorId;
		});
	}

	/**
	 * 通知所有回调
	 */
	private notifyCallbacks(expiredFiles: ExpiredFileInfo[]): void {
		for (const callback of this.callbacks) {
			try {
				callback(expiredFiles);
			} catch (error) {
				DebugLogger.error('[ExpiryCheckService] 回调执行失败', error);
			}
		}
	}

	// ============================
	// 清理
	// ============================

	/**
	 * 清除定时器，释放资源
	 */
	cleanup(): void {
		if (this.initialTimerId !== null) {
			window.clearTimeout(this.initialTimerId);
			this.initialTimerId = null;
		}
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.callbacks = [];
		this.initialized = false;

		DebugLogger.debug('[ExpiryCheckService] 已清理');
	}
}
