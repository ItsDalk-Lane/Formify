/**
 * MCP 工具调用循环处理器
 *
 * 为 AI Provider 提供 MCP 工具调用支持
 * 将 MCP 工具转换为各 Provider 格式，处理工具调用循环
 */

import OpenAI from 'openai'
import { DebugLogger } from 'src/utils/DebugLogger'
import type {
	BaseOptions,
	McpCallToolFnForProvider,
	McpToolDefinitionForProvider,
	Message,
	SendRequest,
} from '../providers'

/** 工具调用循环最大次数 */
const MAX_TOOL_CALL_LOOPS = 10

/** OpenAI 兼容格式的工具定义 */
export interface OpenAIToolDefinition {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}

/** OpenAI 工具调用响应 */
export interface OpenAIToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

/** 工具调用循环中的消息 */
export interface ToolLoopMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string | null
	tool_calls?: OpenAIToolCall[]
	tool_call_id?: string
	name?: string
}

/**
 * 将 MCP 工具转换为 OpenAI 兼容格式
 *
 * 适用于: OpenAI, DeepSeek, Qwen, Ollama, OpenRouter,
 * SiliconFlow, Zhipu, Grok, Kimi, Azure, Doubao, Poe
 */
export function toOpenAITools(mcpTools: McpToolDefinitionForProvider[]): OpenAIToolDefinition[] {
	return mcpTools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}))
}

/**
 * 将 MCP 工具转换为 Anthropic Claude 格式
 */
export function toClaudeTools(mcpTools: McpToolDefinitionForProvider[]): Array<{
	name: string
	description: string
	input_schema: Record<string, unknown>
}> {
	return mcpTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}))
}

/**
 * 查找 MCP 工具对应的 serverId
 */
export function findToolServerId(
	toolName: string,
	mcpTools: McpToolDefinitionForProvider[],
): string | undefined {
	return mcpTools.find((t) => t.name === toolName)?.serverId
}

/**
 * 执行 MCP 工具调用并返回结果
 *
 * @param toolCalls - AI 模型返回的工具调用列表
 * @param mcpTools - 可用的 MCP 工具列表
 * @param mcpCallTool - 工具调用回调
 * @returns 工具结果消息列表（OpenAI tool message 格式）
 */
export async function executeMcpToolCalls(
	toolCalls: OpenAIToolCall[],
	mcpTools: McpToolDefinitionForProvider[],
	mcpCallTool: McpCallToolFnForProvider,
): Promise<ToolLoopMessage[]> {
	const results: ToolLoopMessage[] = []

	for (const call of toolCalls) {
		const toolName = call.function.name
		const serverId = findToolServerId(toolName, mcpTools)

		if (!serverId) {
			DebugLogger.warn(`[MCP] 未找到工具 "${toolName}" 对应的 MCP 服务器`)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `错误: 未找到工具 "${toolName}"`,
			})
			continue
		}

		let args: Record<string, unknown>
		try {
			args = JSON.parse(call.function.arguments || '{}')
		} catch {
			args = {}
		}

		try {
			DebugLogger.debug(`[MCP] 执行工具调用: ${toolName}`, args)
			const result = await mcpCallTool(serverId, toolName, args)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: result,
			})
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)
			DebugLogger.error(`[MCP] 工具调用失败: ${toolName}`, err)
			results.push({
				role: 'tool',
				tool_call_id: call.id,
				name: toolName,
				content: `工具调用失败: ${errorMsg}`,
			})
		}
	}

	return results
}

/**
 * 从流式响应中累积工具调用
 *
 * OpenAI 流式 API 中 tool_calls 以增量方式返回:
 * - delta.tool_calls[i].id: 首次出现时设置
 * - delta.tool_calls[i].function.name: 首次出现时设置
 * - delta.tool_calls[i].function.arguments: 分多个 chunk 拼接
 */
function accumulateToolCall(
	toolCallsMap: Map<number, { id: string; name: string; args: string }>,
	deltaToolCalls: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>,
): void {
	for (const tc of deltaToolCalls) {
		const existing = toolCallsMap.get(tc.index) ?? { id: '', name: '', args: '' }
		if (tc.id) existing.id = tc.id
		if (tc.function?.name) existing.name += tc.function.name
		if (tc.function?.arguments) existing.args += tc.function.arguments
		toolCallsMap.set(tc.index, existing)
	}
}

/**
 * 将累积的工具调用映射转换为 OpenAIToolCall 数组
 */
