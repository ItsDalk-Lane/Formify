# Progress Log

## Session: 2026-03-07

### Current Status
- **Phase:** 1 - Requirements & Discovery
- **Started:** 2026-03-07

### Actions Taken
- 阅读 Obsidian CLI 文档，确认可通过 `obsidian` 命令进行插件重载、截图、执行命令和开发调试。
- 检查了 `FilterDropdown`、`Dialog2`、`CpsFormAction`、`StartupConditionEditor` 的静态实现。
- 已进行两次代码修复尝试，但用户反馈运行态问题仍存在。
- 初始化 `task_plan.md`、`findings.md`、`progress.md`，准备进入运行态复现。
- 使用 Obsidian CLI 打开 `/Users/study_superior/Desktop/沙箱仓库/System/formify/编辑.cform`，进入编辑态并展开“提交动作设置 -> 执行条件”弹窗。
- 使用 CDP 真实鼠标事件点击“添加条件”菜单，确认菜单项能命中，并抓到运行时异常 `removeInvalidActionIds is not a function`。
- 修复 `useForm.tsx` 的反序列化问题，并在 `FormConfig.cleanupTriggerActionRefs()` 中增加 `ActionTrigger` 实例正规化。
- 新增 `FormConfig.test.ts`，覆盖 plain-object `actionTriggers` 的回归场景。
- 执行 `npm run build:local` 同步到实际 vault，并用 Obsidian CLI 重新验证。

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 静态修复 1：提升 `FilterDropdown` 菜单层级 | 菜单项可点击 | 用户反馈仍不可点击 | failed |
| 静态修复 2：放行 `Dialog2` 对 Radix popper 的 outside 事件 | 菜单项可点击 | 用户反馈仍不可点击 | failed |
| Obsidian CLI + CDP 点击“添加条件”前的命中测试 | 菜单项上层不应被遮罩覆盖 | 最上层元素是 `.form--FilterDropdownMenuItem` | passed |
| Obsidian CLI 运行态错误检查（修复前） | 点击菜单项后无异常 | 抛出 `removeInvalidActionIds is not a function` | failed |
| `npm run build:local` | 构建并同步成功 | 成功 | passed |
| Obsidian CLI + CDP 点击“添加条件”（修复后） | 新增普通条件且无错误 | 新增成功，错误缓冲为空 | passed |
| Obsidian CLI + CDP 点击“添加时间条件”（修复后） | 新增时间条件且无错误 | 新增成功，错误缓冲为空 | passed |
| Obsidian CLI + CDP 点击“添加文件条件”（修复后） | 新增文件条件且无错误 | 新增成功，错误缓冲为空 | passed |

### Errors
| Error | Resolution |
|-------|------------|
| 仅靠静态代码分析无法命中真实根因 | 改为使用 Obsidian CLI 在运行态中复现和观察 |
| `obsidian eval` 的 Promise 返回值不会直接打印 | 改为使用同步查询或先写入 `window` 再读取 |
| 多标签页/模态框导致截图可能落在错误视图 | 切回目标 leaf，并用 active leaf 选择器和 CDP 坐标进行验证 |

---

## Session: 2026-03-09

### Current Status
- **Phase:** 插件结构分析与文档生成
- **Started:** 2026-03-09
- **Status:** complete

### Actions Taken
- 读取 `plugin/src/main.ts`、`FeatureCoordinator.ts`，确认 AI Chat、Tars、MCP 的启动顺序与入口。
- 读取 `builtin-mcp` 下各 server 与工具注册文件，统计出 5 个默认启用的内置 server 与 41 个注册工具。
- 读取 `chat/types`、`tars/providers/index.ts`、`tars/settings.ts`，提取消息、会话、模型配置相关核心类型。
- 读取 `ChatService`、`PromptBuilder`、`HistoryService`、`MultiModelChatService`，梳理从用户输入到模型调用再到历史落盘的主流程。
- 读取 `settingTab.ts` 与 `SettingsManager.ts`，确认模型列表来源、API Key 存储方案、多模型对比组与配置持久化方式。
- 写入输出文档 `docs/obsidian-plugin-analysis.md`。

### Deliverables
| File | Purpose | Status |
|------|---------|--------|
| `docs/obsidian-plugin-analysis.md` | 本次源码分析结果 | passed |

---

## Session: 2026-03-09 Tool Call Agent 重构

### Current Status
- **Phase:** 1 - Architecture Analysis
- **Started:** 2026-03-09
- **Status:** in_progress

