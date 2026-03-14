/**
 * MCP（Model Context Protocol）模块导出
 *
 * MCP 负责工具定义提供和工具执行，循环控制已迁移至 agent-loop 模块
 */

export { McpClientManager } from './McpClientManager'
export { McpConfigImporter } from './McpConfigImporter'
export type { McpImportResult } from './McpConfigImporter'
export {
	BUILTIN_CORE_TOOLS_SERVER_ID,
	BUILTIN_CORE_TOOLS_SERVER_NAME,
	BUILTIN_FILESYSTEM_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_NAME,
} from '../../../builtin-mcp/constants'
export {
	DEFAULT_BUILTIN_TIME_TIMEZONE,
	type McpSettings,
	type McpServerConfig,
	type McpServerState,
	type McpServerStatus,
	type McpToolInfo,
	type McpToolDefinition,
	type McpCallToolFn,
	type McpHealthResult,
	type McpConfigFile,
	type McpTransportType,
	DEFAULT_MCP_SETTINGS,
} from './types'
export {
	toOpenAITools,
	toClaudeTools,
	findToolServerId,
	executeMcpToolCalls,
	resolveCurrentMcpTools,
} from './mcpToolCallHandler'
export type {
	OpenAIToolDefinition,
	OpenAIToolCall,
	ToolLoopMessage,
} from './mcpToolCallHandler'
export { McpToolExecutor, mcpToolToToolDefinition } from './McpToolExecutor'
