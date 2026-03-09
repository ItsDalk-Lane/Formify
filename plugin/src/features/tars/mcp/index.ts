/**
 * MCP（Model Context Protocol）模块导出
 */

export { McpClientManager } from './McpClientManager'
export { McpConfigImporter } from './McpConfigImporter'
export type { McpImportResult } from './McpConfigImporter'
export {
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
} from '../../../builtin-mcp/constants'
export {
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
	DEFAULT_BUILTIN_MEMORY_FILE_PATH,
	DEFAULT_MCP_SETTINGS,
} from './types'
export {
	toOpenAITools,
	toClaudeTools,
	findToolServerId,
	executeMcpToolCalls,
	withOpenAIMcpToolCallSupport,
} from './mcpToolCallHandler'
export type {
	OpenAIToolDefinition,
	OpenAIToolCall,
	ToolLoopMessage,
} from './mcpToolCallHandler'
