import { Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { DebugLogger } from 'src/utils/DebugLogger';
import type { ProviderSettings, Vendor, BaseOptions, SendRequest } from 'src/features/tars/providers';
import { TOOL_CALLS_END_MARKER, TOOL_CALLS_START_MARKER } from 'src/features/tars/providers/utils';
import type { ServiceContainer } from 'src/service/ServiceContainer';
import type { ChatService } from './ChatService';
import { ToolAdapter } from './ToolAdapter';
import type { ChatMessage, ChatSession } from '../types/chat';
import type { AgentConfig, AgentEvent, AgentExecutionContext, AgentLoopCallback, AgentLoopEvent, SdkTool } from '../types/agent';
import type { ToolCall, ToolResult, ToolExecution } from '../types/tools';
import type { ToolExecutionManager } from './ToolExecutionManager';

type AgentSdk = typeof import('openai-agents-js');

interface AgentInstance {
  agent: any | null;
  config: AgentConfig;
  context: AgentExecutionContext;
}

interface CreateAgentParams {
  userMessage: string;
  session: ChatSession;
  systemPrompt?: string;
  config?: Partial<AgentConfig>;
}

interface AgentLoopParams {
  userMessage: string;
  session: ChatSession;
  systemPrompt?: string;
  provider: ProviderSettings;
  vendor: Vendor;
  providerOptions: BaseOptions;
  onEvent: AgentLoopCallback;
  executionId?: string;
  maxToolCalls?: number;
  autoApproveTools?: boolean;
  showThinking?: boolean;
}

export class AgentService {
  private services: ServiceContainer | null = null;
  private chatService: ChatService | null = null;
  private sdk: AgentSdk | null = null;
  private sdkLoadError: Error | null = null;
  private environmentChecked = false;
  private environmentSupported = true;
  private environmentMessage: string | null = null;
  private runningController: AbortController | null = null;
  private stopRequested = false;
  private toolAdapter: ToolAdapter | null = null;
  private toolExecutionManager: ToolExecutionManager | null = null;
  private pendingToolApprovals = new Map<string, (approved: boolean, reason?: string) => void>();

  /**
   * 初始化 Agent 服务（延迟加载 SDK）
   * @param services 全局服务容器
   * @param chatService 现有 ChatService 实例
   */
  async initialize(services: ServiceContainer, chatService: ChatService): Promise<void> {
    this.services = services;
    this.chatService = chatService;
    this.toolAdapter = new ToolAdapter(chatService.getToolRegistry());
    this.toolExecutionManager = chatService.getToolExecutionManager();
    await this.ensureSdkLoaded();
  }

  /**
   * 创建 Agent 实例（仅做基础准备，不会触发运行）
   * @param params Agent 创建参数
   */
  async createAgent(params: CreateAgentParams): Promise<AgentInstance> {
    const config = this.buildConfig(params.config);
    const context = this.createExecutionContext(params, config);
    const sdk = await this.ensureSdkLoaded();

    if (!sdk) {
      return { agent: null, config, context };
    }

    if (this.toolAdapter) {
      this.toolAdapter.setSdk(sdk);
    }

    const tools = config.enableTools ? this.getSdkTools(context) : [];
    const agent = new sdk.Agent({
      name: 'FormifyAgent',
      instructions: params.systemPrompt ?? '',
      model: config.model,
      tools
    });

    return { agent, config, context };
  }

  /**
   * 执行 Agent 循环并返回事件流（SDK 原生流式事件）
   * @param params Agent 执行参数
   */
  async *executeAgentStreamed(params: CreateAgentParams): AsyncGenerator<AgentEvent> {
    const instance = await this.createAgent(params);
    if (!instance.agent) {
      const message = this.environmentMessage ?? 'Agent 初始化失败，请检查环境或配置。';
      this.notifyError(message);
      yield { type: 'completed', message, timestamp: Date.now(), isError: true };
      return;
    }

    const sdk = this.sdk;
    if (!sdk) {
      const message = 'OpenAI Agents SDK 未就绪，无法执行 Agent。';
      this.notifyError(message);
      yield { type: 'completed', message, timestamp: Date.now(), isError: true };
      return;
    }

    this.stopRequested = false;
    this.runningController = new AbortController();

    try {
      const runner = sdk.Runner.runStreamed(instance.agent, params.userMessage, {
        context: instance.context,
        maxTurns: instance.config.maxTurns
      });

      for await (const event of runner.streamEvents()) {
        if (this.stopRequested) {
          yield { type: 'completed', message: '已停止执行', timestamp: Date.now(), isError: true };
          return;
        }

        const mapped = this.mapStreamEvent(event, instance.context);
        if (!mapped) continue;
        if (Array.isArray(mapped)) {
          for (const item of mapped) {
            yield item;
          }
          continue;
        }
        yield mapped;
      }

      const finalMessage = this.normalizeFinalOutput(runner.finalOutput);
      yield { type: 'completed', message: finalMessage, timestamp: Date.now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Agent 执行失败: ${String(error)}`;
      DebugLogger.error('[AgentService] executeAgentLoop error', error);
      this.notifyError(message);
      yield { type: 'completed', message, timestamp: Date.now(), isError: true };
    } finally {
      this.runningController = null;
    }
  }

  /**
   * 停止正在执行的 Agent 循环
   */
  stopExecution(): void {
    this.stopRequested = true;
    if (this.runningController) {
      this.runningController.abort();
      this.runningController = null;
    }
    for (const resolve of this.pendingToolApprovals.values()) {
      resolve(false, '已停止执行');
    }
    this.pendingToolApprovals.clear();
  }

  /**
   * 执行 Agent 循环（基于现有 Provider 工具链）
   * @param params Agent 循环执行参数
   */
  async executeAgentLoop(params: AgentLoopParams): Promise<void> {
    const messageService = this.chatService?.getMessageService();
    const toolExecutionManager = this.toolExecutionManager;
    if (!messageService || !toolExecutionManager) {
      params.onEvent({
        type: 'error',
        message: 'Agent 服务未初始化完成，无法执行。',
        timestamp: Date.now()
      });
      return;
    }

    const executionId = params.executionId ?? `agent-${uuidv4()}`;
    const maxToolCalls = params.maxToolCalls ?? 20;
    const autoApproveTools = params.autoApproveTools ?? false;
    const showThinking = params.showThinking ?? true;
    const localMessages = this.cloneMessages(params.session.messages);
    let toolCallCount = 0;

    // 从 ChatService 获取 Agent 系统提示词设置
    const agentPromptFromSettings = this.chatService?.getAgentSystemPrompt() || '';
    // 组合系统提示词：原始系统提示词 + Agent 专用提示词
    const agentSystemPrompt = `${params.systemPrompt || ''}

${agentPromptFromSettings}`.trim();
    // 更新系统提示词
    params.systemPrompt = agentSystemPrompt;

    this.stopRequested = false;
    params.onEvent({ type: 'start', executionId, timestamp: Date.now() });

    while (!this.stopRequested) {
      let sendRequest: SendRequest;
      try {
        sendRequest = params.vendor.sendRequestFunc(params.providerOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.onEvent({ type: 'error', message, timestamp: Date.now() });
        return;
      }

      const providerMessages = await this.chatService?.buildProviderMessagesForAgent(
        localMessages,
        params.session,
        params.systemPrompt
      );
      if (!providerMessages) {
        params.onEvent({
          type: 'error',
          message: '构建消息列表失败，无法继续执行。',
          timestamp: Date.now()
        });
        return;
      }

      const assistantMessage = messageService.createMessage('assistant', '');
      localMessages.push(assistantMessage);

      const toolCalls: ToolCall[] = [];
      const toolMarkerBuffer = { value: '' };

      this.runningController = new AbortController();
      try {
        for await (const chunk of sendRequest(providerMessages, this.runningController, this.resolveEmbedAsBinary)) {
          if (this.stopRequested) {
            params.onEvent({ type: 'error', message: '已停止执行', timestamp: Date.now() });
            return;
          }

          const text = await this.processStreamChunk(chunk, toolMarkerBuffer, (payload) => {
            const parsedCalls = this.parseToolCallsPayload(payload);
            for (const call of parsedCalls) {
              toolCalls.push(call);
              params.onEvent({ type: 'tool_call', toolCall: call, timestamp: Date.now() });
            }
          });

          if (text) {
            assistantMessage.content += text;
            if (showThinking) {
              params.onEvent({ type: 'message_delta', content: text, timestamp: Date.now() });
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.onEvent({ type: 'error', message, timestamp: Date.now() });
        return;
      } finally {
        this.runningController = null;
      }

      if (toolCalls.length === 0) {
        params.onEvent({ type: 'complete', message: assistantMessage.content, timestamp: Date.now() });
        return;
      }

      // 保存工具调用到 assistantMessage，以便下次请求时能够正确回传给 API
      // 这对于 DeepSeek 推理模式的工具调用尤为重要
      assistantMessage.toolCalls = [...toolCalls];

      toolCallCount += toolCalls.length;
      if (toolCallCount > maxToolCalls) {
        params.onEvent({
          type: 'error',
          message: `工具调用次数超过上限（${maxToolCalls}），已强制终止。`,
          timestamp: Date.now()
        });
        return;
      }

      for (const call of toolCalls) {
        if (this.stopRequested) {
          params.onEvent({ type: 'error', message: '已停止执行', timestamp: Date.now() });
          return;
        }

        const toolDefinition = this.resolveToolDefinition(call.name);
        if (!toolDefinition) {
          const message = `未找到工具定义: ${call.name}`;
          params.onEvent({ type: 'error', message, timestamp: Date.now() });
          localMessages.push(this.buildToolErrorMessage(messageService, call.id, message));
          continue;
        }
        if (!toolDefinition.enabled) {
          const message = `工具未启用: ${toolDefinition.name}`;
          params.onEvent({ type: 'error', message, timestamp: Date.now() });
          localMessages.push(this.buildToolErrorMessage(messageService, call.id, message));
          continue;
        }

        const exec = toolExecutionManager.createPending({
          toolId: toolDefinition.id,
          toolCallId: call.id,
          sessionId: params.session.id,
          messageId: assistantMessage.id,
          args: call.arguments ?? {}
        });

        let execution: ToolExecution;
        if (toolDefinition.executionMode === 'manual' && !autoApproveTools) {
          const approved = await this.waitForToolApproval(exec.id);
          if (!approved.approved) {
            toolExecutionManager.reject(exec.id);
            const errorMessage = approved.reason ?? '用户已拒绝';
            params.onEvent({
              type: 'tool_result',
              toolCallId: call.id,
              toolId: toolDefinition.id,
              error: errorMessage,
              timestamp: Date.now()
            });
            localMessages.push(this.buildToolErrorMessage(messageService, call.id, errorMessage));
            continue;
          }
          execution = await toolExecutionManager.approve(exec.id);
        } else {
          execution = await toolExecutionManager.approve(exec.id);
        }

        if (execution.status === 'completed') {
          params.onEvent({
            type: 'tool_result',
            toolCallId: call.id,
            toolId: toolDefinition.id,
            result: execution.result,
            timestamp: Date.now()
          });
          localMessages.push(this.buildToolResultMessage(messageService, call.id, execution.result ?? ''));
        } else {
          const errorMessage = execution.error ?? '工具执行失败';
          params.onEvent({
            type: 'tool_result',
            toolCallId: call.id,
            toolId: toolDefinition.id,
            error: errorMessage,
            timestamp: Date.now()
          });
          localMessages.push(this.buildToolErrorMessage(messageService, call.id, errorMessage));
        }
      }
    }
  }

  /**
   * 获取 SDK 格式的工具列表
   * @param context Agent 执行上下文
   */
  getSdkTools(context: AgentExecutionContext): SdkTool[] {
    if (!this.toolAdapter) return [];
    return this.toolAdapter.getSdkTools(context);
  }

  /**
   * 执行手动工具审批（通过）
   * @param executionId 工具执行 ID
   */
  approveToolExecution(executionId: string): void {
    const resolver = this.pendingToolApprovals.get(executionId);
    if (!resolver) return;
    resolver(true);
    this.pendingToolApprovals.delete(executionId);
  }

  /**
   * 执行手动工具审批（拒绝）
   * @param executionId 工具执行 ID
   * @param reason 拒绝原因
   */
  rejectToolExecution(executionId: string, reason?: string): void {
    const resolver = this.pendingToolApprovals.get(executionId);
    if (!resolver) return;
    resolver(false, reason);
    this.pendingToolApprovals.delete(executionId);
  }

  private buildConfig(overrides?: Partial<AgentConfig>): AgentConfig {
    return {
      enableTools: overrides?.enableTools ?? true,
      maxTurns: overrides?.maxTurns ?? 6,
      model: overrides?.model
    };
  }

  private createExecutionContext(params: CreateAgentParams, config: AgentConfig): AgentExecutionContext {
    return {
      session: params.session,
      userMessage: params.userMessage,
      systemPrompt: params.systemPrompt,
      toolCalls: [],
      toolResults: [],
      currentTurn: 0,
      startedAt: Date.now()
    };
  }

  private mapStreamEvent(event: any, context: AgentExecutionContext): AgentEvent | AgentEvent[] | null {
    if (!event || !event.type) return null;

    if (event.type === 'agent_text_delta_stream_event') {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      if (!delta) return null;
      return { type: 'thinking', content: delta, timestamp: Date.now() };
    }

    if (event.type === 'run_item_stream_event') {
      if (event.name === 'reasoning_item_created') {
        const content = this.extractReasoningContent(event.item);
        if (!content) return null;
        return { type: 'thinking', content, timestamp: Date.now() };
      }

      if (event.name === 'tool_called') {
        const toolCall = this.buildToolCallFromItem(event.item);
        if (!toolCall) return null;
        context.toolCalls.push(toolCall);
        const rawArgs = this.extractRawToolArguments(event.item);
        this.toolAdapter?.registerToolCall(toolCall.id, toolCall.name, rawArgs);
        return { type: 'tool_call', toolCall, timestamp: Date.now() };
      }

      if (event.name === 'tool_output') {
        const result = this.buildToolResultFromItem(event.item);
        if (!result) return null;
        context.toolResults.push({
          toolCallId: result.toolCallId,
          toolId: result.toolId,
          result: result.result,
          error: result.error,
          timestamp: result.timestamp
        });
        return {
          type: 'tool_result',
          toolCallId: result.toolCallId,
          toolId: result.toolId,
          result: result.result,
          error: result.error,
          timestamp: result.timestamp
        };
      }
    }

    return null;
  }

  private buildToolCallFromItem(item: any): ToolCall | null {
    const raw = item?.raw_item ?? {};
    const id = String(raw?.id ?? raw?.call_id ?? uuidv4());
    const name = String(raw?.name ?? raw?.tool_name ?? raw?.type ?? 'tool');
    const args = this.parseToolArguments(raw?.arguments);
    return {
      id,
      name,
      arguments: args,
      status: 'pending',
      timestamp: Date.now()
    };
  }

  private buildToolResultFromItem(item: any): {
    toolCallId: string;
    toolId: string;
    result?: ToolResult;
    error?: string;
    timestamp: number;
  } | null {
    const raw = item?.raw_item ?? {};
    const toolCallId = String(raw?.call_id ?? raw?.id ?? '');
    const toolId = String(raw?.name ?? raw?.tool_name ?? '');
    const output = item?.output ?? raw?.output ?? null;
    const error = raw?.error ? String(raw.error) : undefined;
    return {
      toolCallId,
      toolId,
      result: output ?? undefined,
      error,
      timestamp: Date.now()
    };
  }

  private extractReasoningContent(item: any): string {
    const raw = item?.raw_item ?? {};
    const content = raw?.summary ?? raw?.text ?? raw?.content ?? '';
    return typeof content === 'string' ? content : '';
  }

  private extractRawToolArguments(item: any): unknown {
    const raw = item?.raw_item ?? {};
    return raw?.arguments;
  }

  private parseToolArguments(rawArgs: unknown): Record<string, any> {
    if (!rawArgs) return {};
    if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof rawArgs === 'object') {
      return rawArgs as Record<string, any>;
    }
    return {};
  }

  private normalizeFinalOutput(output: any): string {
    if (typeof output === 'string') return output;
    if (output === null || output === undefined) return '';
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }

  private cloneMessages(messages: ChatMessage[]): ChatMessage[] {
    return JSON.parse(JSON.stringify(messages));
  }

  private resolveToolDefinition(toolName: string) {
    if (this.toolAdapter) {
      const tool = this.toolAdapter.getToolMetadata(toolName);
      if (tool) return tool;
    }
    const registry = this.chatService?.getToolRegistry();
    if (!registry) return null;
    return registry.get(toolName) ?? registry.listEnabled().find((item) => item.name === toolName) ?? null;
  }

  private waitForToolApproval(executionId: string): Promise<{ approved: boolean; reason?: string }> {
    return new Promise((resolve) => {
      this.pendingToolApprovals.set(executionId, (approved, reason) => resolve({ approved, reason }));
    });
  }

  private parseToolCallsPayload(payloadText: string): ToolCall[] {
    try {
      const payload = JSON.parse(payloadText);
      if (!Array.isArray(payload)) return [];
      return payload.map((raw) => {
        let args = raw?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        return {
          id: String(raw?.id ?? `tool-call-${uuidv4()}`),
          name: String(raw?.name ?? ''),
          arguments: args as Record<string, any>,
          status: 'pending' as const,
          timestamp: Date.now()
        };
      }).filter((call) => call.name);
    } catch {
      return [];
    }
  }

  private async processStreamChunk(
    chunk: string,
    buffer: { value: string },
    onToolCalls: (payload: string) => void
  ): Promise<string> {
    const combined = buffer.value + chunk;
    let rest = combined;
    let output = '';

    while (true) {
      const start = rest.indexOf(TOOL_CALLS_START_MARKER);
      if (start === -1) {
        output += rest;
        buffer.value = '';
        break;
      }

      output += rest.slice(0, start);
      const afterStart = rest.slice(start + TOOL_CALLS_START_MARKER.length);
      const end = afterStart.indexOf(TOOL_CALLS_END_MARKER);
      if (end === -1) {
        buffer.value = rest.slice(start);
        break;
      }

      const jsonText = afterStart.slice(0, end);
      onToolCalls(jsonText);
      rest = afterStart.slice(end + TOOL_CALLS_END_MARKER.length);
    }

    return output;
  }

  private buildToolResultMessage(
    messageService: { createMessage: (role: any, content: string, options?: any) => ChatMessage },
    toolCallId: string,
    result: string
  ): ChatMessage {
    const message = messageService.createMessage('tool', result);
    message.toolCallId = toolCallId;
    return message;
  }

  private buildToolErrorMessage(
    messageService: { createMessage: (role: any, content: string, options?: any) => ChatMessage },
    toolCallId: string,
    error: string
  ): ChatMessage {
    const message = messageService.createMessage('tool', `Error: ${error}`);
    message.toolCallId = toolCallId;
    return message;
  }

  private resolveEmbedAsBinary = async () => new ArrayBuffer(0);

  private async ensureSdkLoaded(): Promise<AgentSdk | null> {
    if (this.sdk) return this.sdk;
    if (this.sdkLoadError) return null;
    if (!this.isEnvironmentSupported()) return null;

    try {
      this.sdk = await import('openai-agents-js');
      return this.sdk;
    } catch (error) {
      this.sdkLoadError = error instanceof Error ? error : new Error(String(error));
      this.environmentMessage = 'OpenAI Agents SDK 初始化失败，请检查依赖或运行环境。';
      DebugLogger.error('[AgentService] SDK load failed', error);
      return null;
    }
  }

  private isEnvironmentSupported(): boolean {
    if (this.environmentChecked) {
      return this.environmentSupported;
    }

    this.environmentChecked = true;
    const nodeProcess = (globalThis as any)?.process as { versions?: { node?: string } } | undefined;
    const hasNode = !!nodeProcess?.versions?.node;
    if (!hasNode) {
      this.environmentSupported = false;
      this.environmentMessage = '当前运行环境缺少 Node.js API，Agent 服务暂不可用。';
    }

    return this.environmentSupported;
  }

  private notifyError(message: string): void {
    try {
      new Notice(message);
    } catch {
      DebugLogger.warn('[AgentService] Notice failed', message);
    }
  }
}
