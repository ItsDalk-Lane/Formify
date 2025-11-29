# 内链解析功能扩展设计文档

## 1. 功能概述

### 1.1 核心定义

在插件的AI聊天模块和表单AI动作模块中，增加自动识别并解析Obsidian内部链接（`[[]]`格式）的功能。系统将自动提取链接指向的笔记内容，替换原始链接文本，最终将解析后的完整内容发送给大语言模型处理。

### 1.2 功能范围

本功能作用于以下两个核心模块：

- **AI聊天模块**（plugin/src/features/chat）
- **表单AI动作模块**（plugin/src/service/action/ai）

### 1.3 参照实现

TARS编辑器模块已实现完整的内链解析功能，位于 `plugin/src/features/tars/editor.ts` 中的 `resolveLinkedContent` 函数。该实现可作为核心参照和复用基础。

## 2. 现有功能分析

### 2.1 TARS编辑器内链解析机制

#### 核心函数结构

```
函数名称: resolveLinkedContent
输入参数:
  - env: RunEnv（运行环境对象，包含文件元数据、vault实例等）
  - linkText: string（内链文本，如 "文件名" 或 "文件名#标题"）

处理流程:
  1. 使用parseLinktext解析链接文本，提取路径和子路径
  2. 通过appMeta.getFirstLinkpathDest定位目标文件
  3. 读取目标文件的元数据缓存
  4. 使用vault.cachedRead读取文件内容
  5. 如存在子路径，使用resolveSubpath提取指定部分内容
  6. 返回解析后的文本内容

错误处理:
  - 文件不存在时抛出 "LinkText broken" 错误
  - 元数据缺失时抛出 "No metadata found" 错误
  - 子路径不存在时抛出 "no subpath data found" 错误
```

#### 配置开关机制

TARS编辑器通过以下配置项控制内链解析：

```
配置接口: TarsSettings
相关字段:
  - enableInternalLink: boolean
    作用范围: 用户消息和系统消息
    默认值: true
    
  - enableInternalLinkForAssistantMsg: boolean
    作用范围: AI助手消息
    默认值: false
```

#### 集成方式

在TARS编辑器中，内链解析通过 `resolveTextRangeWithLinks` 函数集成到消息处理流程：

```
处理流程:
  1. 识别文本范围内的所有链接和嵌入引用
  2. 根据消息角色决定是否解析链接
  3. 并行解析所有需要处理的链接
  4. 将解析结果拼接成完整文本
  5. 返回带有解析后内容的消息文本
```

### 2.2 AI聊天模块现有架构

#### 核心组件

| 组件名称 | 文件路径 | 职责说明 |
|---------|---------|---------|
| ChatService | plugin/src/features/chat/services/ChatService.ts | 聊天会话管理、消息处理、AI调用协调 |
| MessageService | plugin/src/features/chat/services/MessageService.ts | 消息创建、格式化、转换 |
| FileContentService | plugin/src/features/chat/services/FileContentService.ts | 文件内容读取、处理 |
| TemplateSelector | plugin/src/features/chat/components/TemplateSelector.tsx | 提示词模板选择器 |

#### 消息处理流程

```
用户输入流程:
  1. 用户在ChatInput组件中输入消息
  2. ChatService接收消息内容
  3. MessageService创建用户消息对象
  4. 消息添加到当前会话的消息列表
  5. 触发AI响应生成流程

AI响应流程:
  1. ChatService调用toProviderMessages转换消息格式
  2. MessageService处理选中的文件和文件夹
  3. FileContentService读取文件内容
  4. 构建完整的提示词上下文
  5. 调用TARS provider的sendRequest函数
  6. 流式接收AI响应并更新界面
```

#### 提示词模板处理

```
模板选择流程:
  1. 用户点击模板选择按钮
  2. TemplateSelector显示可用模板列表
  3. 用户选择特定模板
  4. ChatService读取模板文件内容
  5. 模板内容存储在会话状态中
  6. 发送消息时模板内容作为提示词一部分

当前处理方式:
  - 模板文件内容直接读取为纯文本
  - 不进行任何链接解析或变量替换
  - 内容原样发送给AI模型
```

### 2.3 表单AI动作模块现有架构

#### 核心组件

| 组件名称 | 文件路径 | 职责说明 |
|---------|---------|---------|
| AIActionService | plugin/src/service/action/ai/AIActionService.ts | AI动作执行、提示词构建、模型调用 |
| FormTemplateProcessEngine | plugin/src/service/engine/FormTemplateProcessEngine.ts | 模板变量处理引擎 |

#### 提示词处理流程

```
系统提示词处理流程:
  根据SystemPromptMode分三种模式:
    1. NONE: 不使用系统提示词
    2. CUSTOM: 使用自定义系统提示词
       - 从AIFormAction.customSystemPrompt读取
       - 通过processTemplate进行变量替换
    3. DEFAULT: 使用全局默认系统提示词
       - 从插件设置中读取defaultSystemMsg
       - 通过processTemplate进行变量替换

用户提示词处理流程:
  根据PromptSourceType分两种模式:
    1. TEMPLATE: 从模板文件加载
       - 通过loadTemplateFile读取文件内容
       - 支持模板路径中的变量替换
       - 通过processTemplate处理文件内容
    2. CUSTOM: 使用自定义内容
       - 从AIFormAction.customPrompt读取
       - 通过processTemplate进行变量替换
```

