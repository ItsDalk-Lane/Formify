# 内置变量 currentFile 使用说明

## 概述

`currentFile` 是一个内置变量，用于获取当前活动 Markdown 文件的内容。这个变量可以在表单系统的任何支持模板变量的地方使用，例如"插入文本"动作中。

## 使用方式

### 基本用法

- `{{currentFile}}` - 获取当前活动 Markdown 文件的内容，不包含元数据（frontmatter）
- `{{currentFile:metadata}}` - 获取当前活动 Markdown 文件的内容，包含元数据
- `{{currentFile:plain}}` - 获取当前活动 Markdown 文件的纯文本内容（移除 Markdown 格式），不包含元数据
- `{{currentFile:metadata:plain}}` - 获取当前活动 Markdown 文件的纯文本内容，包含元数据

### 参数说明

- `metadata` - 可选参数，指定是否包含元数据（frontmatter）
- `plain` - 可选参数，指定是否移除 Markdown 格式，返回纯文本

## 使用示例

### 示例 1：基本使用

在"插入文本"动作中使用：

```
当前文件内容：
{{currentFile}}
```

### 示例 2：包含元数据

```
完整文件内容（含元数据）：
{{currentFile:metadata}}
```

### 示例 3：纯文本内容

```
纯文本内容（无格式）：
{{currentFile:plain}}
```

### 示例 4：包含元数据的纯文本

```
纯文本内容（含元数据）：
{{currentFile:metadata:plain}}
```

### 示例 5：与其他变量组合使用

```
文件名：{{fileName}}
文件内容：
{{currentFile:plain}}
当前时间：{{currentDate}}
```

## 注意事项

1. 只有当前活动文件是 Markdown 文件（.md 扩展名）时，变量才会被替换为文件内容，否则会替换为空字符串
2. 如果没有活动文件，变量也会被替换为空字符串
3. 纯文本模式会移除以下 Markdown 格式：
   - 链接格式 `[text](url)` → `text`
   - 图片格式 `![alt](url)` → `alt`
   - 粗体格式 `**text**` → `text`
   - 斜体格式 `*text*` → `text`
   - 标题格式 `# Header` → `Header`
   - 代码块和行内代码
   - 列表标记
   - 引用标记

## 应用场景

1. **文档摘要生成**：使用 `{{currentFile:plain}}` 获取纯文本内容，然后使用 AI 动作生成摘要
2. **文档格式转换**：获取文件内容后进行格式转换
3. **内容分析**：分析当前文档的内容或结构
4. **模板填充**：将当前文档内容作为模板的一部分
5. **文档合并**：将多个文档内容合并到一个文件中

## 错误处理

如果读取文件时发生错误，变量会被替换为空字符串，并在控制台输出错误信息。
