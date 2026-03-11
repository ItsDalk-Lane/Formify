# Task Plan: 修复执行条件弹窗下拉菜单点击无效

## Session: 2026-03-11 移除 Search/Vault MCP 并重组内置工具

### Goal
移除内置 Obsidian Search MCP 与 Vault MCP，收敛为单一 `core-tools` 内置工具组，并保持 `write_plan` 的 live plan 同步能力。

### Current Phase
Phase 4

### Phases
- [x] 梳理现有内置 MCP runtime、工具注册、设置和 Chat live plan 依赖
- [x] 新增 `core-tools` runtime，仅保留 `write_plan` / `execute_script` / `get_first_link_path` / `open_file` / `call_shell`
- [x] 移除 Vault/Search runtime 与对应 query/search/file/util 实现
- [x] 改造 `McpClientManager`、Chat 设置 UI、live plan 同步接口与兼容迁移
- [x] 补充针对性单测并完成构建/测试框架验证
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| `write_plan` 保持原名，不新增 `weite_plan` 别名 | 用户已确认 `weite_plan` 是现有 `write_plan` |
| 5 个保留工具聚合为一个新的内置服务 `__builtin__:core-tools` | 保持当前“按 server 管理工具”的 UI 和调用模型，改动最小 |
| 新 `builtinCoreToolsEnabled` 继承旧 `builtinVaultEnabled` | 新工具组本质上是 Vault 中保留下来的能力，旧 Search 开关不再有意义 |

## Goal
在 Obsidian 运行态中稳定复现“执行条件”弹窗的下拉菜单点击无效问题，定位真实根因并完成最小修复。

## Current Phase
Phase 4

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints
- [x] Document in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Use Obsidian CLI to reproduce the bug in runtime
- [x] Confirm whether the failure is caused by z-index, Dialog outside-interaction handling, or another event path
- **Status:** complete

### Phase 3: Implementation
- [x] Apply the minimal fix based on runtime evidence
- [x] Keep the diff isolated from unrelated workspace changes
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Reload the plugin in Obsidian and re-run the add-condition flow
- [x] Record verification results in progress.md
- **Status:** complete

### Phase 5: Delivery
- [ ] Review outputs
- [ ] Deliver to user
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 使用 Obsidian CLI 做运行态复现 | 仅靠静态代码推断已经连续两次命中不完整，需要直接在 Obsidian 中验证真实事件链 |
| 保留小 diff 策略 | 当前工作区有大量用户改动，必须把修复限定在相关文件 |
| 修复重点放在 `useForm` 反序列化链路 | 运行态异常表明问题发生在保存表单配置时，根因是编辑器拿到普通对象而不是 `FormConfig` 实例 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| 仅提升 `FilterDropdown` z-index 后问题仍存在 | 改为进入运行态复现，不再只依赖静态推断 |
| 运行态抛出 `removeInvalidActionIds is not a function` | 修复 `useForm` 反序列化，并在 `FormConfig.cleanupTriggerActionRefs()` 中补实例正规化防御 |

---

## Session: 2026-03-09 Obsidian 插件结构分析

### Goal
分析当前 Obsidian 插件项目的 AI Chat / Tars / MCP 架构，提取工具注册、模型配置、交互上下文、核心类型、历史存储与主流程，并保存为 Markdown 文档。

### Phases
- [x] 定位工具注册入口与默认启用的内置 MCP server
- [x] 提取模型配置链路与多模型对比机制
- [x] 提取用户交互入口、可用上下文与历史存储方案
- [x] 生成分析文档并写入 `docs/obsidian-plugin-analysis.md`
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| 不复用“Conversation / ModelConfig”字面名称 | 仓库中不存在这两个精确类型，应明确写出等价类型 `ChatSession` 与 `ProviderSettings/BaseOptions/Vendor` |
| 工具文档按 server 分组 | 实际注册和启用逻辑以内置 MCP server 为边界，按 server 组织最接近源码结构 |
| 返回值同时说明“逻辑值”与“MCP 文本封装” | `registerTextTool()` 会统一把结果序列化成文本，只写其中一层会误导读者 |

---

## Session: 2026-03-09 Tool Call Agent 重构

### Goal
完成 Tool Search 两阶段机制到 Tool Call Agent 的架构替换，保留 fallback，并为所有内置工具建立新的详细注册表。

### Current Phase
Phase 5

### Phases
- [x] 盘点真实源码路径，修正用户提示中的过期路径引用
- [x] 梳理两阶段工具调用、MCP 路由、provider 工具循环与工具库三层存储
- [x] 产出分析文档并锁定改造边界
- [x] 定义 tool-agent 类型与注册表类型
- [x] 实现详细注册表与 ToolCallAgent 核心模块
- [x] 集成 `McpClientManager` / `ChatService` / 设置项 / fallback
- [ ] 运行测试与类型检查
- **Status:** in_progress

