/**
 * 数据收集动作的存储模式枚举
 */
export enum StorageMode {
	/**
	 * 追加模式：每次迭代将数据追加到变量
	 */
	APPEND = "append",

	/**
	 * 替换模式：每次迭代覆盖变量值
	 */
	REPLACE = "replace",
}
