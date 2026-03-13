# Findings & Decisions

## Session: 2026-03-13 Filesystem MCP 工具补齐

### Research Findings
- `filesystem-mcp-server.ts` 当前已经具备路径归一化、目录递归、glob 排除、diff 预览和基础 metadata 读取能力，但还没有删除、内容 grep 或 Vault 查询能力。
- `plugin/src/builtin-mcp/tools/helpers.ts` 已有 `resolveRegex()`，但只支持 `new RegExp(value)`，无法正确处理 `/pattern/flags` 这类 JavaScript 正则字符串。
- Obsidian 原生类型已提供 `vault.delete(file, force)`、`metadataCache.getFileCache(file)`、`CachedMetadata.tags/frontmatter/listItems`，足以支撑删除、标签统计、属性统计和任务索引。
- `ListItemCache.task` 可区分任务完成状态，`position.start.line` 可回溯任务所在行号；结合 `cachedRead()` 可恢复任务原文。
- 当前 builtin MCP 工具描述本身就是直接写在 runtime 里的中文字符串，不走全局 i18n；因此本次不会新增设置页或 UI 国际化入口。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 为 `list_directory` 和 `search_content` 共用“JavaScript 正则字符串”解析逻辑 | 避免一个工具支持 `/.../i`，另一个不支持，降低模型调用歧义 |
| `search_files` 达到 `maxResults` 后在结果文本尾部显式提示可能还有更多匹配项 | 这是用户明确要求的返回语义，且不破坏现有“按行列出路径”的消费方式 |
| `query_vault` 的 `property` / `tag` 数据源按聚合结果建模，`task` / `file` 按明细记录建模 | 这样最贴近用户要求的数据源定义，也能让聚合函数继续叠加使用 |

## Session: 2026-03-13 移除 Fetch/Memory/Sequential Thinking 内置工具

### Research Findings
- 当前用户可见入口集中在 `plugin/src/features/chat/components/ChatSettingsModal.tsx` 的内置工具卡片，以及 `chatSettingsHelpers.ts` 对内置 server 列表的组装。
- 运行时接入点集中在 `plugin/src/features/tars/mcp/McpClientManager.ts`；只要从 descriptor 列表移除 server，工具发现、启停和状态汇总都会同步消失。
- 配置残留不只在 `McpSettings` 类型里，还分散在 `cloneTarsSettings()`、`SettingsManager.cleanupLegacyAIStorage()` 和 `SettingsManager.save()`；如果不一起清理，旧 `data.json` 仍会把废字段写回去。
- `turndown` 与 `@types/turndown` 仅被 `fetch-mcp-server.ts` 使用，删除 Fetch runtime 后已经没有其他源码引用。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 保留 SettingsManager 中对已删除字段的显式 `delete` | 这样能兼容已有用户配置，并确保下一次保存时废字段不会复活 |
| 继续保留 “工具” 标签页，只缩减为 Core Tools / Filesystem / Time 三组内置工具 | 用户只要求移除 3 组工具，不需要整个 UI 区块消失 |
| 删除对应 runtime 源码与 helper test，而不是仅仅停用开关 | 用户明确要求“移除代码、UI、功能”，仅停用会留下大量死代码 |

## Session: 2026-03-11 移除 Search/Vault MCP 并重组内置工具

