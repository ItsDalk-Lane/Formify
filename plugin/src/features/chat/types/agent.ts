import type { ChatSession } from './chat';
import type { ToolCall, ToolResult } from './tools';

export type SdkTool = any;

export type AgentEvent =
  | {
      type: 'thinking';
      content: string;
      timestamp: number;
    }
  | {
      type: 'tool_call';
      toolCall: ToolCall;
      timestamp: number;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolId: string;
      result?: ToolResult;
      error?: string;
      timestamp: number;
    }
  | {
      type: 'completed';
      message: string;
      timestamp: number;
      isError?: boolean;
    };

export type AgentLoopEvent =
  | {
      type: 'start';
      executionId: string;
      timestamp: number;
    }
  | {
      type: 'message_delta';
      content: string;
      timestamp: number;
    }
  | {
      type: 'tool_call';
      toolCall: ToolCall;
      timestamp: number;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolId: string;
      result?: ToolResult;
      error?: string;
      timestamp: number;
    }
  | {
      type: 'complete';
      message: string;
      timestamp: number;
    }
  | {
      type: 'error';
      message: string;
      timestamp: number;
    };

export type AgentLoopCallback = (event: AgentLoopEvent) => void;

export interface AgentConfig {
  /**
   * 是否启用工具调用
   */
  enableTools: boolean;
  /**
   * 最大循环次数（安全上限）
   */
  maxTurns: number;
  /**
   * 可选的模型配置（未指定时使用 SDK 默认值）
   */
  model?: string;
}

export interface AgentExecutionContext {
  /**
   * 当前会话信息
   */
  session: ChatSession;
  /**
   * 当前用户消息
   */
  userMessage: string;
  /**
   * 系统提示词
   */
  systemPrompt?: string;
  /**
   * 已触发的工具调用记录
   */
  toolCalls: ToolCall[];
  /**
   * 已执行的工具结果记录
   */
  toolResults: Array<{
    toolCallId: string;
    toolId: string;
    result?: ToolResult;
    error?: string;
    timestamp: number;
  }>;
  /**
   * 当前执行轮次
   */
  currentTurn: number;
  /**
   * 执行开始时间
   */
  startedAt: number;
}

export interface ToolExecutionRequest {
  /**
   * SDK 工具调用 ID
   */
  id: string;
  /**
   * 工具 ID
   */
  toolId: string;
  /**
   * 工具名称
   */
  toolName: string;
  /**
   * 解析后的参数
   */
  arguments: Record<string, any>;
  /**
   * 工具执行模式
   */
  executionMode: 'manual' | 'auto';
  /**
   * 触发执行的上下文
   */
  context: AgentExecutionContext;
}

export interface ToolExecutionResponse {
  /**
   * 是否批准执行
   */
  approved: boolean;
  /**
   * 工具执行结果
   */
  result?: ToolResult;
  /**
   * 错误信息
   */
  error?: string;
}