#### 变量处理机制

```
当前支持的变量格式:
  1. 表单字段引用: {{@fieldName}}
     - 引用当前表单中的字段值
     - 通过FormTemplateProcessEngine处理
     
  2. 输出变量引用: {{output:variableName}}
     - 引用之前动作的输出变量
     - 在processTemplate函数中手动替换

处理限制:
  - 仅支持变量文本替换
  - 不支持内链解析
  - 不支持复杂的内容引用
```

## 3. 功能需求设计

### 3.1 AI聊天模块内链解析需求

#### 触发场景

| 场景编号 | 场景描述 | 触发条件 | 预期行为 |
|---------|---------|---------|---------|
| S1 | 用户消息包含内链 | 用户在聊天输入框中输入包含 `[[]]` 的文本 | 解析内链并替换为文件内容后发送 |
| S2 | 提示词模板包含内链 | 用户选择的提示词模板文件中包含 `[[]]` | 加载模板时解析内链并替换 |
| S3 | 系统提示词包含内链 | 全局系统提示词设置中包含 `[[]]` | 发送消息时解析系统提示词中的内链 |

#### 功能开关设计

```
配置结构:
  接口: ChatSettings (plugin/src/features/chat/types/chat.ts)
  
新增配置字段:
  - enableInternalLinkParsing: boolean
    说明: 是否启用内链解析功能
    默认值: true
    作用范围: 所有聊天消息和模板
    
  - parseLinksInTemplates: boolean
    说明: 是否解析提示词模板中的内链
    默认值: true
    作用范围: 仅提示词模板文件

配置界面位置:
  - 插件设置 > Chat设置标签页
  - 提供开关按钮和说明文本
```

#### 解析时机

```
消息发送前解析:
  位置: ChatService.sendMessage 方法
  时机: 在调用 toProviderMessages 之前
  处理对象:
    - state.inputValue (用户当前输入)
    - state.selectedPromptTemplate.content (选中的模板内容)
    - 系统提示词内容

具体流程:
  1. 检查配置开关是否启用
  2. 扫描消息内容识别所有内链
  3. 并行解析所有内链内容
  4. 替换原始链接文本
  5. 返回完整的解析后文本
```

#### 数据流设计

```
Mermaid流程图表示:

graph TD
    A[用户输入消息] --> B{是否启用内链解析?}
    B -->|是| C[扫描识别内链]
    B -->|否| H[直接发送]
    C --> D[解析内链内容]
    D --> E[替换链接文本]
    E --> F[转换为Provider消息格式]
    F --> G[调用AI模型]
    G --> I[返回响应]
    H --> F
```

### 3.2 表单AI动作模块内链解析需求

#### 触发场景

| 场景编号 | 场景描述 | 触发条件 | 预期行为 |
|---------|---------|---------|---------|
| A1 | 系统提示词包含内链 | AIFormAction的customSystemPrompt包含 `[[]]` | 构建系统提示词时解析内链 |
| A2 | 自定义提示词包含内链 | AIFormAction的customPrompt包含 `[[]]` | 构建用户提示词时解析内链 |
| A3 | 模板文件包含内链 | templateFile指向的文件内容包含 `[[]]` | 加载模板文件后解析内链 |

#### 功能开关设计

```
配置结构:
  接口: AIFormAction (plugin/src/model/action/AIFormAction.ts)
  
新增配置字段:
  - enableInternalLinkParsing: boolean
    说明: 是否启用内链解析
    默认值: true
    作用范围: 当前AI动作的所有提示词
    
配置界面位置:
  - 表单编辑器 > AI动作配置面板
  - 高级选项区域中的开关按钮
```

#### 解析时机

```
提示词构建阶段解析:
  位置: AIActionService.buildSystemPrompt 和 buildUserPrompt 方法
  时机: 在 processTemplate 之后
  处理对象:
    - 系统提示词文本
    - 用户提示词文本（无论来自模板还是自定义内容）

具体流程:
  1. 完成变量替换处理
  2. 检查配置开关是否启用
  3. 扫描提示词内容识别内链
  4. 并行解析所有内链内容
  5. 替换链接文本
  6. 返回最终提示词文本
```

#### 数据流设计

```
Mermaid流程图表示:

graph TD
    A[表单提交] --> B[执行AI动作]
    B --> C[构建系统提示词]
    C --> D[处理变量替换]
    D --> E{是否启用内链解析?}
    E -->|是| F[解析内链]
    E -->|否| G[跳过解析]
    F --> H[构建用户提示词]
    G --> H
    H --> I[处理变量替换]
    I --> J{是否启用内链解析?}
    J -->|是| K[解析内链]
    J -->|否| L[跳过解析]
    K --> M[调用AI模型]
    L --> M
    M --> N[存储输出结果]
```

### 3.3 通用技术需求

#### 链接识别规范

