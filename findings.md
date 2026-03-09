# Findings & Decisions

## Requirements
- 用户明确要求按照 `/Users/study_superior/Desktop/Code/Formify/docs/Obsidian CLI.md` 文档，直接在 Obsidian 运行态里复现并修复问题。
- 问题场景是动作配置中的“执行条件”弹窗，点击“添加条件”展开菜单后，所有菜单项都无响应。
- 需要避免影响其他使用相同下拉菜单或 `Dialog2` 的场景。

## Research Findings
- `FilterRoot` 被用于多个 `Dialog2` 场景：动作执行条件、字段可见性、数据库字段条件。
- `CpsFormAction` 中的执行条件弹窗通过 `closeOnInteractOutside={false}` 打开。
- `FilterDropdown` 和 `StartupConditionEditor` 都把 `DropdownMenu.Content` portal 到 `window.activeDocument.body`。
- 已尝试的静态修复：
  - 提升 `.form--FilterDropdownMenuContent` 到 `var(--form--modal-layer)`。
  - 在 `Dialog2` 中放行 `[data-radix-popper-content-wrapper]` 的 outside 事件。
- 用户反馈以上两次修复后问题依旧，说明还需要运行态验证。
- 使用 Obsidian CLI + CDP 真实点击复现后，菜单项中心点的最上层元素就是 `.form--FilterDropdownMenuItem`，说明当前运行态下并不存在遮罩层命中覆盖问题。
- 真实点击菜单项时，Obsidian 错误缓冲记录到 `TypeError: t.removeInvalidActionIds is not a function`，异常链路为 `FilterRoot -> CpsFormAction.onFilterChange -> FormConfig.cleanupTriggerActionRefs()`。
- `useForm.tsx` 在读取 `.cform` 时直接 `JSON.parse` 并返回普通对象，没有走 `FormConfig.fromJSON()`，导致编辑器后续拿到的 `formConfig` / `actionTriggers` 不是模型实例。
- 修复后再次使用 Obsidian CLI 真实点击验证：
  - “添加条件”会新增普通条件行。
  - “添加时间条件”会新增时间条件行。
  - “添加文件条件”会新增文件条件行。
  - 错误缓冲为空。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 使用 planning-with-files 记录过程 | 这是多阶段运行态排查，避免重复尝试 |
| 下一步优先跑 Obsidian CLI 复现 | 只有运行态才能确认点击事件到底被谁拦截 |
| 在 `useForm` 做主修复，在 `FormConfig` 做兜底正规化 | 既修正上游数据来源，也避免后续再因 plain object 触发器崩溃 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 当前仓库存在大量 unrelated 改动 | 修复时只触碰 `Dialog2` / `FilterDropdown` / 运行态复现所需文件 |
| Obsidian 中同时打开了多个 form/text 标签页，运行态截图容易落在错误 leaf | 后续所有验证都只针对 active leaf 或直接用 CDP 坐标点击 |

## Resources
- `/Users/study_superior/Desktop/Code/Formify/docs/Obsidian CLI.md`
- `/Users/study_superior/Desktop/Code/Formify/plugin/src/view/edit/setting/action/CpsFormAction.tsx`
- `/Users/study_superior/Desktop/Code/Formify/plugin/src/component/dialog/Dialog2.tsx`
- `/Users/study_superior/Desktop/Code/Formify/plugin/src/component/filter/menu/FilterDropdown.tsx`

---

## Session: 2026-03-09 Obsidian 插件结构分析

### Research Findings
- AI 能力主要分布在 `features/chat`、`features/tars`、`builtin-mcp` 三层，而不是单一聊天模块。
- 内置 MCP server 默认启用 5 个：Vault、Memory、Obsidian Search、Tool Search、Sequential Thinking，总计注册 41 个工具。
- 聊天层不会把所有工具直接注入模型；`McpClientManager.getToolsForModelContext()` 只暴露 Tool Search 的 3 个工具，再由 `chatTwoPhaseToolController` 动态放出候选真实工具。
- 仓库中没有精确名为 `Conversation`、`ModelConfig`、`Tool` 的核心业务接口；实际等价类型分别是：
  - `Conversation` -> `ChatSession`
  - `ModelConfig` -> `ProviderSettings` / `BaseOptions` / `Vendor`
  - `Tool` -> `ToolCall` / `McpToolInfo` / `McpToolDefinitionForProvider`
- 历史记录不是 JSON，而是 Markdown 文件 + YAML frontmatter；消息正文带有标题、模型标签、推理块、工具调用块、附件标签。
- 模型选择的真实粒度是“provider 实例标签 (`ProviderSettings.tag`)”，不是 vendor 名。多模型对比也是按 `tag` 组合。
- 模型列表来源既有静态 `vendor.models`，也有远程拉取和自由文本输入，因此“支持哪些模型”不能只看硬编码数组。

### Output
- 已生成分析文档：`/Users/study_superior/Desktop/Code/Formify/docs/obsidian-plugin-analysis.md`

---

## Session: 2026-03-09 Tool Call Agent 重构

### Research Findings
- 用户提示中的 `plugin/src/features/tars/chat/` 已过期；当前聊天主流程位于 `plugin/src/features/chat/services/ChatService.ts`。
- `chatTwoPhaseToolController` 不由全局单例持有，而是在 `ChatService.generateAssistantResponseForModel()` 每次请求开始时临时创建，并通过 `providerOptions.mcpGetTools / mcpCallTool` 注入 provider 工具循环；请求结束后无显式销毁，生命周期随闭包结束。
- `McpClientManager.getToolsForModelContext()` 当前只返回内置 Tool Search server 的 3 个工具，不返回 38 个真实执行工具；真实工具只有在两阶段控制器调用 `find_tool` 后，才通过 `mcpGetTools()` 动态追加到 provider 可见集合。
- `McpClientManager.callTool()` 的调用分两类：
  - 内置 server：`ensureBuiltinRuntime(serverId)` -> `runtime.callTool(toolName, args)` -> in-memory MCP client -> `registerTextTool` handler。
  - 外部 server：`settings.mcp.servers` 找配置 -> `processManager.ensureConnected(config)` -> `McpClient.callTool()` -> JSON-RPC `tools/call`。
