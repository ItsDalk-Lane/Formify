/**
 * MCP（Model Context Protocol）数据模型定义
 *
 * 包含 MCP 服务器配置、运行时状态、工具信息、健康检查结果等类型
 */

/** MCP 服务器连接状态 */
export type McpServerStatus =
	| 'idle'        // 未启动
	| 'connecting'  // 启动中/连接中
	| 'running'     // 运行中
	| 'stopping'    // 停止中
	| 'stopped'     // 已停止
	| 'error'       // 错误

/** MCP 传输类型 */
export type McpTransportType = 'stdio' | 'sse' | 'websocket'

/** MCP 服务器配置（持久化存储在 settings 中） */
export interface McpServerConfig {
	/** 唯一标识符 */
	readonly id: string
	/** 显示名称 */
	name: string
	/** 是否启用 */
	enabled: boolean
	/** 传输类型 */
	transportType: McpTransportType
	/** 启动命令（stdio/sse 类型，如 "npx"、"node"、"python"） */
	command?: string
	/** 命令参数（stdio/sse 类型） */
	args?: string[]
	/** 环境变量（stdio/sse 类型） */
	env?: Record<string, string>
	/** 工作目录（stdio/sse 类型） */
	cwd?: string
	/** WebSocket URL（websocket 类型） */
	url?: string
	/** 连接超时（毫秒），默认 30000 */
	timeout: number
}

/** 运行时状态（不持久化） */
export interface McpServerState {
	/** 服务器配置 ID */
	readonly serverId: string
	/** 当前状态 */
	status: McpServerStatus
	/** 可用的工具列表 */
	tools: McpToolInfo[]
	/** 最后一次错误信息 */
	lastError?: string
	/** 子进程 PID（仅 stdio 类型） */
	pid?: number
}

/** MCP 工具信息（从 tools/list 响应解析） */
export interface McpToolInfo {
	/** 工具名称 */
	readonly name: string
	/** 工具描述 */
	readonly description: string
	/** JSON Schema 格式的输入参数定义 */
	readonly inputSchema: Record<string, unknown>
	/** 所属 MCP 服务器 ID */
	readonly serverId: string
}

/** 健康检查结果 */
export interface McpHealthResult {
	/** 服务器 ID */
	readonly serverId: string
	/** 服务器显示名称 */
	readonly serverName: string
	/** 检查是否成功 */
	readonly success: boolean
	/** 可用工具数量 */
	readonly toolCount: number
	/** 响应耗时（毫秒） */
	readonly responseTimeMs: number
	/** 错误信息（检查失败时） */
	readonly error?: string
}

/** MCP 工具定义（传递给 AI Provider 的格式） */
export interface McpToolDefinition {
	/** 工具名称 */
	readonly name: string
	/** 工具描述 */
	readonly description: string
	/** JSON Schema 格式的输入参数定义 */
	readonly inputSchema: Record<string, unknown>
	/** 所属 MCP 服务器 ID */
	readonly serverId: string
}

/** MCP 工具调用函数签名 */
export type McpCallToolFn = (
	serverId: string,
	toolName: string,
	args: Record<string, unknown>
) => Promise<string>

/** MCP 设置（嵌入 TarsSettings） */
export interface McpSettings {
	/** 是否启用 MCP 功能 */
	enabled: boolean
	/** MCP 服务器配置列表 */
	servers: McpServerConfig[]
}

/** MCP 设置默认值 */
export const DEFAULT_MCP_SETTINGS: McpSettings = {
	enabled: false,
	servers: [],
}

/** mcp.json 标准配置文件格式（Claude Desktop 兼容） */
export interface McpConfigFile {
	mcpServers: Record<string, {
		command: string
		args?: string[]
		env?: Record<string, string>
	}>
}