### Research Findings
- 当前内置 MCP 的分组粒度完全是“server 级”，`ChatSettingsModal`、`McpModeSelector`、`McpClientManager` 都没有“单工具级”启停模型。
- `write_plan` 当前并不只是 Vault 工具之一；它还驱动 `McpClientManager` 的计划快照、`ChatService` 的 live plan 面板和历史 frontmatter 持久化。
- 要移除 Vault MCP，必须同步替换这组接口的语义，否则仓库里会残留大量 `VaultPlan` 命名和 serverId 绑定。
- `builtin-mcp/query-engine/*`、`search-engine/*`、`file-tools.ts`、`query-tools.ts`、`obsidian-search-tools.ts`、`util-tools.ts` 都只被旧 Vault/Search runtime 使用，删除后不会影响其他模块。
- 现有设置加载链路通过 `cloneTarsSettings()` 统一归一化，因此旧 `builtinVaultEnabled` -> 新 `builtinCoreToolsEnabled` 的迁移，放在 `features/tars/settings.ts` 最稳妥。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 新增 `core-tools-mcp-server.ts`，而不是继续复用 `vault-mcp-server.ts` 改名不改义 | 直接消除“已删除 Vault MCP，但代码仍叫 vault”的语义残留 |
| 将 live plan 同步 API 统一改为 `get/on/syncLivePlan*` | 避免继续把计划状态与已删除的 Vault server 强耦合 |
| 旧字段清理同时放在 `cloneTarsSettings()` 与 `SettingsManager.save()` | 既兼容加载旧配置，也避免下次保存时把废弃字段写回 data.json |

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

---

## Session: 2026-03-10 意图识别柔性化与澄清闭环重构

### Research Findings
- `IntentResultValidator` 内部硬编码了 `0.5` 置信度阈值，而 `ChatService` 外层又按设置项 `confidenceThreshold` 再做一次降级，形成双重保守处理。
- `ContextAssembler` 当前只收集 Obsidian 状态，没有对用户消息做任何结构化语义提取；`PromptBuilder` 也只是把原始上下文直接串给模型。
- `ShortcutRules` 依赖句首关键词和显式选中文件/文件夹，无法处理“给我总结 000 号文件夹中所有文件的内容”这类自然语言路径引用。
- `TriggerSourceRules` 目前把 `triggerSource` 当成硬门槛，而不是辅助信号。
- `ChatService` 只有 `pendingIntentConfirmation`，没有保存待澄清意图，因此用户补充说明后不会重新跑完整意图识别链路。
- 仓库已有可复用的 Vault 搜索/路径数据来源：
  - `app.vault.getFiles()` / `getAllLoadedFiles()` 可枚举文件与文件夹
  - `metadataCache.getFirstLinkpathDest()` 可解析 wiki-link
  - `builtin-mcp/search-engine/search-engine.ts` 已证明仓库允许在内存里同时处理文件和文件夹匹配
- 最快的全量类型检查 `cd /Users/study_superior/Desktop/Code/Formify/plugin && npx tsc -p tsconfig.json --noEmit` 当前失败于第三方类型声明（`zod v4`、`@types/d3-dispatch`）与仓库锁定的 TypeScript 4.7.4 兼容性，而不是本次任务代码本身。

### Implementation Direction
- 新增共享 `messageAnalysis`，集中输出动作归一化、目标引用、路径候选、歧义原因与复合意图标记。
- 重写快捷规则为候选打分模型，但保持对现有 greeting / memory / continue 等高置信捷径的兼容。
- 让 `IntentResultValidator` 成为唯一的阈值与澄清落地位置，并消费 `messageAnalysis` 做修正。
- 在 `ChatService` 增加 `pendingIntentClarification`，把澄清后的补充回答与原请求合并后重新识别。

### Implementation Outcome
- 最终保留了 `TriggerSourceRules` 类，但语义已经从“硬门槛规则”降级为“高权重候选生成器”。
- `messageAnalysis` 没有直接决定最终 `IntentResult`，而是作为 `ShortcutRules`、`PromptBuilder`、`Validator` 和 `ChatService` 的共享事实层。
- 针对“上一级目录里的日报”这类请求，没有强行猜具体文件；规则与验证器都会把它识别为需要先做目录内发现的搜索型请求。
- `pendingIntentClarification` 只保存在 `ChatSession` 内存态和 `saveSessionState/restoreSessionState` 深拷贝中，没有写入历史 frontmatter，符合任务约束。

---

## Session: 2026-03-10 AI Chat 设置弹窗二次调整