```
支持的内链格式:
  1. 标准格式: [[文件名]]
     示例: [[笔记标题]]
     解析结果: 完整文件内容
     
  2. 带扩展名格式: [[文件名.md]]
     示例: [[笔记.md]]
     解析结果: 完整文件内容
     
  3. 带路径格式: [[文件夹/文件名]]
     示例: [[项目/需求文档]]
     解析结果: 完整文件内容
     
  4. 带标题格式: [[文件名#标题]]
     示例: [[笔记#第二章]]
     解析结果: 指定标题下的内容
     
  5. 带别名格式: [[文件名|显示文本]]
     示例: [[长文件名|简称]]
     解析结果: 完整文件内容（忽略显示文本）

正则表达式模式:
  基础模式: /\[\[([^\]]+)\]\]/g
  
解析优先级:
  1. 优先使用Obsidian的parseLinktext API
  2. 解析结果包含path和subpath
  3. 处理特殊字符和转义序列
```

#### 路径解析策略

```
文件定位流程:
  1. 使用 app.metadataCache.getFirstLinkpathDest(path, sourcePath)
     - path: 链接文本解析出的文件路径
     - sourcePath: 当前上下文文件的路径
     
  2. Obsidian自动处理:
     - 相对路径转换
     - 路径别名解析
     - 文件扩展名补全
     - 跨文件夹引用
     
  3. 返回TFile对象或null

内容提取流程:
  1. 使用 app.vault.cachedRead(file) 读取文件
  2. 如存在subpath（如#标题）:
     - 使用 resolveSubpath(fileCache, subpath)
     - 提取指定偏移量的内容片段
  3. 如无subpath:
     - 返回完整文件内容
```

#### 错误处理机制

| 错误类型 | 触发条件 | 处理策略 | 用户反馈 |
|---------|---------|---------|----------|
| 文件不存在 | getFirstLinkpathDest返回null | 保留原始链接文本 | 调试日志记录警告 |
| 元数据缺失 | getFileCache返回null | 保留原始链接文本 | 调试日志记录警告 |
| 子路径无效 | resolveSubpath返回null | 返回完整文件内容 | 调试日志记录警告 |
| 读取权限错误 | vault.cachedRead抛出异常 | 保留原始链接文本 | 调试日志记录错误 |
| 解析超时 | 处理时间超过阈值 | 中断解析保留原文 | 不显示错误 |

```
错误处理原则:
  1. 不中断整体流程
  2. 优雅降级保留原文
  3. 记录详细调试信息
  4. 不向用户显示技术错误
  5. 支持配置错误处理策略
```

#### 性能优化策略

```
缓存机制:
  结构: Map<string, CachedContent>
  
  CachedContent接口:
    - content: string (解析后的内容)
    - timestamp: number (缓存时间戳)
    - filePath: string (源文件路径)
    - mtime: number (文件修改时间)
  
  缓存键生成:
    key = `${filePath}${subpath ? '#' + subpath : ''}`
  
  缓存验证:
    1. 检查缓存是否存在
    2. 比对文件修改时间
    3. 如文件未修改则使用缓存
    4. 如文件已修改则重新解析
  
  缓存清理:
    - 会话结束时清空
    - 超时自动清理（默认30分钟）
    - 手动清理接口

并发控制:
  策略: Promise.all批量并行处理
  
  实现方式:
    1. 收集消息中的所有内链
    2. 去重相同的链接
    3. 并行解析所有唯一链接
    4. 等待所有解析完成
    5. 统一替换文本
  
  限制:
    - 单次最大并发数: 10个链接
    - 超过限制则分批处理
    - 避免过度占用资源

循环引用检测:
  机制: 维护解析路径栈
  
  检测逻辑:
    1. 解析开始时将文件路径入栈
    2. 解析嵌套链接前检查栈
    3. 如路径已存在则判定为循环
    4. 循环引用时保留原始链接
    5. 解析完成后将路径出栈
  
  最大深度: 5层嵌套
```

## 4. 架构设计

### 4.1 服务模块设计

#### 内链解析服务

```
服务名称: InternalLinkParserService
文件位置: plugin/src/services/InternalLinkParserService.ts

职责边界:
  - 识别文本中的Obsidian内链
  - 解析链接并提取内容
  - 管理解析缓存
  - 处理错误和异常
  - 提供配置控制

依赖关系:
  - App (Obsidian应用实例)
  - MetadataCache (文件元数据缓存)
  - Vault (文件系统访问)
  - DebugLogger (调试日志)

对外接口:
  - parseLinks(text: string, sourcePath: string, options?: ParseOptions): Promise<string>
  - clearCache(): void
  - isEnabled(): boolean
```

#### 接口定义

```
ParseOptions接口:
  - enableParsing: boolean (是否启用解析)
  - maxDepth: number (最大嵌套深度)
  - timeout: number (解析超时时间，毫秒)
  - preserveOriginalOnError: boolean (错误时保留原文)
  - enableCache: boolean (是否使用缓存)

ParseResult接口:
  - parsedText: string (解析后的文本)
  - linksFound: number (发现的链接数)
  - linksParsed: number (成功解析的链接数)
  - errors: ParseError[] (解析错误列表)

ParseError接口:
  - linkText: string (原始链接文本)
  - errorType: 'FILE_NOT_FOUND' | 'PERMISSION_ERROR' | 'TIMEOUT' | 'CIRCULAR_REFERENCE'
  - errorMessage: string (错误详情)
```

### 4.2 集成方案设计

#### AI聊天模块集成

