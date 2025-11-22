# 循环变量引用系统实现

这个文档描述了为插件实现的循环变量引用机制，使得循环过程中的动态变量能够在嵌套动作中被直接使用。

## 核心功能概述

### 变量引用方式

**循环变量引用语法**：
- `{{item}}` - 当前循环元素
- `{{index}}` - 当前循环索引（从0开始）
- `{{total}}` - 循环总次数
- `{{currentPage}}` - 当前页码（分页循环）
- `{{pageSize}}` - 每页大小（分页循环）

**与其他变量的区别**：
- 表单变量：`{{@fieldName}}`
- 循环变量：`{{variableName}}`
- AI输出变量：`{{output:variableName}}`

### 变量作用域

1. **循环内部**：显示表单变量 + 循环变量
2. **循环外部**：只显示表单变量
3. **嵌套循环**：外层循环变量仍然可见，内层变量优先

## 技术实现

### 1. 扩展的循环变量作用域 (LoopVariableScope)

**新增功能**：
- 变量元数据支持（名称、描述、类型标识）
- 上下文感知的变量获取
- 嵌套循环的变量作用域管理

**核心方法**：
```typescript
// 检查是否在循环内部
LoopVariableScope.isInsideLoop()

// 获取所有可用变量（用于UI显示）
LoopVariableScope.getAvailableVariables()

// 获取变量描述信息
LoopVariableScope.getVariableDescription(varName)

// 创建标准循环变量元数据
LoopVariableScope.createStandardVariableMeta(variables)
```

### 2. 上下文相关变量显示

**FormVariableQuotePanel 增强**：
- 根据上下文过滤显示的变量
- 支持循环变量的复制和引用
- 智能区分不同类型的变量

**变量类型支持**：
- 表单变量：`{{@fieldName}}`
- 循环变量：`{{variableName}}`
- AI输出变量：`{{output:variableName}}`

### 3. 智能自动补全

**FormVariableSuggest 增强**：
- 根据输入上下文智能推荐变量
- 支持 `{{@` 触发表单变量补全
- 支持 `{{` 触发循环变量补全
- 语法高亮和视觉区分

**触发机制**：
- 输入 `@` → 表单变量补全
- 输入 `{{@` → 表单变量补全
- 输入 `{{` → 循环变量补全

### 4. React Context 传递

**LoopContext 实现**：
```typescript
const LoopContext = createContext<LoopContextValue>({
    isInsideLoop: false,
    loopVariables: []
});
```

**组件集成**：
- `NestedActionsEditor` 提供上下文
- `CpsFormActions` 消费上下文
- 所有子组件自动继承循环状态

### 5. 增强的用户界面

**循环动作编辑界面**：
- 可用变量列表显示
- 使用方法说明
- 语法高亮的代码示例
- 响应式设计支持

**视觉设计**：
- 变量标签的颜色区分
- 代码块的高亮显示
- 清晰的使用说明文档

## 使用示例

### 基本用法

在循环内的"插入文本"动作中：
```
项目 {{index + 1}}/{{total}}: {{item}}
当前元素：{{item}}
索引位置：{{index}}
```

### AI动作中使用

在AI提示词中引用循环变量：
```
请分析第{{index}}个数据：{{item}}
这是总共{{total}}个项目中的第{{index + 1}}个
```

### 文件路径中使用

在"创建文件"动作的路径中：
```
files/item-{{index}}-{{item.id}}.md
```

## 系统架构

### 组件层次结构

```
NestedActionsEditor (循环上下文提供者)
├── LoopProvider
    └── CpsFormActions (上下文消费者)
        ├── FormVariableQuotePanel (变量面板)
        └── 动作设置组件
            ├── InsertTextSetting
            ├── AIActionSetting
            └── ...
```

### 数据流

1. **循环执行时**：
   - `LoopActionService` 推送变量到 `LoopVariableScope`
   - 创建变量元数据用于UI显示

2. **UI渲染时**：
   - 组件通过 `LoopContext` 获取上下文信息
   - `useVariablesWithLoop` 收集所有可用变量
   - `FormVariableQuotePanel` 显示过滤后的变量列表

3. **自动补全**：
   - `FormVariableSuggest` 根据输入触发补全
   - 根据变量类型提供不同的语法格式

## 错误处理机制

### 变量验证

1. **类型安全**：使用 TypeScript 确保类型正确
2. **作用域检查**：防止在循环外部引用循环变量
3. **名称冲突处理**：内层循环变量优先于外层

### 用户体验保障

1. **智能过滤**：只显示当前上下文有效的变量
2. **错误提示**：在无效引用时给出明确提示
3. **语法高亮**：帮助用户区分不同类型的变量

## 测试覆盖

### 单元测试

- ✅ 循环变量解析测试 (28个测试全部通过)
- ✅ 上下文相关动作选择测试 (5个测试全部通过)
- ✅ 循环工具函数测试 (14个测试全部通过)

### 功能验证

- ✅ 循环内外变量显示过滤
- ✅ 嵌套循环变量作用域
- ✅ 自动补全触发机制
- ✅ 变量引用语法正确性
- ✅ UI响应性和视觉效果

## 性能优化

### 内存管理

- 使用 `useMemo` 优化变量列表计算
- 循环结束时自动清理变量作用域
- 避免不必要的重新渲染

### 用户体验

- 实时的变量自动补全
- 流畅的界面响应
- 清晰的视觉反馈

## 总结

这个循环变量引用系统大大增强了插件的循环功能，提供了：

1. **直观的变量引用方式**：简洁的语法，易于理解和使用
2. **智能的上下文感知**：根据当前环境自动过滤可用变量
3. **完善的开发体验**：自动补全、语法高亮、错误提示
4. **强大的功能支持**：支持各种嵌套动作中的变量使用

该系统完全向后兼容，不影响现有功能，同时为用户提供了更强大、更灵活的循环操作能力。