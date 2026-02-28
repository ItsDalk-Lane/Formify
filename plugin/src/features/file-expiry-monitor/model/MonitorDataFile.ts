import type { MonitorConfig } from './MonitorConfig';
import type { FileAccessRecord } from './FileAccessRecord';
import type { MonitorSettings } from './MonitorSettings';

/**
 * 数据文件版本号
 */
export const MONITOR_DATA_VERSION = 1;

/**
 * 数据文件结构
 * 持久化到 JSON 文件的完整数据格式
 */
export interface MonitorDataFile {
	/** 数据格式版本号（用于后续迁移） */
	version: number;
	/** 功能设置（v1.1 新增，兼容旧文件） */
	settings?: MonitorSettings;
	/** 监控配置列表 */
	monitors: MonitorConfig[];
	/** 访问记录映射（路径 → 记录） */
	accessRecords: Record<string, FileAccessRecord>;
	/** 上次检查时间（Unix 时间戳，毫秒） */
	lastCheckAt: number;
}

/**
 * 创建空的默认数据文件结构
 */
export function createDefaultMonitorData(): MonitorDataFile {
	return {
		version: MONITOR_DATA_VERSION,
		monitors: [],
		accessRecords: {},
		lastCheckAt: 0,
	};
}