### Research Findings
- 当前 `ChatSettingsModal` 的标签为 `AI Chat / 系统提示词 / MCP 服务器 / 子代理配置`，其中 `MCP 服务器` 同时展示内置与外部服务器，内置项的操作按钮会打开工具列表弹窗。
- 当前 `子代理配置` 标签直接平铺渲染了 Tool Call Agent 与 Intent Agent 两整块表单，没有列表层级。
- `ChatService` 已经提供 `persistMcpSettings`、`persistToolAgentSettings`、`persistIntentAgentSettings`，因此这次重构不需要改动设置持久化接口。
- 现有 `BuiltinMcpToolsModal` 已从 `settingTab.ts` 抽到 `plugin/src/features/tars/mcp/McpConfigModals.ts`，可以直接复用到新的 `工具` 标签。
- 当前 `tab_sub_agents` 文案仍是“子代理配置”，`mcp_settings_no_external_servers` 的文案也还在暗示“上方列出全部内置服务器”，需要一并调整。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| `MCP 服务器` 标签只保留外部服务器列表与新增/导入能力 | 这样可以直接实现“区分内置和外部 MCP” |
| 新增 `工具` 标签承载内置 MCP server 卡片 | 内置能力目前正是通过 server 分组暴露工具列表，按 server 列表展示最符合现有结构 |
| `子代理` 标签先展示代理列表，再在当前标签内切到详情表单 | 保持交互简单，且不需要新增更多 modal 状态管理 |

### Implementation Outcome
- `ChatSettingsModal` 现在的标签顺序变为 `AI Chat / 系统提示词 / MCP 服务器 / 工具 / 子代理`。
- `MCP 服务器` 标签只显示外部 MCP 服务器，并保留新增、手动配置、导入与 `maxToolCallLoops` 设置。
- `工具` 标签承载 5 个内置 MCP server 卡片；每张卡保留启用开关和“查看工具列表”按钮。
- `子代理` 标签不再直接平铺表单，而是先显示 Tool Call Agent / Intent Agent 两个代理卡片，再通过“配置”按钮进入各自详情表单。
- 新增了用于内置工具列表与子代理状态显示的纯工具函数，并补了对应测试。

---

## Session: 2026-03-10 工具调用共享配置收敛

### Research Findings
- 当前“工具调用次数 / 超时时间”实际分散在三处：
  - `mcp.maxToolCallLoops`
  - `toolAgent.defaultConstraints.maxToolCalls`
  - `toolAgent.defaultConstraints.timeoutMs`
- `ChatService`、`McpClientManager` 与 `FeatureCoordinator` 都各自读取这些旧字段，单纯移动 UI 会导致运行时继续分叉。
- `ChatSettingsModal` 虽然已移除旧设置页入口，但它仍会整体持久化 `mcp` / `toolAgent` 对象；如果不在保存路径做同步，切换别的开关也可能把旧的次数/超时值写回去。
- 当前 `plugin/` 里存在 Jest 风格测试文件，但没有可直接发现的 `jest.config.*` 或 package script；可执行验证入口仍是 `npm run build` 与 `npm run test:framework`。

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 在 `features/tars/settings.ts` 中新增 `toolExecution`、`resolveToolExecutionSettings()`、`syncToolExecutionSettings()` | 让 UI、默认值、迁移兼容和运行时读取共享同一套逻辑 |
| `FeatureCoordinator` 给 `McpClientManager` 注入共享工具调用设置 getter | 避免 fallback 子代理继续读旧字段 |
| 共享配置只在 `AI 助手 -> 高级` 提供编辑入口 | 满足“共用一个配置项”要求，并消除聊天设置弹窗中的重复入口 |

### Implementation Outcome
- `settingTab.ts` 的“高级”分组新增了两项共享设置：工具调用最大次数、工具调用超时时间。
- `ChatSettingsModal.tsx` 已移除 `MCP 服务器` 页的最大循环次数输入，以及 `Tool Call Agent` 详情页里的最大工具调用次数 / 超时时间输入。
- 运行时默认读取统一收敛到 `resolveToolExecutionSettings()`；旧配置会在 clone/save 路径中自动同步。

