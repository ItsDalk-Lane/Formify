# Task Plan: 修复执行条件弹窗下拉菜单点击无效

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
| 保留原生普通流式回复路径 | 未启用 MCP 时继续复用现有 `sendRequestFuncBase`，避免不必要回归 |
