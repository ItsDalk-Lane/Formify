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
