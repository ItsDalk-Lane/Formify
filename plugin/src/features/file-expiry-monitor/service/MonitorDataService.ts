import { App, TFile, TFolder, Notice } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import type {
	MonitorConfig,
	FileAccessRecord,
	MonitorDataFile,
	MonitorSettings,
} from '../model';
import {
	createDefaultMonitorData,
	createDefaultAccessRecord,
	DEFAULT_DATA_FILE_PATH,
	DEFAULT_MONITOR_SETTINGS,
	MonitorTargetType,
} from '../model';

/**
 * 监控数据持久化服务
 * 负责数据文件的读写、监控配置和访问记录的增删改查
 *
 * 注意：使用 vault.adapter（底层文件系统 API）而非 vault 的高层 API，
 * 因为默认数据文件路径位于 .obsidian 目录内，vault 的 getAbstractFileByPath/create
 * 不支持 .obsidian 隐藏目录。
 */
export class MonitorDataService {
	private data: MonitorDataFile = createDefaultMonitorData();
	private settings: MonitorSettings = { ...DEFAULT_MONITOR_SETTINGS };
	private loaded = false;

	constructor(private app: App) {}

	// ============================
	// 数据文件读写
	// ============================

	/**
	 * 获取实际使用的数据文件路径
	 * 路径为空或无效时回退到默认路径
	 */
	private getDataFilePath(): string {
		const path = this.settings.dataFilePath?.trim();
		if (!path) {
			return DEFAULT_DATA_FILE_PATH;
		}
		return path;
	}

	/**
	 * 加载数据文件
	 * 文件不存在时返回默认空结构；读取失败时记录日志并返回默认结构
	 */
	async loadData(): Promise<MonitorDataFile> {
		const filePath = this.getDataFilePath();
		try {
			const exists = await this.app.vault.adapter.exists(filePath);
			if (exists) {
				const content = await this.app.vault.adapter.read(filePath);
				const parsed = JSON.parse(content) as MonitorDataFile;
				this.data = {
					version: parsed.version ?? 1,
					settings: parsed.settings,
					monitors: Array.isArray(parsed.monitors) ? parsed.monitors : [],
					accessRecords: parsed.accessRecords ?? {},
					lastCheckAt: parsed.lastCheckAt ?? 0,
				};
				// 从数据文件中恢复设置（兼容旧文件无 settings 字段）
				if (parsed.settings) {
					this.settings = { ...DEFAULT_MONITOR_SETTINGS, ...parsed.settings };
				}
				this.loaded = true;
				DebugLogger.debug('[MonitorDataService] 数据文件加载成功', filePath);
				return this.data;
			}
			// 文件不存在，使用默认空结构
			this.data = createDefaultMonitorData();
			this.loaded = true;
			DebugLogger.debug('[MonitorDataService] 数据文件不存在，使用默认结构', filePath);
			return this.data;
		} catch (error) {
			DebugLogger.error('[MonitorDataService] 加载数据文件失败', error);
			this.data = createDefaultMonitorData();
			this.loaded = true;
			return this.data;
		}
	}

	/**
	 * 保存数据到文件
	 * 使用 vault.adapter 直接写入文件系统，支持 .obsidian 目录
	 * 若父目录不存在则自动创建
	 */
	async saveData(): Promise<void> {
		const filePath = this.getDataFilePath();
		try {
			// 将当前设置一并写入数据文件
			const dataWithSettings: MonitorDataFile = {
				...this.data,
				settings: { ...this.settings },
			};
			const content = JSON.stringify(dataWithSettings, null, '\t');

			// 确保父目录存在
			const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (parentDir) {
				const parentExists = await this.app.vault.adapter.exists(parentDir);
				if (!parentExists) {
					await this.app.vault.adapter.mkdir(parentDir);
				}
			}

			// 直接写入（adapter.write 会自动创建或覆盖文件）
			await this.app.vault.adapter.write(filePath, content);
			DebugLogger.debug('[MonitorDataService] 数据文件保存成功', filePath);
		} catch (error) {
			DebugLogger.error('[MonitorDataService] 保存数据文件失败', error);
		}
	}

	/**
	 * 获取当前内存中的数据快照（只读）
	 */
	getData(): Readonly<MonitorDataFile> {
		return this.data;
	}

	// ============================
	// 功能设置管理
	// ============================

	/**
	 * 获取功能设置
	 */
	getSettings(): Readonly<MonitorSettings> {
		return this.settings;
	}

	/**
	 * 更新功能设置
	 * @param partial - 部分设置字段
	 */
	updateSettings(partial: Partial<MonitorSettings>): MonitorSettings {
		this.settings = { ...this.settings, ...partial };

		// 如果路径变更为无效值，回退并提示
		const newPath = this.settings.dataFilePath?.trim();
		if (partial.dataFilePath !== undefined && !newPath) {
			this.settings.dataFilePath = DEFAULT_DATA_FILE_PATH;
			new Notice('数据文件路径无效，已恢复为默认路径');
		}

		return { ...this.settings };
	}

	// ============================
	// 监控配置管理
	// ============================

	/**
	 * 获取所有监控配置
	 */
	getMonitors(): readonly MonitorConfig[] {
		return this.data.monitors;
	}

