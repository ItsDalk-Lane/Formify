/**
 * MCP 工具执行器
 *
 * 实现通用 ToolExecutor 接口，将工具调用委托给 MCP 服务器执行
 * 内部复用 mcpToolCallHandler 的参数校验、归一化、失败追踪等能力
 */

import type { ToolExecutor, ToolCallRequest, ToolCallResult, ToolDefinition } from '../agent-loop/types'
import type { McpCallToolFnForProvider, McpToolDefinitionForProvider } from '../providers'
import { executeMcpToolCalls } from './mcpToolCallHandler'
import type { OpenAIToolCall, ToolLoopMessage } from './mcpToolCallHandler'

interface ToolFailureTrackerEntry {
	count: number
	lastContent: string
}

type ToolFailureTracker = Map<string, ToolFailureTrackerEntry>

/**
 * MCP 工具执行器
 *
 * 将通用 ToolExecutor 接口的调用转换为 MCP 协议的工具调用
 */
export class McpToolExecutor implements ToolExecutor {
	private failureTracker: ToolFailureTracker = new Map()

	constructor(
		private mcpCallTool: McpCallToolFnForProvider,
	) {}

	async execute(call: ToolCallRequest, tools: ToolDefinition[]): Promise<ToolCallResult> {
		const openAIToolCall: OpenAIToolCall = {
			id: call.id,
			type: 'function',
			function: {
				name: call.name,
				arguments: call.arguments,
			},
		}

		const mcpTools: McpToolDefinitionForProvider[] = tools.map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
			inputSchema: tool.inputSchema,
			outputSchema: tool.outputSchema,
			annotations: tool.annotations,
			serverId: tool.sourceId,
		}))

		const results: ToolLoopMessage[] = await executeMcpToolCalls(
			[openAIToolCall],
			mcpTools,
			this.mcpCallTool,
			this.failureTracker,
		)

		const result = results[0]
		return {
			toolCallId: call.id,
			name: call.name,
			content: typeof result?.content === 'string'
				? result.content
				: `工具调用失败: 未收到结果`,
		}
	}
}

/**
 * 将 MCP 工具定义转换为通用 ToolDefinition 格式
 */
export function mcpToolToToolDefinition(mcpTool: McpToolDefinitionForProvider): ToolDefinition {
	return {
		name: mcpTool.name,
		title: mcpTool.title,
		description: mcpTool.description,
		inputSchema: mcpTool.inputSchema,
		outputSchema: mcpTool.outputSchema,
		annotations: mcpTool.annotations,
		source: 'mcp',
		sourceId: mcpTool.serverId,
	}
}