```
集成位置: ChatService (plugin/src/features/chat/services/ChatService.ts)

修改点1: sendMessage方法
  位置: 构建消息前
  
  增加处理逻辑:
    1. 创建InternalLinkParserService实例
    2. 检查配置是否启用内链解析
    3. 解析用户输入文本
    4. 解析选中的提示词模板内容
    5. 继续原有的消息发送流程
  
  伪代码示例:
    if (settings.enableInternalLinkParsing) {
      const parser = new InternalLinkParserService(this.app)
      const parsedInput = await parser.parseLinks(inputValue, currentFilePath)
      const parsedTemplate = selectedTemplate 
        ? await parser.parseLinks(selectedTemplate.content, templateFilePath)
        : ''
      // 使用解析后的内容继续处理
    }

修改点2: buildSystemPrompt (新增私有方法)
  职责: 构建并解析系统提示词
  
  处理逻辑:
    1. 读取全局系统提示词配置
    2. 如启用内链解析则解析内容
    3. 返回处理后的系统提示词

依赖注入:
  - 在ChatService构造函数中接收App实例
  - 按需创建InternalLinkParserService
  - 避免全局单例，保持服务无状态
```

#### 表单AI动作模块集成

```
集成位置: AIActionService (plugin/src/service/action/ai/AIActionService.ts)

修改点1: buildSystemPrompt方法
  位置: 变量替换之后
  
  增加处理逻辑:
    1. 检查aiAction.enableInternalLinkParsing配置
    2. 如启用则创建解析服务
    3. 解析系统提示词内容
    4. 返回解析后的文本
  
  伪代码示例:
    let systemPrompt = await this.processTemplate(template, context)
    if (aiAction.enableInternalLinkParsing) {
      const parser = new InternalLinkParserService(context.app)
      systemPrompt = await parser.parseLinks(systemPrompt, context.currentFilePath)
    }
    return systemPrompt

修改点2: buildUserPrompt方法
  位置: 变量替换之后
  
  增加处理逻辑:
    1. 检查aiAction.enableInternalLinkParsing配置
    2. 如启用则创建解析服务
    3. 解析用户提示词内容
    4. 返回解析后的文本

上下文路径确定:
  策略: 优先使用当前编辑文件路径
  
  获取方式:
    1. 从context.app.workspace.getActiveFile()获取
    2. 如无活动文件则使用空字符串
    3. 空路径时仅支持绝对路径链接
```

### 4.3 复用TARS功能策略

#### 直接复用方案

```
复用目标: resolveLinkedContent函数
位置: plugin/src/features/tars/editor.ts (第153-175行)

复用方式:
  选项1: 导出函数直接调用
    优点: 简单直接，无需重复开发
    缺点: 需要构造RunEnv对象
    
  选项2: 提取为独立工具函数
    优点: 解除对TARS模块的依赖
    缺点: 需要重构现有代码
    
  推荐方案: 选项2
    理由:
      - 解除模块间耦合
      - 提高代码可维护性
      - 便于独立测试
      - 避免引入不必要的TARS依赖
```

#### 提取重构方案

```
新建工具文件:
  路径: plugin/src/utils/InternalLinkResolver.ts
  
提取函数:
  1. resolveLinkedContent
     - 提取核心解析逻辑
     - 简化接口参数
     - 移除对RunEnv的依赖
     
  2. parseLinkText (包装Obsidian API)
     - 统一链接文本解析
     - 处理各种格式
     
  3. resolveFilePath
     - 文件路径解析
     - 路径验证
     
  4. extractSubpathContent
     - 子路径内容提取
     - 标题定位

接口设计:
  export async function resolveLinkedContent(
    app: App,
    linkText: string,
    sourcePath: string
  ): Promise<string>
  
  参数说明:
    - app: Obsidian应用实例
    - linkText: 内链文本（不含[[ ]]）
    - sourcePath: 当前文件路径（用于相对路径解析）
    
  返回值:
    - 解析后的文件内容
    - 抛出异常时由调用方处理
```

## 5. 配置管理设计

### 5.1 AI聊天模块配置

```
配置接口扩展:
  文件: plugin/src/features/chat/types/chat.ts
  接口: ChatSettings
  
新增字段:
  enableInternalLinkParsing: boolean
    - 默认值: true
    - 说明: 是否启用聊天中的内链解析
    
  parseLinksInTemplates: boolean
    - 默认值: true
    - 说明: 是否解析模板文件中的内链
    
  maxLinkParseDepth: number
    - 默认值: 5
    - 说明: 内链嵌套解析的最大深度
    
  linkParseTimeout: number
    - 默认值: 5000
    - 说明: 单个链接解析超时时间（毫秒）
```

### 5.2 表单AI动作配置

```
配置接口扩展:
  文件: plugin/src/model/action/AIFormAction.ts
  接口: AIFormAction
  
新增字段:
  enableInternalLinkParsing?: boolean
    - 默认值: true
    - 说明: 是否启用此AI动作的内链解析
    - 作用范围: 当前动作的所有提示词
```

### 5.3 配置界面设计

#### AI聊天设置面板

