/**
 * 工具返回值类型，支持字符串或可序列化对象
 */
export type ToolResult = string | Record<string, any>;

export interface ToolDefinition {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	executionMode: 'manual' | 'auto'; // 工具的执行模式
	parameters: {
		type: 'object';
		properties: Record<
			string,
			{
				type: 'string' | 'number' | 'boolean' | 'array' | 'object';
				description: string;
			}
		>;
		required: string[];
	};
	/**
	 * 本地执行器（优先）。通常用于 Obsidian API/Node API 之类的能力。
	 * 返回值可以是字符串或可序列化为 JSON 的对象
	 */
	handler?: (args: Record<string, any>) => Promise<ToolResult> | ToolResult;
	/**
	 * 预留：未来可用于在服务端执行（例如远程网关）。
	 */
	serverHandler?: (args: Record<string, any>) => Promise<ToolResult>;
	category?: string;
	icon?: string;
	createdAt: number;
	updatedAt: number;
}

export interface ToolExecution {
	id: string;
	toolId: string;
	toolCallId?: string;
	sessionId: string;
	messageId: string;
	arguments: Record<string, any>;
	status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected';
	/**
	 * 工具执行结果，存储为序列化后的 JSON 字符串
	 */
	result?: string;
	error?: string;
	createdAt: number;
	approvedAt?: number;
	completedAt?: number;
}

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
