export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, any>;
	/**
	 * 工具调用结果，存储为序列化后的 JSON 字符串
	 */
	result?: string;
	status: 'pending' | 'completed' | 'failed';
	timestamp: number;
}