```
位置: 插件设置 > Chat标签页

布局结构:
  [内链解析设置] (折叠面板)
    ├─ [x] 启用内链解析功能
    │   └─ 说明: 自动解析聊天消息和模板中的 [[]] 内链
    │
    ├─ [x] 解析提示词模板中的内链
    │   └─ 说明: 解析从模板文件加载的内容
    │
    ├─ 最大嵌套深度: [5] (数字输入)
    │   └─ 说明: 防止循环引用，建议1-10之间
    │
    └─ 解析超时时间: [5000] 毫秒
        └─ 说明: 单个链接的最长处理时间

交互行为:
  - 主开关关闭时，子选项禁用
  - 输入验证：深度1-10，超时100-30000毫秒
  - 实时保存配置
```

#### 表单编辑器AI动作配置

```
位置: 表单编辑器 > AI动作编辑面板 > 高级选项

布局结构:
  [高级选项] (折叠区域)
    ├─ ... (其他现有选项)
    │
    └─ [x] 启用内链解析
        └─ 说明: 解析提示词中的 [[]] 内链为实际内容

交互行为:
  - 默认选中状态
  - 提供悬停提示说明功能
  - 配置保存到动作对象
```

## 6. 实现细节

### 6.1 核心服务实现

#### InternalLinkParserService类结构

```
类定义:
  export class InternalLinkParserService {
    private app: App
    private cache: Map<string, CachedContent>
    private parseStack: Set<string>
    
    constructor(app: App)
    
    // 核心公共方法
    async parseLinks(
      text: string, 
      sourcePath: string, 
      options?: ParseOptions
    ): Promise<string>
    
    clearCache(): void
    
    // 私有辅助方法
    private async resolveSingleLink(
      linkText: string,
      sourcePath: string,
      depth: number
    ): Promise<string>
    
    private extractLinks(text: string): LinkMatch[]
    
    private getCacheKey(linkText: string): string
    
    private isCircularReference(filePath: string): boolean
    
    private getCachedContent(key: string, file: TFile): string | null
    
    private setCachedContent(key: string, content: string, file: TFile): void
  }
```

#### parseLinks方法实现流程

```
Mermaid流程图:

graph TD
    A[接收文本和源路径] --> B[提取所有内链]
    B --> C{是否有内链?}
    C -->|否| D[返回原文本]
    C -->|是| E[去重链接列表]
    E --> F[并行解析所有链接]
    F --> G[构建替换映射表]
    G --> H[依次替换文本]
    H --> I[返回解析后文本]
    
    F --> F1[解析单个链接]
    F1 --> F2{检查循环引用?}
    F2 -->|是| F3[返回原链接文本]
    F2 -->|否| F4{检查缓存?}
    F4 -->|命中| F5[返回缓存内容]
    F4 -->|未命中| F6[调用resolveLinkedContent]
    F6 --> F7[缓存结果]
    F7 --> F8[返回解析内容]
```

#### 文本替换策略

```
替换顺序:
  问题: 直接替换可能导致偏移量错误
  
  解决方案: 从后向前替换
    1. 记录所有链接的位置和解析结果
    2. 按位置倒序排列
    3. 从文本末尾向开头依次替换
    4. 避免偏移量变化影响后续替换

实现示例:
  const matches = this.extractLinks(text).reverse()
  let result = text
  for (const match of matches) {
    const content = await this.resolveSingleLink(match.linkText, sourcePath)
    result = result.substring(0, match.startIndex) + 
             content + 
             result.substring(match.endIndex)
  }
  return result
```

### 6.2 ChatService集成实现

#### sendMessage方法改造

```
改造位置:
  文件: plugin/src/features/chat/services/ChatService.ts
  方法: async sendMessage()
  
插入位置: 在调用 toProviderMessages 之前

增加代码逻辑:
  // 1. 检查配置
  const settings = this.settings.chat
  if (!settings.enableInternalLinkParsing) {
    // 跳过解析，继续原流程
    continue
  }
  
  // 2. 获取当前文件路径
  const activeFile = this.app.workspace.getActiveFile()
  const sourcePath = activeFile?.path ?? ''
  
  // 3. 解析用户输入
  const parser = new InternalLinkParserService(this.app)
  const parsedInput = await parser.parseLinks(
    this.state.inputValue,
    sourcePath,
    {
      maxDepth: settings.maxLinkParseDepth,
      timeout: settings.linkParseTimeout
    }
  )
  
  // 4. 解析模板内容
  let parsedTemplate = ''
  if (this.state.selectedPromptTemplate && settings.parseLinksInTemplates) {
    parsedTemplate = await parser.parseLinks(
      this.state.selectedPromptTemplate.content,
      this.state.selectedPromptTemplate.path
    )
  }
  
  // 5. 构建最终消息内容
  const finalContent = parsedTemplate 
    ? `${parsedTemplate}\n\n${parsedInput}`
    : parsedInput
  
  // 6. 继续原有流程，使用finalContent替代原始输入
```

### 6.3 AIActionService集成实现

#### buildSystemPrompt方法改造

