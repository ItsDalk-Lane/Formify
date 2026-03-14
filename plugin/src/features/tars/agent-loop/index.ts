/**
 * Agent Loop 模块
 *
 * 独立于 MCP 的工具调用循环控制模块
 * 负责 AI Chat 中的循环模型调用，MCP 仅作为 ToolExecutor 的一个实现
 */

export type {
	ToolDefinition,
	ToolCallRequest,
	ToolCallResult,
	ToolExecutor,
	GetToolsFn,
} from './types'

export {
	withToolCallLoopSupport,
	toOpenAITools,
	resolveCurrentTools,
} from './OpenAILoopHandler'
export type {
	OpenAILoopOptions,
	OpenAIToolDefinition,
	OpenAIToolCall,
	ToolLoopMessage,
	ContentPart,
} from './OpenAILoopHandler'

export {
	withClaudeToolCallLoopSupport,
	toClaudeTools,
} from './ClaudeLoopHandler'
