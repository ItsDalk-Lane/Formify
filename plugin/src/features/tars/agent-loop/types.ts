/**
 * Agent Loop 通用类型定义
 *
 * 与 MCP 无关的工具调用循环接口，支持任意工具执行后端
 */

import type { McpToolAnnotations } from '../mcp/types'

/** 通用工具定义（Provider 无关） */
export interface ToolDefinition {
	readonly name: string
	readonly title?: string
	readonly description: string
	readonly inputSchema: Record<string, unknown>
	readonly outputSchema?: Record<string, unknown>
	readonly annotations?: McpToolAnnotations
	/** 工具来源标识，如 'mcp'、'builtin'、'custom' */
	readonly source: string
	/** 工具来源的唯一 ID，如 MCP 的 serverId */
	readonly sourceId: string
}

/** 模型返回的工具调用请求 */
export interface ToolCallRequest {
	readonly id: string
	readonly name: string
	readonly arguments: string
}

/** 工具执行结果 */
export interface ToolCallResult {
	readonly toolCallId: string
	readonly name: string
	readonly content: string
}

/**
 * 工具执行器接口
 *
 * 不同的工具后端（MCP、内置工具等）实现此接口以提供工具执行能力
 */
export interface ToolExecutor {
	/**
	 * 执行单个工具调用
	 *
	 * @param call - 模型返回的工具调用请求
	 * @param tools - 当前可用工具列表（用于查找工具定义）
	 * @returns 工具执行结果
	 */
	execute(call: ToolCallRequest, tools: ToolDefinition[]): Promise<ToolCallResult>
}

/** 动态工具集解析函数 */
export type GetToolsFn = () => Promise<ToolDefinition[]>
