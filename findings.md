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
