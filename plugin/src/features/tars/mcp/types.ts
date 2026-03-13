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
export type McpTransportType = 'stdio' | 'sse' | 'websocket' | 'http' | 'remote-sse'

/** MCP 服务器配置（由 mcp-servers/*.md 持久化） */
export interface McpServerConfig {
	/** 唯一标识符 */
	readonly id: string
	/** 显示名称 */
	name: string
	/** 是否启用 */
	enabled: boolean
	/** 传输类型 */
	transportType: McpTransportType
	/** 启动命令（stdio/legacy sse 类型，如 "npx"、"node"、"python"） */
	command?: string
	/** 命令参数（stdio/legacy sse 类型） */
	args?: string[]
	/** 环境变量（stdio/legacy sse 类型） */
	env?: Record<string, string>
	/** 工作目录（stdio/legacy sse 类型） */
	cwd?: string
	/** 服务 URL（websocket/http/remote-sse 类型） */
	url?: string
	/** 自定义 HTTP 请求头（http/remote-sse 类型） */
	headers?: Record<string, string>
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
export interface McpToolAnnotations {
	readonly title?: string
	readonly readOnlyHint?: boolean
	readonly destructiveHint?: boolean
	readonly idempotentHint?: boolean
	readonly openWorldHint?: boolean
}

export interface McpToolInfo {
	/** 工具名称 */
	readonly name: string
	/** 工具标题 */
	readonly title?: string
	/** 工具描述 */
	readonly description: string
	/** JSON Schema 格式的输入参数定义 */
	readonly inputSchema: Record<string, unknown>
	/** JSON Schema 格式的输出参数定义 */
	readonly outputSchema?: Record<string, unknown>
	/** MCP 工具元数据 */
	readonly annotations?: McpToolAnnotations
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
	/** 工具标题 */
	readonly title?: string
	/** 工具描述 */
	readonly description: string
	/** JSON Schema 格式的输入参数定义 */
	readonly inputSchema: Record<string, unknown>
	/** JSON Schema 格式的输出参数定义 */
	readonly outputSchema?: Record<string, unknown>
	/** MCP 工具元数据 */
	readonly annotations?: McpToolAnnotations
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
	/** MCP 服务器配置列表（运行时缓存，非 data.json 持久化源） */
	servers: McpServerConfig[]
	/**
	 * 是否启用内置基础工具 MCP Server
	 * @default true
	 */
	builtinCoreToolsEnabled?: boolean
	/**
	 * 是否启用内置 Filesystem MCP Server
	 * @default true
	 */
	builtinFilesystemEnabled?: boolean
	/**
	 * 内置时间工具默认时区
	 * @default Asia/Shanghai
	 */
	builtinTimeDefaultTimezone?: string
	/**
	 * @deprecated 时间工具已并入内置基础工具，不再提供独立开关。
	 * 保留此字段仅用于向下兼容读取旧配置文件，写入时忽略。
	 */
	builtinTimeEnabled?: boolean
	/**
	 * 工具调用循环最大次数
	 * 即一次对话中 AI 最多可连续调用 MCP 工具的轮数
	 * @default 10
	 */
	maxToolCallLoops?: number
	/**
	 * @deprecated 已移除全局开关，MCP 功能始终启用。
	 * 保留此字段仅用于向下兼容读取旧配置文件，写入时忽略。
	 */
	enabled?: boolean
}

/** MCP 设置默认值 */
export const DEFAULT_BUILTIN_TIME_TIMEZONE = 'Asia/Shanghai'

export const DEFAULT_MCP_SETTINGS: McpSettings = {
	servers: [],
	builtinCoreToolsEnabled: true,
	builtinFilesystemEnabled: true,
	builtinTimeDefaultTimezone: DEFAULT_BUILTIN_TIME_TIMEZONE,
	maxToolCallLoops: 10,
}

/** mcp.json 标准配置文件格式（Claude Desktop 兼容） */
export interface McpConfigFile {
	mcpServers: Record<string, {
		type?: string
		url?: string
		command?: string
		args?: unknown[]
		env?: Record<string, unknown>
		headers?: Record<string, unknown>
	}>
}