	/**
	 * 添加监控配置
	 * @param config - 新的监控配置
	 */
	addMonitor(config: MonitorConfig): void {
		this.data = {
			...this.data,
			monitors: [...this.data.monitors, config],
		};
	}

	/**
	 * 移除监控配置
	 * @param id - 监控配置 ID
	 */
	removeMonitor(id: string): void {
		this.data = {
			...this.data,
			monitors: this.data.monitors.filter(m => m.id !== id),
		};
	}

	/**
	 * 更新监控配置
	 * @param id - 监控配置 ID
	 * @param partial - 需要更新的字段
	 */
	updateMonitor(id: string, partial: Partial<Omit<MonitorConfig, 'id'>>): void {
		this.data = {
			...this.data,
			monitors: this.data.monitors.map(m =>
				m.id === id ? { ...m, ...partial } : m
			),
		};
	}

	// ============================
	// 访问记录管理
	// ============================

	/**
	 * 获取指定文件的访问记录
	 * @param filePath - 文件路径
	 */
	getAccessRecord(filePath: string): FileAccessRecord | undefined {
		return this.data.accessRecords[filePath];
	}

	/**
	 * 更新或创建文件的访问记录
	 * @param filePath - 文件路径
	 * @param partial - 需要更新的字段
	 */
	updateAccessRecord(filePath: string, partial: Partial<Omit<FileAccessRecord, 'filePath'>>): void {
		const existing = this.data.accessRecords[filePath];
		const updated = existing
			? { ...existing, ...partial }
			: { ...createDefaultAccessRecord(filePath), ...partial };

		this.data = {
			...this.data,
			accessRecords: {
				...this.data.accessRecords,
				[filePath]: updated,
			},
		};
	}

	/**
	 * 移除文件的访问记录
	 * @param filePath - 文件路径
	 */
	removeAccessRecord(filePath: string): void {
		const newRecords = { ...this.data.accessRecords };
		delete newRecords[filePath];
		this.data = {
			...this.data,
			accessRecords: newRecords,
		};
	}

	/**
	 * 批量更新文件路径映射（用于文件重命名/移动）
	 * @param oldPath - 旧路径
	 * @param newPath - 新路径
	 */
	renameAccessRecord(oldPath: string, newPath: string): void {
		const record = this.data.accessRecords[oldPath];
		if (!record) return;

		const newRecords = { ...this.data.accessRecords };
		delete newRecords[oldPath];
		newRecords[newPath] = { ...record, filePath: newPath };
		this.data = {
			...this.data,
			accessRecords: newRecords,
		};
	}

	/**
	 * 更新上次检查时间
	 * @param timestamp - 时间戳
	 */
	updateLastCheckAt(timestamp: number): void {
		this.data = {
			...this.data,
			lastCheckAt: timestamp,
		};
	}

	// ============================
	// 文件路径展开
	// ============================

	/**
	 * 根据监控配置展开所有被监控的文件路径
	 * 处理递归规则，仅返回 .md 文件
	 * 自动跳过不存在的路径
	 */
	getAllMonitoredFiles(): string[] {
		const result = new Set<string>();

		for (const monitor of this.data.monitors) {
			const files = this.expandMonitorPath(monitor);
			for (const f of files) {
				result.add(f);
			}
		}

		return Array.from(result);
	}

	/**
	 * 展开单个监控配置对应的文件列表
	 * @param monitor - 监控配置
	 */
	private expandMonitorPath(monitor: MonitorConfig): string[] {
		const abstractFile = this.app.vault.getAbstractFileByPath(monitor.path);

		// 路径不存在，跳过
		if (!abstractFile) {
			return [];
		}

		// 单文件监控
		if (monitor.targetType === MonitorTargetType.FILE) {
			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				return [abstractFile.path];
			}
			return [];
		}

		// 文件夹监控
		if (abstractFile instanceof TFolder) {
			return this.collectMdFiles(abstractFile, monitor.recursive);
		}

		return [];
	}

	/**
	 * 收集文件夹内的 .md 文件
	 * @param folder - 目标文件夹
	 * @param recursive - 是否递归子文件夹
	 */
	private collectMdFiles(folder: TFolder, recursive: boolean): string[] {
		const files: string[] = [];

		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child.path);
			} else if (recursive && child instanceof TFolder) {
				files.push(...this.collectMdFiles(child, true));
			}
		}

		return files;
	}

	/**
	 * 判断指定文件是否在任何监控范围内
	 * @param filePath - 文件路径
	 */
	isFileMonitored(filePath: string): boolean {
		const allFiles = this.getAllMonitoredFiles();
		return allFiles.includes(filePath);
	}

	/**
	 * 获取指定文件对应的监控配置
	 * 返回第一个匹配的配置（文件可能属于多个监控范围）
	 * @param filePath - 文件路径
	 */
	getMonitorConfigForFile(filePath: string): MonitorConfig | undefined {
		for (const monitor of this.data.monitors) {
			const files = this.expandMonitorPath(monitor);
			if (files.includes(filePath)) {
				return monitor;
			}
		}
		return undefined;
	}
}