- 当前工具定义存储是三层：
  - `tool-library-seeds.ts`：人工维护摘要、场景、关键词、示例。
  - runtime `listTools()` / `TOOL_SEARCH_TOOL_CATALOG`：提供 description + inputSchema。
  - AI Data 目录下 Markdown：由 `ToolLibraryManager.bootstrapMissingFiles()` 生成，frontmatter 存 metadata，正文存补充说明。
- `ToolLibraryManager` 的索引完全是内存索引：`keywordIndex`、`scenarioIndex`、`categoryIndex`、`serverIndex`。`find_tool` 的核心评分是 exact keyword *100 + partial keyword *80 + scenario *50，没有模型参与。
- `delegate_to_agent` 只存在于 Vault server 的 util tools 中，底层是 `AgentRegistry`。当前 runtime 默认只注册 `builtin.echo`，返回 `{ id, task, status: 'ok' }`；没有更复杂的代理编排机制。
- 外部 MCP 工具通过 `McpProcessManager` + `McpClient` 发现：连接后走 `tools/list` 拉回 schema，`getAvailableTools()` 会把外部工具与内置工具合并，且同名时“内置优先、外部跳过”。
- provider 层并不统一：
  - OpenAI / Gemini fallback / Ollama / OpenRouter / DeepSeek / Qwen / Azure / Grok / Zhipu / SiliconFlow / Kimi / QianFan / Doubao 主要走 `withOpenAIMcpToolCallSupport()`，使用 OpenAI `tools` / `tool_calls` 兼容格式。
  - Claude 走 `withAnthropicMcpToolCallSupport()`，使用原生 `tool_use` / `tool_result` block。
  - Poe 有独立 Responses API 工具循环实现，但工具执行最终仍复用 `executeMcpToolCalls()`。
- 当前 `ChatMessage.toolCalls` 主要用于历史序列化/反序列化；运行时 MCP 工具结果更多是以内嵌标记 `{{FF_MCP_TOOL_START}}...` 存进 assistant content，再由 `MessageService` 转成 history callout。

### Open Questions
- 用户要求“41 个内置工具都写 ToolDefinition”，但新的 registry 目录结构只列了 Vault/Search/Memory/Thinking 4 组，共 38 个真实执行工具；是否将 Tool Search 3 个工具一并纳入 registry 作为 fallback 元数据，需要在实现时统一收口。
- ToolCallAgent 使用哪个 provider model tag 需要新增设置项和 UI，同时要避免对 Tab Completion 与多模型对比造成副作用。

### Implementation Outcome
- 已将 Tool Search 的 3 个工具一并纳入 `registry/tool-search-tools.ts`，作为 fallback / 后备元数据保留，因此 registry 语义上覆盖了 41 个内置工具。
- `McpClientManager.getToolsForModelContext()` 现在会在 tool-agent 可用时返回单一 `execute_task` 工具；否则继续返回旧的 Tool Search 三工具。
- `McpClientManager.callToolWithContext()` 新增了上下文感知执行入口，供 `ChatService` 在不改 `callTool()` 原签名的前提下，把 hints / constraints / selectedText / activeFile 等注入 tool-agent。
- `ChatService` 在 tool-agent 模式下不再创建 `chatTwoPhaseToolController`；旧控制器只在 fallback 或显式禁用 tool-agent 时启用。
- 运行时 fallback 已落在 `McpClientManager`：如果 `ToolCallAgent.execute()` 抛错，则自动使用旧 Tool Search + `chatTwoPhaseToolController` 路径执行一次子代理流程。

---

## Session: 2026-03-09 Ollama MCP 原生回退

### Research Findings
- 当前仓库里的 Ollama 一旦启用 MCP，就不会再走原生 `ollama.chat()`，而是强制进入 `withOpenAIMcpToolCallSupport()`，把 baseURL 变成 `/v1` OpenAI-compatible 端点。
- 本地安装的 `ollama` SDK 已明确支持原生 `tools`、`message.tool_calls`、以及工具结果消息里的 `tool_name` 字段，见 `plugin/node_modules/ollama/src/interfaces.ts` 与 README。
- 也就是说，Ollama 不需要依赖 `/v1` 才能做工具调用；现有问题更像是仓库把原生稳定路径替换成了兼容层路径。
- 原生 SDK 的 chat 协议与 OpenAI-compatible 协议不同：
  - 请求里是 `tools?: Tool[]`
  - 返回里是 `message.tool_calls?: ToolCall[]`
  - 工具执行结果回传给模型时，消息包含 `role: 'tool'` 与 `tool_name`
- 这意味着最小修复点应落在 `plugin/src/features/tars/providers/ollama.ts`，而不是 `mcpToolCallHandler.ts`。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 为 Ollama 单独实现原生 MCP 工具循环 | 保持其它 OpenAI-compatible provider 的现有逻辑不变 |
| 未启用 MCP 时继续走旧的原生流式回复实现 | 避免把普通对话链路也一并重写 |
| 更新 `plugin/src/types/ollama.d.ts` | 当前本地声明缺失 `tools` / `tool_calls` / `tool_name`，会降低后续维护可读性 |
