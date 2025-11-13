## 目标与范围
- 完成三大增强：AI服务商添加流程优化、批量操作能力、条件判断系统扩展（文件/字符串/数组/周期性时间）。
- 保持向下兼容，不改变现有行为与数据结构；新增能力以最小侵入方式集成。

## 架构定位
- Obsidian 插件主入口与设置：`plugin/src/main.ts`、`plugin/src/settings/PluginSettingTab.tsx`。
- AI服务商（Tars）设置与UI：`plugin/src/features/tars/settingTab.ts`、`plugin/src/features/tars/modal.ts`、`plugin/src/features/tars/settings.ts`。
- 表单编辑与执行：字段/动作编辑 UI 在 `plugin/src/view/edit/setting/**`，条件编辑 UI 在 `plugin/src/view/shared/filter-content/**`。
- 条件系统：模型与服务在 `plugin/src/model/filter/*`、`plugin/src/service/filter/*`，操作符处理器在 `plugin/src/service/filter/handler/**`。

## 功能一：AI服务商添加流程优化
- 现状与问题
  - 新增服务商后仅展开列表，未自动弹出配置弹窗；`createProviderSetting(index, settings, isOpen)` 的 `isOpen` 未被使用。
  - 参考文件位置：`plugin/src/features/tars/settingTab.ts:77-96`（添加流程）、`plugin/src/features/tars/settingTab.ts:598-720`（卡片与弹窗触发）、`plugin/src/features/tars/settingTab.ts:725-919`（配置与保存）。
- 改进点
  - 选择服务商后，自动打开对应的配置弹窗；弹窗内保留“保存”按钮与校验反馈。
  - 消费 `isOpen` 参数，首次渲染时触发一次 `openConfigModal()`，并记录 `currentOpenProviderIndex`，避免重渲染重复弹窗。
- 技术实现（不破坏现有逻辑）
  - 在添加流程中，保存与重新渲染后，直接调用 `ProviderSettingModal` 打开新增项配置（索引为 `providers.length-1`）。
  - 在 `createProviderSetting()` 中使用 `isOpen` 调用 `openConfigModal()` 一次，并维护 `currentOpenProviderIndex` 生命周期。
- 验证
  - 新增任意服务商后自动弹窗；填写必要项，点击“保存”提示成功并持久化；关闭弹窗后不重复弹出。

## 功能二：批量操作功能实现
- 目标
  - 支持“批量添加（模板库）”与“批量删除（多选+确认+依赖分析）”两类操作，覆盖字段与动作两域。
- 数据与逻辑
  - 引入批量事务引擎（BatchEngine）概念：批量操作的 `precheck/apply/rollback/audit` 流程；不改现有单项操作 API。
  - 依赖索引与影响图（ImpactGraph）：分析动作→字段、字段→动作的依赖关系，提供删除策略（仅删除/软删除/级联删除）。
- UI设计
  - 在 `CpsFormFields.tsx` 与 `CpsFormActions.tsx` 增加“多选模式”和“上下文工具条”（全选/反选、批量添加、批量删除）。
  - 模板选择弹窗：分类、搜索、预览与参数定制（命名前缀、分组、触发绑定）。
  - 删除影响弹窗：列出影响清单与策略选择，二次确认。
- 性能与事务
  - 大批量使用索引与Set加速，操作分批提交；失败回滚到快照，支持撤销/重做队列。
- 验证
  - 100+对象批处理在毫秒级反馈；审计摘要显示成功/失败/跳过计数；撤销生效。

## 功能三：条件判断系统扩展
- 操作符扩展矩阵
  - 文件相关：`file_exists/file_not_exists/file_size_equals/greater/less/file_type_is/file_extension_is/file_modified_after/before/file_contains/file_not_contains/file_matches_regex/file_path_matches/file_in_directory`。
  - 字符串高级：`matches_regex/not_matches_regex/starts_with/ends_with/equals_case_insensitive/length_equals/greater/less/contains_digits/digits_count/is_numeric/contains_special_chars/similarity_greater/levenshtein_distance_less_than`（保留现有 `RegexMatch` 向后兼容）。
  - 数组：`array_length_equals/greater/less/array_is_empty/array_is_not_empty/array_contains/array_not_contains/array_contains_all/array_contains_any/array_equals/array_not_equals/array_is_subset/array_is_superset/array_intersects`。
  - 周期性时间：`time_before_or_equal/time_after_or_equal/is_weekday/is_weekend/is_month_start/end/is_year_start/end/is_nth_weekday_of_month/is_last_weekday_of_month/days_since/days_until/is_within_last_days/is_business_hours` 等。