function finalizeToolCalls(
	toolCallsMap: Map<number, { id: string; name: string; args: string }>,
): OpenAIToolCall[] {
	return Array.from(toolCallsMap.values()).map((tc) => ({
		id: tc.id,
		type: 'function' as const,
		function: { name: tc.name, arguments: tc.args },
	}))
}

/**
 * 包装 OpenAI 兼容的 sendRequestFunc，添加 MCP 工具调用支持
 *
 * 当 settings.mcpTools 存在时：
 * 1. 使用流式请求发送消息（含工具定义）
 * 2. 如果响应包含 tool_calls → 执行工具 → 追加结果 → 重新请求
 * 3. 如果响应为纯文本 → 流式 yield 给调用方
 * 4. 循环直到无工具调用或达到最大循环次数
 *
 * 当 settings.mcpTools 不存在时，直接委托给原始函数。
 *
 * @param originalFactory - 原始的 sendRequestFunc 工厂函数
 * @returns 包装后的 sendRequestFunc
 */
export function withOpenAIMcpToolCallSupport(
	originalFactory: (settings: BaseOptions) => SendRequest,
): (settings: BaseOptions) => SendRequest {
	return (settings: BaseOptions): SendRequest => {
		const { mcpTools, mcpCallTool } = settings
		if (!mcpTools?.length || !mcpCallTool) {
			return originalFactory(settings)
		}

		return async function* (messages, controller) {
			const { parameters, ...optionsExcludingParams } = settings
			const allOptions = { ...optionsExcludingParams, ...parameters }
			const { apiKey, baseURL, model } = allOptions

			// 规范化 baseURL：部分 Provider 的 baseURL 已包含 /chat/completions，
			// 但 OpenAI SDK 会自动追加该路径，需要移除以避免重复
			let normalizedBaseURL = baseURL as string
			if (normalizedBaseURL.endsWith('/chat/completions')) {
				normalizedBaseURL = normalizedBaseURL.replace(/\/chat\/completions$/, '')
			}

			const client = new OpenAI({
				apiKey: apiKey as string,
				baseURL: normalizedBaseURL,
				dangerouslyAllowBrowser: true,
			})

			const tools = toOpenAITools(mcpTools)

			// 将原始消息转换为工具循环格式
			const loopMessages: ToolLoopMessage[] = messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}))

			for (let loop = 0; loop < MAX_TOOL_CALL_LOOPS; loop++) {
				if (controller.signal.aborted) return

				DebugLogger.debug(`[MCP] 工具调用循环 #${loop + 1}`)

				// 流式请求（含工具定义）
				const stream = await client.chat.completions.create(
					{
						model: model as string,
						messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
						tools,
						stream: true,
					},
					{ signal: controller.signal },
				)

				let contentBuffer = ''
				const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()
				let hasToolCalls = false

				for await (const part of stream) {
					const delta = part.choices[0]?.delta as Record<string, unknown> | undefined
					if (!delta) continue

					// 累积文本内容
					const textContent = delta.content as string | undefined
					if (textContent) {
						contentBuffer += textContent
						// 如果还没检测到 tool_calls，先流式输出文本
						// 注意：OpenAI 不会同时返回 content 和 tool_calls
						if (!hasToolCalls) {
							yield textContent
						}
					}

					// 累积工具调用
					const deltaToolCalls = delta.tool_calls as
						| Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
						| undefined
					if (deltaToolCalls) {
						hasToolCalls = true
						accumulateToolCall(toolCallsMap, deltaToolCalls)
					}
				}

				if (!hasToolCalls) {
					// 无工具调用，文本已流式输出，结束
					return
				}

				// 有工具调用 → 执行工具
				const toolCalls = finalizeToolCalls(toolCallsMap)

				loopMessages.push({
					role: 'assistant',
					content: contentBuffer || null,
					tool_calls: toolCalls,
				})

				const toolResults = await executeMcpToolCalls(toolCalls, mcpTools, mcpCallTool)
				loopMessages.push(...toolResults)

				DebugLogger.debug(
					`[MCP] 已执行 ${toolCalls.length} 个工具调用，继续循环`,
				)
			}

			// 达到最大循环次数，做最后一次流式请求（不带工具）
			DebugLogger.warn(`[MCP] 达到最大工具调用循环次数 (${MAX_TOOL_CALL_LOOPS})`)

			const finalStream = await client.chat.completions.create(
				{
					model: model as string,
					messages: loopMessages as OpenAI.ChatCompletionMessageParam[],
					stream: true,
				},
				{ signal: controller.signal },
			)

			for await (const part of finalStream) {
				const text = (part.choices[0]?.delta as Record<string, unknown> | undefined)?.content as string | undefined
				if (text) yield text
			}
		}
	}
}
