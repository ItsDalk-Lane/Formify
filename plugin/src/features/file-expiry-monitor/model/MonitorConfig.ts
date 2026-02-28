/**
 * 监控类型枚举
 */
export enum MonitorTargetType {
	/** 单个文件 */
	FILE = 'file',
	/** 文件夹 */
	FOLDER = 'folder',
}

/**
 * 监控配置项
 * 定义一条监控规则：对指定路径（文件或文件夹）设置过期策略
 */
export interface MonitorConfig {
	/** 唯一标识（UUID） */
	id: string;
	/** 监控路径（相对于 Vault 根目录） */
	path: string;
	/** 监控类型：文件 / 文件夹 */
	targetType: MonitorTargetType;
	/** 过期阈值 - 向后兼容：优先使用 expiryHours（如果存在），否则使用 expiryDays */
	expiryDays: number;
	/** 过期阈值（小时） - 可选，若存在则以小时为单位判断过期 */
	expiryHours?: number;
	/** 是否递归子文件夹（仅当 targetType 为 FOLDER 时有效） */
	recursive: boolean;
	/** 最小保持时间（分钟），文件需持续打开达到此时长才计为"已访问" */
	minStayMinutes: number;
}

/**
 * 监控配置默认值
 */
export const DEFAULT_MONITOR_CONFIG: Omit<MonitorConfig, 'id' | 'path'> = {
	targetType: MonitorTargetType.FOLDER,
	expiryDays: 30,
	recursive: false,
	minStayMinutes: 5,
};
