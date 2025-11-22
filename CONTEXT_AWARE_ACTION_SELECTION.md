# 上下文相关动作选择功能实现

这个文档描述了为插件实现的上下文相关动作选择功能，用于解决循环控制动作在非循环上下文中错误显示的问题。

## 背景问题

在原有的实现中，"中断循环"和"跳过本次循环"这两个循环控制动作在所有动作添加界面中都会显示，包括在循环动作外部。这种设计容易误导用户，因为这些动作只有在循环动作内部使用时才有效。

## 解决方案

### 核心设计

通过引入 `isInsideLoop` 参数来实现上下文相关的动作过滤机制：

1. **`isInsideLoop = true`**（循环内部）：显示所有动作，包括循环控制动作
2. **`isInsideLoop = false`**（循环外部）：过滤掉循环控制动作

### 参数传递链路

```
NestedActionsEditor (isInsideLoop={true})
    ↓
CpsFormActions (isInsideLoop: boolean)
    ↓
NewActionGridPopover (isInsideLoop: boolean)
    ↓
NewActionGrid (isInsideLoop: boolean)
    ↓
getFormActionTypeOptions(isInsideLoop: boolean)
```

## 修改的文件

### 1. ActionTypeSelect.tsx
- **新增**：`getFormActionTypeOptions(isInsideLoop: boolean)` 函数
- **重构**：将原有的静态数组改为可过滤的动态函数
- **过滤逻辑**：在循环外部过滤掉 `FormActionType.BREAK` 和 `FormActionType.CONTINUE`

### 2. NewActionGrid.tsx
- **新增**：`isInsideLoop?: boolean` 参数
- **修改**：使用 `getFormActionTypeOptions(isInsideLoop)` 替代静态数组
- **优化**：将 `isInsideLoop` 加入 `useMemo` 依赖数组

### 3. NewActionGridPopover.tsx
- **新增**：`isInsideLoop?: boolean` 参数
- **传递**：将参数传递给 `NewActionGrid` 组件

### 4. CpsFormActions.tsx
- **新增**：`isInsideLoop?: boolean` 参数
- **传递**：将参数传递给 `NewActionGridPopover` 组件

### 5. NestedActionsEditor.tsx
- **设置**：调用 `CpsFormActions` 时传入 `isInsideLoop={true}`

## 功能验证

### 测试结果

**循环外部场景**：
- 可用动作数量：11个
- **不包含**：`break`（中断循环）、`continue`（跳过本次循环）
- 包含：所有其他动作类型

**循环内部场景**：
- 可用动作数量：13个
- **包含**：`break`（中断循环）、`continue`（跳过本次循环）
- 包含：所有其他动作类型

### 测试覆盖

创建了完整测试套件 `context-aware-action-selection.test.tsx`，验证：
- ✅ 循环外部过滤逻辑
- ✅ 循环内部完整显示
- ✅ 默认参数行为
- ✅ 动作数量验证
- ✅ 动作属性完整性

## 用户体验改进

### 之前的问题
- 用户在循环外添加动作时，会看到无效的循环控制动作选项
- 可能导致用户困惑和误操作
- 界面不够专业和直观

### 优化后的效果
- **循环外部**：只显示有效的动作选项，界面简洁清晰
- **循环内部**：显示所有动作，包括循环控制动作
- **智能过滤**：根据上下文自动调整可用动作
- **向后兼容**：不影响现有功能

## 技术特点

1. **类型安全**：使用 TypeScript 确保参数类型安全
2. **性能优化**：使用 `useMemo` 避免不必要的重新计算
3. **向后兼容**：所有 `isInsideLoop` 参数都是可选的，默认为 `false`
4. **测试完备**：提供完整的测试覆盖
5. **代码简洁**：实现逻辑简单清晰，易于维护

## 验收标准

✅ **验收标准1**："中断循环"和"跳过本次循环"动作仅在循环内部的动作添加界面可见
✅ **验收标准2**：所有非循环上下文中的动作添加界面均不显示上述两个循环控制动作
✅ **验收标准3**：功能实现不影响其他动作的正常显示和使用
✅ **验收标准4**：界面响应迅速，无明显延迟或闪烁现象
✅ **验收标准5**：代码实现符合项目的编码规范和最佳实践

## 总结

这个功能优化显著提升了用户界面的专业性和易用性，通过智能的上下文感知，确保用户只看到当前上下文下有效的动作选项，避免了可能的困惑和误操作。