---

## Session: 2026-03-11 提示词驱动统一子代理重构

### Research Findings
- `IntentAgent` 与 `ToolCallAgent` 当前已经共享了最底层的 provider 调用模式，但仍各自保留了一层本地业务推断：
  - `intent-agent`: `ShortcutRules`、`TriggerSourceRules`、`MessageSemanticAnalyzer`、`IntentResultValidator`
  - `tool-agent`: `ToolSelector`、registry 元数据增强、`executeTaskWithLegacyTwoPhase()` fallback
- `ChatService` 里仍有两段本地意图推断：
  - `preparePendingIntentClarification()` 通过 `contextAssembler.analyzeMessage()` 判断当前输入是不是“新独立请求”
  - `prepareImplicitIntentFollowUp()` 通过 `SUPPLEMENTAL_FOLLOW_UP_PATTERN` 和 `analyzeMessage()` 判断“补充说明/改成...”
- `buildToolAgentRequestContext()` 当前严重依赖 `intentResult.routing.toolHints` 与 `understanding.target.paths`，意味着只删 `ToolSelector` 不够，必须同步削减 `IntentResult` 结构。
- `McpClientManager` 当前在 tool-agent 失败时仍会自动回退 `executeTaskWithLegacyTwoPhase()`，而该链路会再次依赖 `find_tool` 与 `chatTwoPhaseToolController`。
- `FeatureCoordinator` 仍会初始化 `ToolLibraryManager` 并传给 `McpClientManager`，这使 Tool Search 相关运行时仍是聊天主链路的一部分。
- `ChatSettingsModal` 当前暴露了 `intentAgent.shortcutRulesEnabled` 和 `confidenceThreshold`，这些设置是旧硬编码设计的直接投影，必须随运行时一起移除。

### Implementation Direction
- 新增共享 `SubAgentRunner`，让 “模型调用 + JSON 解析 + 可选工具循环” 变成统一底座。
- `ContextAssembler` 改成只收集上下文事实，不再做用户语义解析；由 intent prompt 直接理解这些事实。
- 意图子代理新增 `requestRelation` 一类字段，用模型结果取代本地“新请求 / 澄清回答 / 需求补充”判断。
- 工具调用子代理改为真实工具全集直通，保留 `SafetyChecker` 与 `ResultProcessor` 作为唯一非提示词约束。
- Tool Search 与 `ToolLibraryManager` 一并移除，避免继续保留本地工具说明文件、Tool Search server 与相关设置开关。

### Implementation Outcome
- 新增 `plugin/src/features/sub-agent/SubAgentRunner.ts` 与配套类型，统一了 provider 解析、超时/abort、可选工具注入和 JSON 响应解析。
- `IntentAgent` 现已改为纯提示词驱动：`ContextAssembler` 只收集上下文快照，`IntentAgentPromptBuilder` 直接描述规则，`IntentAgent` 只做最薄的 schema 正规化。
- `ToolCallAgent` 现已改为真实工具集合直通，删除 `ToolSelector`、registry 预选与 legacy two-phase fallback，仅保留 `SafetyChecker` 和 `ResultProcessor` 作为宿主侧约束。
- `ChatService` 已移除基于 `messageAnalysis` / 正则的本地补充说明判断，改为把 pending clarification 与上下文交给 intent 模型，并消费 `requestRelation` 决定请求合并方式。
- `McpClientManager` 已彻底移除 Tool Search：不再注册内置 Tool Search server，也不再保留 `searchToolLibrary()` / `getToolLibraryEntry()` 这类工具库查询接口。
- 设置与文案已同步收口：删除 `intentAgent.shortcutRulesEnabled`、`confidenceThreshold` 及对应中英繁文案，工具执行子代理“留空回退传统模式”的描述也已移除。
- `FeatureCoordinator` 已不再初始化 `ToolLibraryManager`；`AIPathManager` 也不再创建 `tool-library` 目录，设置页的内置工具列表同步减少为 4 个 builtin server。
