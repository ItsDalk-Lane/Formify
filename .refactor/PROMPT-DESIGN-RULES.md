# 执行 Prompt 设计规则

> 本文档定义了为每个 MVP 创建执行 Prompt 时必须遵循的规则和格式要求。

---

## 项目路径与规范

| 路径类型 | 地址 |
|---------|------|
| **目标项目** | `C:\Desktop\插件开发\.obsidian\plugins\form` |
| **参考项目** | `c:\Desktop\code\form-flow\plugin` |

**关键约束**：

- 插件 ID 为 `form`，显示名称为 `Form`，作者为 `vran`，**不可更改**
- 目标项目中的配置文件（manifest.json、package.json、esbuild.config.mjs、tsconfig.json）**不可修改**
- **必须遵守**目标项目中 `CLAUDE.md` 定义的开发规范，包括：
  - 源代码使用 2 空格缩进
  - 所有日志必须经过 DebugLogger，禁止裸 console 调用
  - main.ts 仅做注册和生命周期管理，禁止业务逻辑
  - 使用依赖注入模式，禁止全局变量存储插件实例
  - 异步操作必须包含 try/catch，用户可见失败用 Notice 提示
  - 新增模块按规定放入正确目录（commands/、ui/modals/、services/、utils/）
- 设计 Prompt 时查看**目标项目**中已完成的代码，基于实际实现来设计集成方式

---

## 设计流程

在设计任何 MVP 的执行 Prompt 之前，**必须**执行以下步骤：

1. **读取目标项目 CLAUDE.md**：确保了解项目专属开发规范
2. **查看目标项目已完成代码**：基于实际文件结构和命名来设计
3. **调用 `/find-skills`** 搜索与该 MVP 功能相关的 Skills
4. **调用 `/coding-standards`** 获取 TypeScript/React 编码规范
5. **根据 MVP 类型**调用对应的专业 Skills（见下方推荐列表）

---

## 输出格式要求

### 1. 口吻与风格
- 以**任务指令**的口吻撰写，直接告诉执行者要做什么
- 使用第二人称"你"来描述任务
- 行文连贯自然，像一份完整的任务简报

### 2. 结构组织
- **先简要说明相关模块的现状**作为上下文背景
- **自然过渡**到具体的功能需求描述
- **不使用**"第一部分"、"第二部分"、"### 1."等章节标题
- 用"关于..."、"对于..."等自然语句引导不同主题

### 3. 功能描述要求
每个功能点必须包含以下信息（根据适用性）：
- **行为描述**：该功能具体做什么，触发条件是什么
- **数据结构**：涉及的数据模型、接口、类型定义的字段和含义
- **交互规则**：用户如何与功能交互，系统如何响应
- **边界处理**：异常情况、空值、极端输入的处理方式
- **兼容性要求**：与现有功能、API、数据格式的兼容考虑
- **UI 布局**：（如适用）界面元素的位置、层级、样式要求
- **交互流程**：（如适用）用户操作的完整流程和状态变化

### 4. 禁止内容
- **禁止**包含任何代码片段
- **禁止**包含伪代码
- **禁止**提供技术方案建议或实现细节
- **禁止**使用代码格式的文件结构树

### 5. 必须包含的元素
```markdown
# 执行任务：[MVP名称]

**前置要求**：在开始实现之前，必须先调用 `/find-skills` 搜索与 [相关技术领域] 相关的 Skills，并调用 `/coding-standards` 获取编码规范指导。[根据MVP类型添加其他必要的Skill调用要求]

---

[上下文背景段落]

[任务目标段落]

[功能描述段落1 - 以"关于..."开头]

[功能描述段落2 - 以"关于..."开头]

...

[验收要求段落]

[边界说明段落]

**执行提示**：完成实现后，请调用 `/code-review` 对生成的代码进行质量审查。[根据MVP类型添加其他Skill调用建议]
```

---

## Skills 推荐对照表

根据 MVP 的功能类型，在前置要求和执行提示中推荐调用以下 Skills：

### 基础设施类 (MVP001-007)
| MVP | 推荐 Skills |
|-----|------------|
| 插件骨架 | `/coding-standards`, `/find-skills` |
| Settings 框架 | `/coding-standards`, `/vercel-react-best-practices`, `/frontend-patterns` |
| 国际化系统 | `/coding-standards` |
| ServiceContainer | `/coding-standards`, `/backend-patterns` |
| 数据模型 | `/coding-standards` |
| UI 组件库 | `/vercel-react-best-practices`, `/frontend-patterns` |
| React Context | `/vercel-react-best-practices`, `/frontend-patterns` |