### Actions Taken
- 读取 `chatTwoPhaseToolController.ts`，确认两阶段控制器只在单次 `generateAssistantResponseForModel()` 中创建，并通过闭包维护动态工具集。
- 读取 `McpClientManager.ts`，确认主模型当前只注入 Tool Search 三个工具，真实工具通过两阶段控制器二次放出。
- 读取 `mcpToolCallHandler.ts` 与 `providers/claude.ts` / `providers/gemini.ts` / `providers/openAI.ts`，确认 provider 层的工具协议分为 OpenAI-compatible、Anthropic 原生与 Poe Responses 三条实现线。
- 读取 `tool-library-seeds.ts`、`tool-library-manager.ts`、`tool-search-mcp-server.ts`，确认现有工具库是“seed + runtime schema + markdown frontmatter/body”三层结构，`find_tool` 为纯算法评分。
- 读取 `vault-mcp-server.ts`、`memory-mcp-server.ts`、`obsidian-search-mcp-server.ts`、`sequentialthinking-mcp-server.ts` 及各工具注册文件，确认真实执行工具分布与 schema 来源。
- 更新 `task_plan.md` / `findings.md`，把当前任务的分析结论落盘。

### Pending
- 补充最后的验收说明与剩余风险
- 视需要补 Tool Agent 独立单测

### Notes
- 用户给出的部分源码路径已过期，后续实现必须以当前仓库真实路径为准。
- `toolCalls` 历史兼容不是自动现成的，需要在新链路里显式维护。

### Update: 2026-03-09 Tool Call Agent 实现推进

#### Completed
- 新建 `plugin/src/features/tool-agent/` 模块，包含 `ToolCallAgent`、`ToolSelector`、`SafetyChecker`、`ResultProcessor`、`ToolCallAgentPromptBuilder` 与 registry。
- 按 server 拆分写入详细工具定义：Vault、Search、Memory、Sequential Thinking，以及 Tool Search fallback 元数据。
- 在 `McpClientManager` 中加入 `execute_task` 路由，新增 `callActualTool()` 直通真实 MCP，保留原始工具执行链路不变。
- 在 `ChatService` 中切换主模型注入逻辑：tool-agent 可用时只暴露 `execute_task`；不可用时继续走旧两阶段控制器。
- 新增 Tool Agent 设置项与设置面板入口，支持启用开关、模型 tag、max tool calls、timeout、shell/script 默认约束。
- 实现运行时 fallback：`execute_task` 失败时，在 `McpClientManager` 内部自动降级到旧的两阶段 MCP 子流程。

#### Verification
- `pnpm -C plugin build` 通过，说明 esbuild 构建链路未被本次改动打断。
- 使用临时 TypeScript 5 做文件级筛查时，tool-agent / manager / coordinator 这批新增接缝未再出现新增错误。

#### Known Gaps
- 仓库本身存在大量历史 TypeScript 错误，导致无法给出“全仓 `tsc --noEmit` 通过”的结论。
- 还未补 Tool Agent 独立单测；当前验证以静态检查 + 构建通过为主。

---

## Session: 2026-03-09 Ollama MCP 原生回退

### Current Status
- **Phase:** 1 - Discovery / Implementation
- **Started:** 2026-03-09
- **Status:** in_progress

### Actions Taken
- 读取 `plugin/src/features/tars/providers/ollama.ts`，确认当前 MCP 路径强制经过 `/v1` OpenAI-compatible 包装器。
- 检查本地 `ollama` SDK 源码与 README，确认原生 `ollama.chat()` 已支持 `tools`、`tool_calls` 与 `tool_name`。
- 记录回归根因与实施边界到 `task_plan.md` / `findings.md` / `progress.md`。

### Pending
- 无

### Verification
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `node plugin/scripts/provider-regression.mjs --pr=23` | 历史 provider 回归 + 新增 Ollama 原生 MCP 回归全部通过 | 通过 | passed |
| `npm run build`（`plugin/`） | 插件成功打包，无语法/构建错误 | 通过 | passed |

### Outcome
- `plugin/src/features/tars/providers/ollama.ts` 已不再依赖 `/v1` OpenAI-compatible MCP 包装器。
- Ollama 在存在 `mcpTools + mcpCallTool` 时会直接走原生 `ollama.chat(... tools ...)`。
- 工具结果已按原生协议回传：`role: 'tool'` + `tool_name`。
- `plugin/src/types/ollama.d.ts` 与 `plugin/scripts/provider-regression.mjs` 已同步更新。