### Decisions
| Decision | Rationale |
|----------|-----------|
| 先以源码真实目录为准重建链路 | 用户给出的部分路径已过期，例如 `features/tars/chat` 实际在 `features/chat/services` |
| 分析文档单独落盘 | 这是后续大改的设计输入，不能只留在上下文里 |
| fallback 保持原两阶段代码存在 | 用户明确要求失败时自动降级，不能先删旧链路 |

### Risks
| Risk | Mitigation |
|------|------------|
| 41 个工具定义的工作量很大且容易漏字段 | 先从 runtime 注册点抽全量工具清单，再批量编写 registry |
| 新子代理若直接依赖 `ChatService` 会破坏模块边界 | 改为通过注入 provider/mcp manager/context builder 等依赖实现 |
| 主模型只暴露一个工具后，历史工具调用显示可能退化 | 保持 `ChatMessage.toolCalls` 与现有 callout 序列化格式兼容 |

---

## Session: 2026-03-09 Ollama MCP 原生回退

### Goal
让 Ollama 的 MCP 工具调用直接回退到原生 `/api/chat`，不再依赖 `/v1/chat/completions` 兼容层。

### Current Phase
Phase 1

### Phases
- [x] 确认当前回归点与现状
- [x] 实现原生 `ollama.chat(... tools ...)` 工具循环
- [x] 补齐本地类型声明与回归测试
- [x] 运行针对性验证
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| 不改通用 `withOpenAIMcpToolCallSupport()` | 仅 Ollama 需要脱离 `/v1` 兼容层，改通用包装器会扩大影响面 |
| Ollama 工具结果按原生 `tool` 角色 + `tool_name` 回传 | 这正是本地 SDK 和 README 已声明的原生协议 |

---

## Session: 2026-03-10 意图识别柔性化与澄清闭环重构

### Goal
重构 `intent-agent` 链路，新增共享消息语义分析、自然语言路径解析、定向澄清与澄清后完整重识别闭环。

### Current Phase
Phase 2

### Phases
- [x] 复核现有 `IntentAgent` / `ContextAssembler` / `ShortcutRules` / `IntentResultValidator` / `ChatService` 实现
- [x] 锁定最小改动面与回归测试入口
- [x] 实现共享消息语义分析与路径解析
- [x] 接入快捷规则、提示词、验证器与会话澄清闭环
- [x] 补齐单测并做针对性验证
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| 不新增用户设置项 | 用户明确要求继续沿用现有 `confidenceThreshold` |
| 先做共享 `messageAnalysis`，再让规则/提示词/验证器复用 | 避免各层重复做不一致的推断 |
| 澄清状态只存在会话内，不落历史 frontmatter | 用户明确要求不持久化 pending clarification |
| 不以全量 `tsc --noEmit` 作为回归门禁 | 当前仓库锁定的 TS 4.7 与部分第三方声明不兼容，会产生无关错误 |
| 保留原生普通流式回复路径 | 未启用 MCP 时继续复用现有 `sendRequestFuncBase`，避免不必要回归 |

---

## Session: 2026-03-10 AI Chat 设置弹窗二次调整

### Goal
把内置工具从 `MCP 服务器` 标签中拆出到独立 `工具` 标签，并把 `子代理配置` 改造成 `子代理` 列表 + 详情配置视图。

### Current Phase
Phase 1

### Phases
- [x] 复核当前 `ChatSettingsModal`、MCP 列表与子代理平铺表单实现
- [x] 重构标签页结构，新增 `工具` 标签并将 MCP 页收敛为外部服务器列表
- [x] 将 `子代理` 页改为列表入口 + 详情配置
- [x] 补齐样式、i18n 与针对性测试
- [x] 运行构建校验并记录结果
- **Status:** complete

---

## Session: 2026-03-10 工具调用共享配置收敛

### Goal
把 `MCP 服务器` 与 `子代理` 中分散的工具调用次数 / 超时时间收敛为一套共享设置，并移动到 `AI 助手 -> 高级` 分组。

### Current Phase
Phase 1

### Phases
- [x] 盘点工具调用次数 / 超时时间的真实存储结构与运行时读取点
- [x] 在 `TarsSettings` 中增加共享工具调用设置及兼容旧字段的同步逻辑
- [x] 从 `ChatSettingsModal` 移除重复配置，并在 `settingTab.ts` 的高级分组新增共享配置入口
- [x] 补充 i18n 与针对性测试
- [x] 运行构建 / 测试框架 / diff 校验
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| 新增顶层 `toolExecution` 作为共享设置源 | 只靠 UI 同步写旧字段，后续仍可能在运行时重新分叉 |
| 保留 `mcp.maxToolCallLoops` 与 `toolAgent.defaultConstraints.{maxToolCalls, timeoutMs}` 作为兼容字段 | 这样能最小化改动已有调用链，同时让旧配置自动迁移 |
| `ChatService.persistMcpSettings()` / `persistToolAgentSettings()` 保存时再次同步共享配置 | 避免聊天设置弹窗里改其他字段时把旧的次数/超时值写回去 |