```
改造位置:
  文件: plugin/src/service/action/ai/AIActionService.ts
  方法: private async buildSystemPrompt()
  
插入位置: 在 processTemplate 之后

增加代码逻辑:
  // 原有代码：获取并处理系统提示词
  let systemPrompt = await this.processTemplate(template, context)
  
  // 新增：内链解析
  if (aiAction.enableInternalLinkParsing) {
    const activeFile = context.app.workspace.getActiveFile()
    const sourcePath = activeFile?.path ?? ''
    
    const parser = new InternalLinkParserService(context.app)
    systemPrompt = await parser.parseLinks(systemPrompt, sourcePath)
  }
  
  return systemPrompt
```

#### buildUserPrompt方法改造

```
改造位置:
  文件: plugin/src/service/action/ai/AIActionService.ts
  方法: private async buildUserPrompt()
  
插入位置: 在 processTemplate 或 loadTemplateFile 之后

增加代码逻辑:
  // 原有代码：获取用户提示词
  let userPrompt = ...
  
  // 新增：内链解析
  if (aiAction.enableInternalLinkParsing) {
    const activeFile = context.app.workspace.getActiveFile()
    const sourcePath = activeFile?.path ?? ''
    
    const parser = new InternalLinkParserService(context.app)
    userPrompt = await parser.parseLinks(userPrompt, sourcePath)
  }
  
  return userPrompt
```

## 7. 异常场景处理

### 7.1 错误分类与处理

| 错误场景 | 错误级别 | 处理策略 | 日志记录 | 用户通知 |
|---------|---------|---------|---------|----------|
| 链接文件不存在 | 警告 | 保留原链接文本 | 调试日志 | 无 |
| 文件权限不足 | 错误 | 保留原链接文本 | 错误日志 | 无 |
| 解析超时 | 警告 | 保留原链接文本 | 警告日志 | 无 |
| 循环引用 | 警告 | 中断解析保留原文 | 调试日志 | 无 |
| 网络文件不可用 | 错误 | 保留原链接文本 | 错误日志 | 无 |
| 解析服务异常 | 严重 | 跳过所有解析 | 错误日志 | 可选通知 |

### 7.2 降级策略

```
自动降级触发条件:
  1. 连续解析失败超过3次
  2. 解析服务初始化失败
  3. 关键依赖API不可用
  
降级行为:
  1. 自动禁用内链解析功能
  2. 记录降级事件到日志
  3. 可选显示一次性通知
  4. 保持其他功能正常工作
  
恢复机制:
  1. 下次会话自动重试
  2. 用户手动重新启用
  3. 插件重载后重置状态
```

### 7.3 调试支持

```
调试日志输出:
  使用DebugLogger统一输出
  
日志级别分类:
  - DEBUG: 详细解析过程
    * 识别到的所有链接
    * 每个链接的解析结果
    * 缓存命中情况
    
  - INFO: 关键操作信息
    * 解析服务初始化
    * 批量解析开始/完成
    * 配置变更
    
  - WARN: 可恢复的问题
    * 文件未找到
    * 解析超时
    * 循环引用
    
  - ERROR: 需要关注的错误
    * 权限错误
    * API调用失败
    * 服务异常

日志格式:
  [InternalLinkParser] 级别 消息内容
  示例: [InternalLinkParser] DEBUG 解析链接: [[笔记#章节]]
```

## 8. 测试验证策略

### 8.1 功能测试场景

#### AI聊天模块测试

| 测试编号 | 测试场景 | 输入条件 | 预期输出 | 验证要点 |
|---------|---------|---------|---------|----------|
| T-C-01 | 单个内链解析 | 用户输入包含 `[[笔记]]` | 链接替换为笔记内容 | 内容完整性 |
| T-C-02 | 多个内链解析 | 输入包含3个不同内链 | 所有链接正确替换 | 替换准确性 |
| T-C-03 | 重复内链优化 | 输入包含2个相同内链 | 仅解析一次，两处替换 | 缓存有效性 |
| T-C-04 | 模板内链解析 | 模板文件包含内链 | 模板加载时解析链接 | 模板处理流程 |
| T-C-05 | 系统提示词内链 | 系统提示词包含内链 | 发送时解析链接 | 系统消息处理 |
| T-C-06 | 禁用解析 | 配置关闭，输入包含内链 | 链接保持原样 | 配置开关有效 |
| T-C-07 | 嵌套内链 | 链接文件中包含另一个链接 | 递归解析到配置深度 | 递归解析机制 |
| T-C-08 | 带标题链接 | 输入 `[[笔记#第一章]]` | 仅提取标题内容 | 子路径解析 |

#### 表单AI动作测试

| 测试编号 | 测试场景 | 输入条件 | 预期输出 | 验证要点 |
|---------|---------|---------|---------|----------|
| T-A-01 | 自定义提示词内链 | customPrompt包含内链 | 解析后发送AI | 提示词处理 |
| T-A-02 | 模板文件内链 | templateFile包含内链 | 加载时解析 | 模板加载流程 |
| T-A-03 | 系统提示词内链 | customSystemPrompt包含内链 | 解析后使用 | 系统提示词处理 |
| T-A-04 | 变量与内链混合 | 同时包含 `{{@field}}` 和 `[[]]` | 先变量后内链 | 处理顺序 |
| T-A-05 | 禁用解析 | enableInternalLinkParsing=false | 不解析内链 | 动作级配置 |
| T-A-06 | 链接与输出变量 | 提示词引用 `{{output:var}}` 和内链 | 正确处理两者 | 混合场景 |

