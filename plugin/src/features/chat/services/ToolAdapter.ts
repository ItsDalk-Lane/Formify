import { v4 as uuidv4 } from 'uuid';
import type { ToolRegistryService } from './ToolRegistryService';
import type { AgentExecutionContext, SdkTool, ToolExecutionRequest, ToolExecutionResponse } from '../types/agent';
import type { ToolDefinition } from '../types/tools';

type AgentSdk = typeof import('openai-agents-js');

type PendingApproval = {
  request: ToolExecutionRequest;
  resolve: (response: ToolExecutionResponse) => void;
};

/**
 * ToolAdapter 负责在本地工具格式与 SDK Tool 格式之间进行转换，
 * 并提供工具执行的桥接层。
 */
export class ToolAdapter {
  private toolRegistry: ToolRegistryService;
  private sdk: AgentSdk | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();
  private callIdToRequestKey = new Map<string, string>();
  private toolMetadata = new Map<string, ToolDefinition>();

  constructor(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * 更新 ToolRegistryService 引用
   * @param toolRegistry 工具注册服务
   */
  setToolRegistry(toolRegistry: ToolRegistryService): void {
    this.toolRegistry = toolRegistry;
  }

  /**
   * 注入 SDK 实例，用于创建 SDK Tool
   * @param sdk OpenAI Agents SDK
   */
  setSdk(sdk: AgentSdk | null): void {
    this.sdk = sdk;
  }

  /**
   * 将当前启用的工具转换为 SDK Tool 列表
   * @param context Agent 执行上下文
   */
  getSdkTools(context: AgentExecutionContext): SdkTool[] {
    if (!this.sdk) return [];
    const tools = this.toolRegistry.listEnabled();
    this.refreshMetadataCache(tools);
    return tools
      .map((tool) => this.toSdkTool(tool, context))
      .filter((tool): tool is SdkTool => Boolean(tool));
  }

  /**
   * 记录 SDK 触发的工具调用，用于与执行桥接层建立关联
   * @param callId SDK 工具调用 ID
   * @param toolName 工具名称
   * @param rawArgs SDK 原始参数
   */
  registerToolCall(callId: string, toolName: string, rawArgs?: unknown): void {
    const requestKey = this.buildRequestKey(toolName, rawArgs);
    if (!requestKey) return;
    this.callIdToRequestKey.set(callId, requestKey);
  }

  /**
   * 获取待审批的工具请求列表
   */
  getPendingApprovals(): ToolExecutionRequest[] {
    return Array.from(this.pendingApprovals.values()).map((entry) => entry.request);
  }

  /**
   * 获取工具的元数据（用于 UI 展示或执行逻辑）
   * @param toolNameOrId 工具名称或 ID
   */
  getToolMetadata(toolNameOrId: string): ToolDefinition | null {
    return this.toolMetadata.get(toolNameOrId) ?? null;
  }

  /**
   * 审批工具调用（继续执行）
   * @param callId SDK 工具调用 ID
   */
  approveToolCall(callId: string): void {
    const requestKey = this.callIdToRequestKey.get(callId);
    if (!requestKey) return;
    const entry = this.pendingApprovals.get(requestKey);
    if (!entry) return;
    entry.resolve({ approved: true });
    this.pendingApprovals.delete(requestKey);
  }

  /**
   * 拒绝工具调用（终止当前工具执行）
   * @param callId SDK 工具调用 ID
   * @param reason 拒绝原因
   */
  rejectToolCall(callId: string, reason?: string): void {
    const requestKey = this.callIdToRequestKey.get(callId);
    if (!requestKey) return;
    const entry = this.pendingApprovals.get(requestKey);
    if (!entry) return;
    entry.resolve({ approved: false, error: reason ?? '用户已拒绝' });
    this.pendingApprovals.delete(requestKey);
  }

  /**
   * 将单个 ToolDefinition 转换为 SDK Tool
   * @param tool 工具定义
   * @param context Agent 执行上下文
   */
  toSdkTool(tool: ToolDefinition, context: AgentExecutionContext): SdkTool | null {
    if (!this.sdk) return null;

    const paramsSchema = this.normalizeParamsSchema(tool);
    return new this.sdk.FunctionTool({
      name: tool.name,
      description: tool.description,
      params_json_schema: paramsSchema,
      strict_json_schema: true,
      on_invoke_tool: async ({ input }: { context: any; input: string }) => {
        return this.executeTool(tool, input, context);
      }
    });
  }

  /**
   * 执行工具并返回 SDK 期望的结果
   * @param tool 工具定义
   * @param rawInput SDK 传入的 JSON 参数字符串
   * @param context Agent 执行上下文
   */
  async executeTool(tool: ToolDefinition, rawInput: string, context: AgentExecutionContext): Promise<string> {
    const parsed = this.safeParseJson(rawInput);
    if (!parsed.ok) {
      return `工具参数解析失败: ${parsed.error}`;
    }

    const requestKey = this.buildRequestKey(tool.name, rawInput);
    const callId = requestKey ? this.findCallIdByKey(requestKey) : undefined;
    if (callId) {
      this.callIdToRequestKey.delete(callId);
    }
    const request: ToolExecutionRequest = {
      id: callId ?? uuidv4(),
      toolId: tool.id,
      toolName: tool.name,
      arguments: parsed.value,
      executionMode: tool.executionMode,
      context
    };

    if (tool.executionMode === 'manual') {
      const response = await this.waitForApproval(request, requestKey);
      if (!response.approved) {
        return response.error ?? '工具已被拒绝';
      }
    }

    try {
      const result = await this.toolRegistry.execute(tool.name, parsed.value);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `工具执行失败: ${message}`;
    }
  }

  /**
   * 将 ToolDefinition 的 JSON Schema 规范映射为 SDK 可接受的 Schema
   * @param tool 工具定义
   */
  normalizeParamsSchema(tool: ToolDefinition): Record<string, any> {
    const original = tool.parameters ?? { type: 'object', properties: {}, required: [] };
    const properties: Record<string, { type: string; description: string }> = {};

    for (const [key, value] of Object.entries(original.properties ?? {})) {
      if (value.type === 'array' || value.type === 'object') {
        properties[key] = {
          type: 'string',
          description: `${value.description}（原类型为 ${value.type}，请传入 JSON 字符串）`
        };
      } else {
        properties[key] = {
          type: value.type,
          description: value.description
        };
      }
    }

    return {
      type: 'object',
      properties,
      required: Array.isArray(original.required) ? original.required : []
    };
  }

  /**
   * 解析 JSON 参数字符串
   * @param raw JSON 字符串
   */
  safeParseJson(raw: string): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'JSON 参数为空或格式不正确' };
      }
      return { ok: true, value: parsed as Record<string, any> };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildRequestKey(toolName: string, rawArgs?: unknown): string | null {
    if (!toolName) return null;
    if (typeof rawArgs === 'string') {
      return `${toolName}:${rawArgs}`;
    }
    if (rawArgs && typeof rawArgs === 'object') {
      try {
        return `${toolName}:${JSON.stringify(rawArgs)}`;
      } catch {
        return `${toolName}:${uuidv4()}`;
      }
    }
    return `${toolName}:`;
  }

  private findCallIdByKey(requestKey: string): string | undefined {
    for (const [callId, storedKey] of this.callIdToRequestKey.entries()) {
      if (storedKey === requestKey) {
        return callId;
      }
    }
    return undefined;
  }

  private waitForApproval(request: ToolExecutionRequest, requestKey?: string | null): Promise<ToolExecutionResponse> {
    const key = requestKey ?? `${request.toolName}:${request.id}`;
    return new Promise((resolve) => {
      this.pendingApprovals.set(key, { request, resolve });
    });
  }

  private refreshMetadataCache(tools: ToolDefinition[]): void {
    this.toolMetadata.clear();
    for (const tool of tools) {
      this.toolMetadata.set(tool.id, tool);
      this.toolMetadata.set(tool.name, tool);
    }
  }
}
