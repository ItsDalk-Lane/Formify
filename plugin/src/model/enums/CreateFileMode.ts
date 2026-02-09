/**
 * 创建文件动作的模式
 */
export enum CreateFileMode {
	/** 创建单个文件（默认，现有行为） */
	SINGLE_FILE = "singleFile",
	/** 批量创建文件 */
	BATCH_FILES = "batchFiles",
	/** 创建单个文件夹 */
	SINGLE_FOLDER = "singleFolder",
	/** 批量创建文件夹 */
	BATCH_FOLDERS = "batchFolders",
}