### 8.2 边界测试场景

| 测试编号 | 测试场景 | 边界条件 | 预期行为 | 验证要点 |
|---------|---------|---------|---------|----------|
| T-B-01 | 空文本输入 | text = '' | 返回空字符串 | 空输入处理 |
| T-B-02 | 无内链文本 | 纯文本无 `[[]]` | 返回原文本 | 无链接场景 |
| T-B-03 | 不完整链接 | 仅 `[[` 或 `]]` | 保持原样 | 格式容错 |
| T-B-04 | 极长链接文本 | 10000字符的链接 | 正常处理或超时 | 大文本处理 |
| T-B-05 | 大量内链 | 100个不同内链 | 分批处理完成 | 并发限制 |
| T-B-06 | 最大嵌套深度 | 链接嵌套6层 | 第6层保留原文 | 深度限制 |
| T-B-07 | 特殊字符链接 | 包含 `#|[]` 等字符 | 正确解析 | 特殊字符处理 |
| T-B-08 | 文件不存在 | 链接指向不存在文件 | 保留原链接 | 错误处理 |

### 8.3 性能测试场景

```
测试维度:
  
1. 解析速度测试
   - 单链接解析时间 < 100ms
   - 10个链接并行解析 < 500ms
   - 缓存命中解析时间 < 10ms

2. 内存使用测试
   - 缓存100个解析结果内存增长 < 10MB
   - 长时间运行无内存泄漏
   - 缓存清理后内存正常释放

3. 并发处理测试
   - 同时处理3个会话的链接解析
   - 多用户场景下的资源隔离
   - 解析队列不阻塞其他操作

性能基准:
  - 单次解析延迟: P95 < 200ms
  - 批量解析吞吐: 20个/秒
  - 缓存命中率: > 60%
```

### 8.4 兼容性测试

```
测试范围:
  
1. Obsidian版本兼容
   - 最低支持版本: v1.4.0
   - 推荐版本: v1.5.0+
   - API兼容性检查

2. 操作系统兼容
   - Windows 11 (主要开发环境)
   - macOS
   - Linux

3. 其他插件兼容
   - Dataview插件共存
   - Templater插件共存
   - 自定义CSS主题影响

4. 特殊场景兼容
   - 移动端Obsidian
   - 同步场景下的缓存一致性
   - 大型Vault性能表现
```

## 9. 实施计划

### 9.1 开发阶段划分

#### 阶段1: 核心服务开发（优先级：高）

```
目标: 实现内链解析核心功能

任务清单:
  1. 创建 InternalLinkResolver 工具类
     - 从TARS模块提取 resolveLinkedContent 函数
     - 移除对RunEnv的依赖
     - 简化接口参数
     - 添加单元测试
     
  2. 创建 InternalLinkParserService 服务类
     - 实现链接识别逻辑
     - 实现批量解析功能
     - 实现缓存机制
     - 实现循环引用检测
     - 添加错误处理
     
  3. 集成调试日志
     - 使用DebugLogger记录关键步骤
     - 定义日志级别和格式
     - 添加性能追踪点

交付物:
  - plugin/src/utils/InternalLinkResolver.ts
  - plugin/src/services/InternalLinkParserService.ts
  - 相关类型定义文件
  - 单元测试文件

验收标准:
  - 单元测试覆盖率 > 80%
  - 所有边界场景测试通过
  - 代码符合TypeScript规范
```

#### 阶段2: AI聊天模块集成（优先级：高）

```
目标: 在AI聊天功能中启用内链解析

任务清单:
  1. 扩展ChatSettings配置接口
     - 添加enableInternalLinkParsing字段
     - 添加parseLinksInTemplates字段
     - 添加性能相关配置
     - 更新默认值
     
  2. 改造ChatService服务
     - 在sendMessage中集成解析服务
     - 处理用户输入内链
     - 处理模板内容内链
     - 处理系统提示词内链
     
  3. 添加配置界面
     - 在设置面板添加内链解析选项
     - 实现配置保存和读取
     - 添加界面提示说明

交付物:
  - 修改后的ChatService.ts
  - 修改后的chat.ts类型定义
  - 配置界面组件
  - 集成测试用例

验收标准:
  - 功能测试场景全部通过
  - 配置开关正常工作
  - 不影响现有聊天功能
  - 性能符合基准要求
```

#### 阶段3: 表单AI动作集成（优先级：中）

```
目标: 在表单AI动作中启用内链解析

任务清单:
  1. 扩展AIFormAction配置接口
     - 添加enableInternalLinkParsing字段
     - 更新默认值和序列化逻辑
     
  2. 改造AIActionService服务
     - 在buildSystemPrompt中集成解析
     - 在buildUserPrompt中集成解析
     - 确保与变量替换的顺序
     
  3. 更新表单编辑器界面
     - AI动作配置面板添加开关
     - 提供功能说明提示

交付物:
  - 修改后的AIActionService.ts
  - 修改后的AIFormAction.ts
  - 表单编辑器UI更新
  - 集成测试用例

验收标准:
  - 功能测试场景全部通过
  - 与变量替换功能协同正常
  - 不影响现有表单功能
  - 配置正确保存和加载
```

#### 阶段4: 优化与文档（优先级：中）