### Errors Encountered
| Error | Resolution |
|-------|------------|
| 当前仓库没有可直接发现的 Jest 配置或脚本入口 | 保留新增测试文件，并以现有 `npm run test:framework` + `npm run build` 作为本次可执行验证 |

### Decisions
| Decision | Rationale |
|----------|-----------|
| 不修改 `ChatService` 的设置持久化接口 | 当前需求只改变 UI 结构，底层配置读写模型不需要扩散修改 |
| `工具` 标签复用现有内置 MCP 卡片与工具列表弹窗 | 这样可以最小化改动，同时把内置能力与外部 MCP 服务器清晰分开 |
| `子代理` 使用列表 + 详情视图，而不是再开二级 modal | 用户明确要求在当前页面内先展示代理列表，再进入具体配置界面 |

### Errors Encountered
| Error | Resolution |
|-------|------------|
| `planning-with-files` 技能文档中的 `session-catchup.py` 默认路径不存在 | 改为手动检查现有 `task_plan.md` / `findings.md` / `progress.md`，继续在项目根维护记录 |

---

## Session: 2026-03-11 提示词驱动统一子代理重构

### Goal
移除工具调用与意图识别子代理中的本地硬编码理解链路，把规则迁入系统提示词，并把两者统一到同一套共享子代理底座。

### Current Phase
Phase 5

### Phases
- [x] 新增共享 `SubAgentRunner`，统一模型调用、JSON 解析、可选工具注入与超时控制
- [x] 收瘦 `intent-agent`，删除 `ShortcutRules` / `TriggerSourceRules` / `IntentResultValidator` / `message-analysis`
- [x] 收瘦 `tool-agent`，删除 `ToolSelector` / registry 预选 / legacy two-phase fallback
- [x] 改造 `ChatService` / `McpClientManager` 接入，改为模型返回的 relation / routing 驱动
- [x] 更新设置类型、设置页、i18n 与针对性测试，并完成构建验证
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| 硬编码移除范围按“只留安全层”执行 | 用户明确要求把用户需求理解全部交给模型，本地仅保留工具安全与控制通道 |
| 不保留 legacy fallback | 用户明确要求移除旧链路，不再回退 `find_tool` / 两阶段控制器 |
| UI 保留“意图识别 / 工具调用”双入口 | 用户明确要求只统一底层，不把设置页改成通用代理列表 |
| `intent-agent` 不再输出 validator 修正后的富规则结构 | 目标是让模型直接给出最终 routing 决策，避免再回落到本地推断 |
| `tool-agent` 直接接收允许工具全集，不再做 registry 打分预选 | 工具选择逻辑迁回模型理解，避免继续本地解析任务语义 |
| Tool Search 与本地工具说明库一起移除 | 用户明确要求连 `FeatureCoordinator` 中的装配、本地说明文件和相关设置一起下掉 |

---

## Session: 2026-03-11 移除 Intent / Tool 子代理及其配置

### Goal
删除 `intent-agent`、`tool-agent`、`sub-agent` 运行时与设置入口，让聊天请求直接进入主聊天链路，并把 MCP 工具重新直接暴露给主模型。

### Current Phase
Phase 3

### Phases
- [x] 复核运行时、设置、UI、i18n 和测试中的子代理入口
- [x] 删除子代理模块、设置项、聊天分支与 MCP `execute_task` 包装
- [x] 更新兼容清理逻辑与相关测试，并完成构建验证
- [x] 交付说明
- **Status:** complete

### Decisions
| Decision | Rationale |
|----------|-----------|
| legacy `toolAgent` / `intentAgent` 仅保留“读取不报错，保存时清理” | 用户要求兼容旧配置，但不再保留这些字段作为运行时来源 |
| `ChatService.sendMessage()` 直接走既有主聊天发送链路 | 用户明确要求移除意图识别、澄清、确认等子代理分支 |
| `McpClientManager.getToolsForModelContext()` 直接返回真实 MCP 工具集合 | 用户明确要求取消 `execute_task` 包装与子代理宿主拦截 |
| 不引入替代性的 shell/script 宿主限制 | 用户明确要求一起移除 `allowShell` / `allowScript` 这层配置与执行宿主 |

### Errors Encountered
| Error | Resolution |
|-------|------------|
| `npm run test -- --runInBand ...` 不可用，`plugin/package.json` 没有 `test` script | 改为使用 `npm run build` 做可执行构建验证，并补充定向静态检查 |
| `npx tsc --noEmit` 失败于 `zod` / `@types/d3-dispatch` 等第三方声明 | 记录为仓库既有 TypeScript 4.7 兼容性问题，不作为本次改动回归阻塞 |
| 当前环境缺少可直接运行的本地 ESLint 可执行文件，`npm exec` 默认拉起 ESLint 10 又与 `.eslintrc` 不兼容 | 记录为环境/基础设施问题，不把 lint 作为本次门禁 |
