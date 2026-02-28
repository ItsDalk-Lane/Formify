/**
 * 文件访问记录
 * 追踪单个文件的打开状态和最后访问时间
 */
export interface FileAccessRecord {
	/** 文件路径（相对于 Vault 根目录） */
	filePath: string;
	/** 最后打开时间（Unix 时间戳，毫秒） */
	lastOpenedAt: number;
	/** 当前是否正在打开（用于追踪持续打开状态） */
	isCurrentlyOpen: boolean;
	/** 打开开始时间（Unix 时间戳，毫秒；用于计算保持时长） */
	openStartedAt: number | null;
}

/**
 * 创建默认的文件访问记录
 * @param filePath - 文件路径
 * @param initialTimestamp - 初始时间戳（默认当前时间）
 */
export function createDefaultAccessRecord(
	filePath: string,
	initialTimestamp: number = Date.now()
): FileAccessRecord {
	return {
		filePath,
		lastOpenedAt: initialTimestamp,
		isCurrentlyOpen: false,
		openStartedAt: null,
	};
}
