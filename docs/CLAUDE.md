# Formify - Obsidian 表单插件开发指南

## 项目概述

Formify 是一个强大的 Obsidian 插件，旨在通过可视化表单构建器帮助用户创建简单的一键式工作流。该插件无需编程知识，提供拖拽式界面，可以替代 Templater 和 QuickAdd 等插件，显著提升工作效率。

### 主要功能
- 💡 **即时捕获灵感**：一键保存到指定位置，不再丢失创意想法
- 🚀 **高效模板管理**：轻松创建会议、联系人、项目等模板
- 🛫 **无限可能性**：从简单数据录入到高级自动化，支持创建文件、插入文本、更新属性、运行脚本等
- 🚢 **无需编码**：完全可视化编辑，配置直观易用
- 🤖 **AI 动作支持**：集成多种 AI 模型（OpenAI、Anthropic、Google、Ollama），支持智能文本生成和处理

## 技术栈

- **框架**: Obsidian Plugin API
- **语言**: TypeScript
- **UI 框架**: React 18.3.0
- **构建工具**: esbuild
- **状态管理**: React Context + Hooks
- **样式**: CSS
- **AI 集成**: OpenAI、Anthropic Claude、Google Gemini、Ollama
- **模板引擎**: Handlebars + 自定义模板处理器

### 核心依赖
- `obsidian`: Obsidian API
- `react` & `react-dom`: UI 组件
- `@atlaskit/pragmatic-drag-and-drop`: 拖拽功能
- `@codemirror/*`: 代码编辑器
- `handlebars`: 模板处理
- `luxon`: 日期时间处理
- `uuid`: 唯一标识符生成

## 项目结构

```
form-flow/
├── plugin/                    # 插件主目录
│   ├── src/
│   │   ├── main.ts           # 插件入口点
│   │   ├── api/              # API 接口
│   │   ├── component/        # React 组件
│   │   │   ├── modal/        # 模态框组件
│   │   │   ├── combobox/     # 组合框组件
│   │   │   ├── toast/        # 提示组件
│   │   │   └── ...
│   │   ├── context/          # React Context
│   │   ├── features/         # 功能模块
│   │   │   └── tars/         # AI 功能模块
│   │   ├── hooks/            # React Hooks
│   │   ├── i18n/             # 国际化
│   │   ├── model/            # 数据模型
│   │   │   ├── action/       # 动作模型
│   │   │   ├── field/        # 字段模型
│   │   │   └── enums/        # 枚举定义
│   │   ├── service/          # 业务服务
│   │   │   ├── action/       # 动作服务
│   │   │   ├── engine/       # 模板引擎
│   │   │   ├── filter/       # 过滤器服务
│   │   │   └── ...
│   │   ├── settings/         # 插件设置
│   │   ├── utils/            # 工具函数
│   │   ├── view/             # 视图组件
│   │   │   ├── edit/         # 编辑视图
│   │   │   └── preview/      # 预览视图
│   │   └── style/            # 样式文件
│   ├── package.json          # 依赖配置
│   └── manifest.json         # 插件清单
├── website/                  # 文档网站
└── README.md                 # 项目说明
```

## 核心服务类及职责

### 1. 主插件类 (FormPlugin)
**位置**: `plugin/src/main.ts:14`
- **职责**: 插件生命周期管理、设置加载保存、服务初始化
- **关键方法**: `onload()`, `onunload()`, `loadSettings()`, `saveSettings()`

### 2. 应用命令服务 (ApplicationCommandService)
**位置**: `plugin/src/service/command/ApplicationCommandService.ts:15`
- **职责**: 注册和管理 Obsidian 命令
- **核心功能**: 
  - 打开表单命令 (`open-form`)
  - 创建表单命令 (`create-form`)

### 3. 表单脚本服务 (FormScriptService)
**位置**: `plugin/src/service/extend/FormScriptService.ts:8`
- **职责**: 管理用户自定义脚本函数
- **核心功能**:
  - 脚本文件监控和热重载
  - 脚本编译和执行
  - 函数注册和管理

### 4. 动作服务链 (ActionChain)
**位置**: `plugin/src/service/action/IActionService.ts:40`
- **职责**: 管理和执行表单动作
- **核心功能**:
  - 动作链式执行
  - 条件判断和过滤
  - 智能调度优化

### 5. 模板处理引擎 (FormTemplateProcessEngine)
**位置**: `plugin/src/service/engine/FormTemplateProcessEngine.ts:7`
- **职责**: 处理模板变量替换
- **支持的变量**:
  - `{{@fieldName}}`: 表单字段变量
  - `{{output:variableName}}`: AI 动作输出变量
  - `{{selection}}`: 当前选中文本
  - `{{clipboard}}`: 剪贴板内容

### 6. 表单值管理 (FormState/FormValues)
**位置**: `plugin/src/service/FormState.ts:3`, `plugin/src/service/FormValues.ts:1`
- **职责**: 管理表单数据状态
- **核心类**:
  - `FormState`: 表单状态容器
  - `FormIdValues`: 按 ID 索引的字段值
  - `FormLabelValues`: 按标签索引的字段值

## 重要模式和约定

### 1. 表单配置模式
```typescript
// 标准表单配置结构
interface FormConfig {
  id: string;           // 唯一标识符
  fields: IFormField[]; // 字段定义数组
  actions: IFormAction[]; // 动作定义数组
  autoSubmit: boolean;  // 自动提交标志
}
```

### 2. 字段定义模式
```typescript
// 基础字段接口
interface IFormField {
  id: string;           // 唯一 ID
  label: string;        // 显示标签
  type: FormFieldType;  // 字段类型
  placeholder?: string; // 占位符
  description?: string; // 描述信息
  defaultValue?: any;   // 默认值
  required?: boolean;   // 必填标志
  condition?: Filter;   // 显示条件
}
```

