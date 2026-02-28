import { App, TFile, EventRef } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import { MonitorDataService } from './MonitorDataService';
import { createDefaultAccessRecord } from '../model';

/**
 * 文件访问追踪服务
 * 监听文件打开/切换/创建/删除/重命名事件，自动更新访问记录
 */
export class FileAccessTracker {
	/** 当前正在追踪的文件路径 */
	private currentFilePath: string | null = null;

	/** 事件引用列表（用于清理） */
	private eventRefs: EventRef[] = [];

	/** 是否已初始化 */
	private initialized = false;

	constructor(
		private app: App,
		private dataService: MonitorDataService,
	) {}

	/**
	 * 初始化事件监听
	 * 注册 workspace 和 vault 事件
	 */
	initialize(): void {
		if (this.initialized) return;

		this.registerWorkspaceEvents();
		this.registerVaultEvents();
		this.initialized = true;

		DebugLogger.debug('[FileAccessTracker] 初始化完成');
	}

	// ============================
	// Workspace 事件：文件打开/切换
	// ============================

	/**
	 * 注册 workspace 级别的事件监听
	 */
	private registerWorkspaceEvents(): void {
		// 文件打开事件：记录打开开始时间
		const fileOpenRef = this.app.workspace.on('file-open', (file) => {
			this.handleFileOpen(file);
		});
		this.eventRefs.push(fileOpenRef);

		// 活动叶子变化事件：处理切换离开当前文件
		const leafChangeRef = this.app.workspace.on('active-leaf-change', () => {
			this.handleActiveLeafChange();
		});
		this.eventRefs.push(leafChangeRef);
	}

	/**
	 * 处理文件打开事件
	 * 记录打开开始时间和"正在打开"状态
	 */
	private handleFileOpen(file: TFile | null): void {
		if (!file || file.extension !== 'md') return;
		if (!this.dataService.isFileMonitored(file.path)) return;

		const now = Date.now();

		// 先结算上一个文件
		this.settleCurrentFile(now);

		// 标记新文件为"正在打开"
		this.currentFilePath = file.path;
		this.dataService.updateAccessRecord(file.path, {
			isCurrentlyOpen: true,
			openStartedAt: now,
		});
	}

	/**
	 * 处理活动叶子变化事件
	 * 当切换到其他文件或关闭标签页时，结算保持时长
	 */
	private handleActiveLeafChange(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const activeFilePath = activeFile?.path ?? null;

		// 如果仍然是同一个文件，无需处理
		if (activeFilePath === this.currentFilePath) return;

		const now = Date.now();
		this.settleCurrentFile(now);

		// 更新当前追踪文件
		if (activeFile && activeFile.extension === 'md' && this.dataService.isFileMonitored(activeFile.path)) {
			this.currentFilePath = activeFile.path;
			this.dataService.updateAccessRecord(activeFile.path, {
				isCurrentlyOpen: true,
				openStartedAt: now,
			});
		} else {
			this.currentFilePath = null;
		}
	}

	/**
	 * 结算当前正在追踪的文件
	 * 根据保持时长决定是否更新"最后打开时间"
	 * @param now - 当前时间戳
	 */
	private settleCurrentFile(now: number): void {
		if (!this.currentFilePath) return;

		const record = this.dataService.getAccessRecord(this.currentFilePath);
		if (!record || !record.isCurrentlyOpen || !record.openStartedAt) {
			// 无有效追踪状态，仅清除标记
			this.dataService.updateAccessRecord(this.currentFilePath, {
				isCurrentlyOpen: false,
				openStartedAt: null,
			});
			return;
		}

		const stayDurationMs = now - record.openStartedAt;
		const config = this.dataService.getMonitorConfigForFile(this.currentFilePath);
		const minStayMs = (config?.minStayMinutes ?? 5) * 60 * 1000;

		if (stayDurationMs >= minStayMs) {
			// 保持时长足够，更新最后打开时间
			this.dataService.updateAccessRecord(this.currentFilePath, {
				lastOpenedAt: now,
				isCurrentlyOpen: false,
				openStartedAt: null,
			});
		} else {
			// 保持时长不足，仅清除打开状态
			this.dataService.updateAccessRecord(this.currentFilePath, {
				isCurrentlyOpen: false,
				openStartedAt: null,
			});
		}
	}

	// ============================
	// Vault 事件：文件创建/删除/重命名
	// ============================

	/**
	 * 注册 vault 级别的事件监听
	 */
	private registerVaultEvents(): void {
		// 文件创建事件
		const createRef = this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.handleFileCreate(file);
			}
		});
		this.eventRefs.push(createRef);

		// 文件删除事件
		const deleteRef = this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.handleFileDelete(file.path);
			}
		});
		this.eventRefs.push(deleteRef);

		// 文件重命名/移动事件
		const renameRef = this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.handleFileRename(oldPath, file.path);
			}
		});
		this.eventRefs.push(renameRef);
	}

	/**
	 * 处理新文件创建
	 * 若文件在监控路径下，初始化访问记录（最后打开时间=创建时间）
	 */
	private handleFileCreate(file: TFile): void {
		if (!this.dataService.isFileMonitored(file.path)) return;

		// 使用文件的创建时间作为初始访问时间
		const createTime = file.stat?.ctime ?? Date.now();
		const existing = this.dataService.getAccessRecord(file.path);
		if (!existing) {
			const record = createDefaultAccessRecord(file.path, createTime);
			this.dataService.updateAccessRecord(file.path, record);
		}
	}

	/**
	 * 处理文件删除
	 * 从访问记录中移除已删除的文件
	 */
	private handleFileDelete(filePath: string): void {
		this.dataService.removeAccessRecord(filePath);

		// 如果删除的是当前正在追踪的文件，清除追踪状态
		if (this.currentFilePath === filePath) {
			this.currentFilePath = null;
		}
	}

	/**
	 * 处理文件重命名/移动
	 * 更新访问记录中的路径映射
	 */
	private handleFileRename(oldPath: string, newPath: string): void {
		this.dataService.renameAccessRecord(oldPath, newPath);

		// 更新当前追踪路径
		if (this.currentFilePath === oldPath) {
			this.currentFilePath = newPath;
		}
	}

	// ============================
	// 清理
	// ============================

	/**
	 * 清理所有事件监听器
	 */
	cleanup(): void {
		for (const ref of this.eventRefs) {
			this.app.workspace.offref(ref);
		}
		this.eventRefs = [];
		this.currentFilePath = null;
		this.initialized = false;

		DebugLogger.debug('[FileAccessTracker] 已清理');
	}
}
