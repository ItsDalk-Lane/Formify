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