### 3. 动作定义模式
```typescript
// 基础动作接口
interface IFormAction {
  id: string;           // 唯一 ID
  type: FormActionType; // 动作类型
  condition?: Filter;   // 执行条件
  remark?: string;      // 备注信息
}
```

### 4. 服务注册模式
所有动作服务都实现 `IActionService` 接口：
```typescript
interface IActionService {
  accept(action: IFormAction, context: ActionContext): boolean;
  run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<any>;
}
```

### 5. 模板变量约定
- **字段变量**: `{{@fieldName}}` - 引用表单字段值
- **输出变量**: `{{output:variableName}}` - 引用 AI 动作输出
- **系统变量**: `{{selection}}`, `{{clipboard}}` - 系统内置变量
- **Obsidian 模板**: 支持 `{{date}}`, `{{time}}` 等 Obsidian 内置变量

## 添加新的表单字段

### 步骤 1: 定义字段类型
在 `plugin/src/model/enums/FormFieldType.ts` 中添加新类型：
```typescript
export enum FormFieldType {
  // 现有类型...
  NEW_FIELD_TYPE = 'new-field-type',
}
```

### 步骤 2: 创建字段接口
在 `plugin/src/model/field/` 目录下创建字段定义文件：
```typescript
// INewField.ts
export interface INewField extends IFormField {
  type: FormFieldType.NEW_FIELD_TYPE;
  // 添加特定属性
  customProperty?: string;
}
```

### 步骤 3: 更新类型联合
在 `plugin/src/model/field/IFormField.ts:29` 的 `FormField` 类型中添加新字段类型：
```typescript
export type FormField =
  | ITextField
  | INewField  // 添加新字段类型
  // 其他现有类型...
```

### 步骤 4: 创建渲染组件
在 `plugin/src/view/shared/control/` 目录下创建字段控制组件：
```typescript
// NewFieldControl.tsx
export const NewFieldControl: React.FC<FormFieldControlProps<INewField>> = ({ field, value, onChange }) => {
  // 实现字段渲染逻辑
};
```

### 步骤 5: 创建设置组件
在 `plugin/src/view/edit/setting/field/` 目录下创建字段设置组件。

### 步骤 6: 注册字段
在字段渲染器和设置器中注册新字段类型。

## 添加新的动作类型

### 步骤 1: 定义动作类型
在 `plugin/src/model/enums/FormActionType.ts` 中添加新类型：
```typescript
export enum FormActionType {
  // 现有类型...
  NEW_ACTION_TYPE = 'new-action-type',
}
```

### 步骤 2: 创建动作接口
在 `plugin/src/model/action/` 目录下创建动作定义：
```typescript
// INewAction.ts
export interface INewAction extends IFormAction {
  type: FormActionType.NEW_ACTION_TYPE;
  // 添加特定属性
  targetPath?: string;
  options?: NewActionOptions;
}
```

### 步骤 3: 实现动作服务
在 `plugin/src/service/action/` 目录下创建服务实现：
```typescript
// NewActionService.ts
export default class NewActionService implements IActionService {
  accept(action: IFormAction, context: ActionContext): boolean {
    return action.type === FormActionType.NEW_ACTION_TYPE;
  }

  async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
    // 实现动作逻辑
    await chain.next(context);
  }
}
```

### 步骤 4: 注册服务
在 `plugin/src/service/action/IActionService.ts:44` 的 `actionServices` 数组中注册新服务。

### 步骤 5: 创建设置组件
在 `plugin/src/view/edit/setting/action/` 目录下创建动作设置组件。

## 开发工作流程

### 1. 开发环境设置
```bash
cd plugin
npm install
npm run dev  # 启动开发模式
```

### 2. 构建和测试
```bash
npm run build        # 生产构建
npm run build:local  # 本地构建并复制到 vault
```

### 3. 代码规范
- 使用 TypeScript 严格模式
- 遵循 React Hooks 最佳实践
- 组件使用函数式组件和 Hooks
- 服务类使用单例模式

### 4. 调试技巧
- 使用 Obsidian 开发者控制台
- 启用 Tars 调试模式进行 AI 功能调试
- 使用 `DebugLogger` 进行日志记录

### 5. 发布流程
1. 更新版本号 (`npm run version`)
2. 构建生产版本
3. 测试功能完整性
4. 提交代码并创建发布标签

## 重要文件位置速查

- **插件入口**: `plugin/src/main.ts:14`
- **设置管理**: `plugin/src/settings/PluginSettings.ts:8`
- **表单配置**: `plugin/src/model/FormConfig.ts:6`
- **动作链**: `plugin/src/service/action/IActionService.ts:40`
- **模板引擎**: `plugin/src/service/engine/FormTemplateProcessEngine.ts:7`
- **AI 功能**: `plugin/src/features/tars/`
- **脚本服务**: `plugin/src/service/extend/FormScriptService.ts:8`
- **命令服务**: `plugin/src/service/command/ApplicationCommandService.ts:15`

## 最佳实践

1. **组件设计**: 保持组件单一职责，使用 TypeScript 接口定义 props
2. **服务架构**: 使用依赖注入，服务间通过接口通信
3. **错误处理**: 在关键操作中添加适当的错误处理和用户提示
4. **性能优化**: 使用 React.memo 和 useMemo 优化渲染性能
5. **国际化**: 支持多语言，使用 `localInstance` 进行文本本地化
6. **测试覆盖**: 为核心业务逻辑编写单元测试
7. **文档更新**: 添加新功能时同步更新相关文档

这份指南将帮助你快速理解 Formify 插件的架构和开发模式，为后续的功能扩展和维护提供参考。