/**
 * 默认数据文件路径
 */
export const DEFAULT_DATA_FILE_PATH = '.obsidian/plugins/formify/file-expiry-data.json';

/**
 * 文件过期监控功能设置
 */
export interface MonitorSettings {
	/** 总开关（默认关闭） */
	enabled: boolean;
	/** 数据文件路径（为空时使用默认路径） */
	dataFilePath: string;
	/** 删除前是否确认（默认 true） */
	confirmBeforeDelete: boolean;
}

/**
 * 默认功能设置
 */
export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
	enabled: false,
	dataFilePath: DEFAULT_DATA_FILE_PATH,
	confirmBeforeDelete: true,
};