### 核心表单功能类 (MVP008-016)
| MVP | 推荐 Skills |
|-----|------------|
| 条件过滤系统 | `/coding-standards`, `/backend-patterns` |
| 模板引擎 | `/coding-standards` |
| 表单字段组件 | `/vercel-react-best-practices`, `/frontend-patterns` |
| Action Chain | `/coding-standards`, `/backend-patterns` |
| 文件操作服务 | `/coding-standards`, `/security-review` |
| Action 实现 | `/coding-standards`, `/tdd-workflow` |
| FormService | `/coding-standards`, `/backend-patterns` |
| 表单视图 | `/vercel-react-best-practices`, `/frontend-patterns` |
| 表单编辑器 | `/vercel-react-best-practices`, `/frontend-patterns` |

### 命令与脚本类 (MVP017-019)
| MVP | 推荐 Skills |
|-----|------------|
| 命令系统 | `/coding-standards` |
| 脚本执行服务 | `/coding-standards`, `/security-review` |
| Action 扩展 | `/coding-standards`, `/tdd-workflow` |

### AI 功能类 (MVP020-025)
| MVP | 推荐 Skills |
|-----|------------|
| AI Provider 框架 | `/coding-standards`, `/backend-patterns` |
| OpenAI Provider | `/coding-standards`, `/security-review` |
| AI Action | `/coding-standards`, `/tdd-workflow` |
| Chat 基础 | `/vercel-react-best-practices`, `/frontend-patterns` |
| Tab Completion | `/coding-standards`, `/frontend-patterns` |
| Tool Calling | `/coding-standards`, `/backend-patterns`, `/security-review` |

---

## 根据已完成代码设计 Prompt 的要点

当上一个 MVP 完成后，设计下一个 MVP 的执行 Prompt 时需要：

1. **审查已完成代码**
   - 了解实际创建的文件结构和命名
   - 确认已实现的接口和类型定义
   - 识别可复用的模式和约定

2. **建立依赖关系**
   - 明确新 MVP 需要导入和使用的现有模块
   - 说明与已有代码的集成点
   - 描述需要扩展或修改的现有文件

3. **保持一致性**
   - 延续已建立的命名规范
   - 遵循已有的代码组织结构
   - 复用已定义的类型和接口

4. **具体化描述**
   - 基于实际代码而非假设来描述集成方式
   - 使用已存在的类名、函数名、路径
   - 引用已实现的功能作为基础

---

## 示例：好的 Prompt vs 差的 Prompt

### 差的 Prompt（避免）
```markdown
### 1. 创建文件
创建 `src/settings/PluginSettings.ts` 文件：
```typescript
interface PluginSettings {
  formFolder: string;
}
```

### 2. 实现功能
实现设置保存功能。
```

**问题**：
- 使用了章节标题
- 包含代码
- 描述过于简单

### 好的 Prompt（推荐）
```markdown
关于设置数据结构，需要定义一个接口来描述所有插件配置项。核心配置包括表单文件存储目录、脚本文件存储目录、以及 AI 提示词模板目录。每个目录配置都是字符串类型的路径值，需要提供合理的默认值指向 System 目录下的对应子文件夹。当用户未配置或配置为空时，应回退到默认值。

关于设置的持久化，利用 Obsidian Plugin 基类提供的 loadData 和 saveData 方法实现配置的读写。加载时需要将存储的数据与默认值合并，确保新增的配置项有默认值可用。保存时将当前配置对象序列化后写入插件数据文件。这两个操作都是异步的，需要在适当的生命周期节点调用。
```

---

## 验收清单

设计完成的 Prompt 应满足：

- [ ] 包含前置要求，指定必须调用的 Skills
- [ ] 以上下文背景开篇，说明当前模块现状
- [ ] 功能描述具体、完整，无遗漏关键细节
- [ ] 不包含任何代码或伪代码
- [ ] 不使用章节编号或标题
- [ ] 行文连贯，段落间自然过渡
- [ ] 包含明确的验收标准
- [ ] 包含边界说明（本次做什么、不做什么）
- [ ] 包含执行提示，建议完成后调用的 Skills