```
目标: 性能优化和完善文档

任务清单:
  1. 性能优化
     - 优化缓存策略
     - 调整并发参数
     - 减少不必要的API调用
     - 性能基准测试
     
  2. 错误处理增强
     - 完善错误分类
     - 优化降级策略
     - 改进日志输出
     
  3. 文档完善
     - 编写用户使用指南
     - 添加代码注释
     - 更新README说明
     - 准备发布说明

交付物:
  - 性能优化报告
  - 用户使用文档
  - 代码注释补充
  - 发布日志

验收标准:
  - 性能基准全部达标
  - 文档清晰完整
  - 代码注释充分
```

### 9.2 开发时间估算

| 阶段 | 主要任务 | 预估工时 | 依赖关系 |
|-----|---------|---------|----------|
| 阶段1 | 核心服务开发 | 8小时 | 无 |
| 阶段2 | AI聊天集成 | 6小时 | 阶段1完成 |
| 阶段3 | 表单动作集成 | 4小时 | 阶段1完成 |
| 阶段4 | 优化与文档 | 4小时 | 阶段2、3完成 |
| 总计 | - | 22小时 | - |

### 9.3 风险控制

| 风险项 | 风险等级 | 影响范围 | 应对措施 |
|-------|---------|---------|----------|
| TARS模块代码重构困难 | 中 | 阶段1 | 保留原函数，新建包装层 |
| 性能不达标 | 中 | 整体功能 | 提前进行性能测试，调整策略 |
| 与现有功能冲突 | 低 | 用户体验 | 充分回归测试，提供降级开关 |
| 循环引用检测遗漏 | 低 | 特定场景 | 设置最大深度硬限制 |
| 缓存一致性问题 | 低 | 缓存机制 | 基于文件修改时间验证 |

## 10. 关键决策记录

### 10.1 架构决策

#### 决策1: 独立服务 vs 直接集成

```
问题: 内链解析功能应该独立为服务还是直接在各模块实现？

选择: 独立服务（InternalLinkParserService）

理由:
  1. 职责分离：解析逻辑与业务逻辑解耦
  2. 代码复用：多个模块共享同一实现
  3. 可测试性：独立服务更易于单元测试
  4. 可维护性：集中管理解析逻辑和配置
  5. 可扩展性：未来可轻松添加新功能

影响:
  - 增加一层抽象，但提升整体架构质量
  - 需要定义清晰的服务接口
  - 各模块通过依赖注入使用服务
```

#### 决策2: 提取TARS功能 vs 直接依赖

```
问题: 是否应该提取TARS的内链解析功能为独立工具？

选择: 提取为独立工具类（InternalLinkResolver）

理由:
  1. 模块解耦：避免Chat和表单模块依赖TARS
  2. 依赖简化：无需引入RunEnv等TARS特有概念
  3. 功能纯化：专注于内链解析核心逻辑
  4. 复用性：可被更多场景使用
  5. 维护性：TARS重构不影响其他模块

影响:
  - 需要重构现有TARS代码
  - 需要保持TARS功能兼容
  - 增加代码量，但降低耦合度
```

### 10.2 技术决策

#### 决策3: 缓存策略

```
问题: 是否需要缓存解析结果？如何实现缓存？

选择: 基于会话的内存缓存 + 文件修改时间验证

理由:
  1. 性能提升：避免重复解析相同链接
  2. 简单实现：使用Map存储，无需持久化
  3. 一致性保证：通过mtime检测文件变化
  4. 内存可控：会话结束自动清理
  5. 无副作用：不影响Obsidian本身缓存

影响:
  - 需要额外内存存储缓存
  - 需要实现缓存验证逻辑
  - 提升重复链接解析速度5-10倍
```

#### 决策4: 错误处理策略

```
问题: 解析失败时应该如何处理？

选择: 优雅降级保留原文 + 调试日志记录

理由:
  1. 用户体验：不中断正常流程
  2. 信息保留：保留原始链接文本
  3. 问题追踪：通过日志辅助调试
  4. 静默处理：不干扰用户操作
  5. 可配置：高级用户可选择严格模式

影响:
  - 错误可能被忽略
  - 需要用户主动查看日志
  - 提升整体稳定性
```

### 10.3 配置决策

#### 决策5: 配置粒度

```
问题: 配置应该是全局的还是模块级的？

选择: 混合策略（全局 + 模块级 + 动作级）

理由:
  1. 灵活性：满足不同场景需求
  2. 全局配置：Chat模块使用全局设置
  3. 动作配置：表单AI动作使用独立开关
  4. 向下兼容：默认值保持功能开启
  5. 用户控制：提供足够的定制空间

配置层级:
  - 全局: ChatSettings (针对聊天模块)
  - 动作: AIFormAction.enableInternalLinkParsing
  - 运行时: ParseOptions (临时覆盖)

影响:
  - 配置管理稍复杂
  - 需要明确配置优先级
  - 提升灵活性和可控性
```

---

**设计文档完成**

本设计文档完整定义了内链解析功能扩展的需求、架构、实现方案和测试策略，为后续开发提供清晰的指导方向。核心策略是复用TARS编辑器的成熟实现，通过提取独立服务的方式集成到AI聊天和表单AI动作模块，同时保持功能的可配置性和向下兼容性。
