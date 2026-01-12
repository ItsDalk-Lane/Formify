/**
 * 数据收集动作的变量类型枚举
 */
export enum VariableType {
	/**
	 * 字符串类型：追加模式时拼接文本
	 */
	STRING = "string",

	/**
	 * 数组类型：追加模式时每次迭代添加新元素
	 */
	ARRAY = "array",
}