- 后端处理器实现
  - 在 `plugin/src/service/filter/handler/**` 新增 `file/ string/ array/ time` 子目录处理器，遵循现有 `OperatorHandler` 接口与同步返回布尔契约。
  - 注册点：扩展 `plugin/src/service/filter/handler/OperatorHandlers.ts` 的 `handlers` 数组，将新增处理器追加。
  - 文件内容匹配：复用 `FileListControl` 的编码值（`<<<FILE_PATH>>><<<CONTENT>>>`），在处理器中解码后同步匹配，避免异步 I/O。
  - 时间解析统一：在 `plugin/src/utils/DateTimeCalculator.ts` 增加 `parseFieldTime()` 与周期性算法（周/月/季/年边界、业务时段），并在时间处理器中统一调用。
- UI扩展
  - 操作符选择：在 `plugin/src/view/shared/filter-content/ConditionOperator.tsx` 针对 `FILE_LIST/FOLDER_PATH` 与文本字段加入对应操作符分组；补齐 `TimeBeforeOrEqual/TimeAfterOrEqual`。
  - 值输入：在 `plugin/src/view/shared/filter-content/ConditionValue.tsx` 增加正则输入（pattern+flags）、多值chips输入、扩展名/类型下拉、时间参数对象等；`normalizeValue.tsx` 扩展数组操作符的值归一化。
- 国际化
  - 在 `plugin/src/i18n/zh.ts`、`en.ts`、`zhTw.ts` 增加新操作符的 `label/placeholder` 与提示文案键。
- 验证
  - 单元覆盖：等值/不等、包含/不包含、长度/关系、周期性时间边界（闰年、月末、DST）；正则解析错误与大文本匹配性能。

## 变更点一览（关键代码引用）
- AI服务商添加自动弹窗：`plugin/src/features/tars/settingTab.ts:77-96`（新增流程）、`plugin/src/features/tars/settingTab.ts:598-720`（消费 `isOpen`）、`plugin/src/features/tars/settingTab.ts:725-919`（保存按钮与反馈）。
- 条件系统模型：`plugin/src/model/filter/OperatorType.ts:1-29`（枚举扩展）。
- 条件处理注册：`plugin/src/service/filter/handler/OperatorHandlers.ts:17-29`（追加处理器）。
- 条件 UI：`plugin/src/view/shared/filter-content/ConditionOperator.tsx:89-120`（选项扩展）、`plugin/src/view/shared/filter-content/ConditionValue.tsx:30-59`（输入扩展）。
- 文件字段值：`plugin/src/view/shared/control/FileListControl.tsx:33-63, 188-259`（编码/解码与内容提取）。
- 时间计算：`plugin/src/utils/DateTimeCalculator.ts`（新增统一解析与周期算法）。

## 里程碑与交付
- 阶段1（AI服务商流程）：自动弹窗 + 保存校验增强；回归测试。
- 阶段2（操作符核心）：扩展枚举 + 新增处理器（文件/字符串/数组/时间） + 注册；基础用例验证。
- 阶段3（UI集成）：操作符选择与值输入组件扩展；本地化文案补齐；交互验证。
- 阶段4（批量操作）：多选态、模板库与删除影响分析；批量事务与撤销。
- 阶段5（测试与优化）：性能基准 + 边界场景 + 兼容性验证；必要的微调与修复。

## 风险与缓解
- 文件属性/时间的同步评估受限：先基于编码值与字段预处理实现；必要时扩展 `OperatorHandleContext` 以传入只读元数据。
- 正则与大文本性能：加入输入长度上限与早停策略；对复杂表达式进行防抖校验。
- 周期性时间跨时区/DST：统一 `DateTimeCalculator` 解析，若引入 `moment-timezone`，在设置中提供 `timezone` 选项并缓存。

## 验收标准
- 新增服务商后弹窗立即展示，保存反馈明确；不影响现有交互。
- 扩展操作符在对应字段类型的 UI 中可选，可正确评估且性能可控。
- 批量添加/删除可用，事务化、可撤销，进度反馈与影响分析清晰。

## 预计交付物
- 扩展后的操作符枚举与处理器类、条件编辑 UI 改动、AI服务商流程优化代码、批量操作 UI 与事务逻辑。所有改动保持向下兼容并附带必要的本地化文案。

#END_OF_RESPONSE#