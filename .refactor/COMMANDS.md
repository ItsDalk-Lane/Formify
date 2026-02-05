# Form 重构任务系统 - 使用指南

## 系统概述

本系统帮助你逐步从零重构 Form Obsidian 插件。系统包含：

- **state.json** - 项目状态和 MVP 队列
- **mvps/** - 每个 MVP 的详细说明
- **prompts/** - 对应的执行 Prompt
- **PROMPT-DESIGN-RULES.md** - 执行 Prompt 的设计规则（**重要**）

## 项目路径

| 路径类型 | 地址 | 说明 |
|---------|------|------|
| **目标项目** | `C:\Desktop\插件开发\.obsidian\plugins\form` | 实际开发和代码输出位置 |
| **参考项目** | `c:\Desktop\code\form-flow\plugin` | 原版 Formify 代码参考 |

**重要约束**：
- 插件 ID 为 `form`，显示名称为 `Form`，**不可更改**
- 目标项目中的 `manifest.json`、`package.json`、`esbuild.config.mjs` 等配置文件**不可修改**
- 必须遵守目标项目中 `CLAUDE.md` 定义的开发规范
- 设计下一个 MVP 的 Prompt 时，需要查看**目标项目**中已完成的代码

## 交互命令

| 命令 | 说明 |
|------|------|
| `下一个` | 显示当前 MVP 的执行 Prompt |
| `完成` | 标记当前 MVP 完成，显示下一个 |
| `完成，备注：xxx` | 同上，并记录备注 |
| `跳过` | 跳过当前 MVP，显示下一个 |
| `进度` | 显示整体进度和剩余 MVP |
| `详情 MVP#N` | 显示指定 MVP 的完整信息 |
| `重新生成 MVP#N` | 重新生成指定 MVP 的 Prompt |

## MVP 列表概览

### 基础设施（MVP001-007）
- MVP001: 插件骨架
- MVP002: Settings 框架
- MVP003: 国际化系统
- MVP004: ServiceContainer
- MVP005: 表单数据模型
- MVP006: 基础 UI 组件库
- MVP007: React Context

### 核心表单功能（MVP008-016）
- MVP008: 条件过滤系统
- MVP009: 模板引擎
- MVP010: 表单字段组件
- MVP011: Action Chain 框架
- MVP012: 文件操作服务
- MVP013: 基础 Action 实现
- MVP014: FormService 核心
- MVP015: 表单文件视图
- MVP016: 表单编辑器基础

### 命令与脚本（MVP017-019）
- MVP017: 命令系统
- MVP018: 脚本执行服务
- MVP019: 更多 Action 实现

### AI 功能（MVP020-025）
- MVP020: AI Provider 框架
- MVP021: OpenAI Provider
- MVP022: AI Action 实现
- MVP023: Chat 基础功能
- MVP024: Tab Completion
- MVP025: Tool Calling 框架

## 开始重构

目标项目已搭建好基础骨架，直接对我说：

```
下一个
```

## 状态文件说明

### state.json 结构

```json
{
  "project_name": "项目名称",
  "current_mvp": "当前 MVP ID 或 null",
  "completed_mvps": ["已完成的 MVP 列表"],
  "mvp_queue": ["待完成的 MVP 队列"],
  "features": [
    {
      "id": "F001",
      "name": "功能名称",
      "status": "pending | current | done | skipped"
    }
  ],
  "notes": {
    "MVP001": "用户备注"
  }
}
```

### MVP 状态流转

```
pending → current → done
                 ↘ skipped
```

## Prompt 设计流程

当执行 `完成` 或 `重新生成 MVP#N` 命令时，需要为下一个 MVP 设计执行 Prompt。

**必须遵循 [PROMPT-DESIGN-RULES.md](./PROMPT-DESIGN-RULES.md) 中定义的规则**，核心要点：

1. **前置 Skill 调用**：设计前先调用 `/find-skills` 搜索相关 Skills
2. **审查已完成代码**：基于实际实现的代码来设计集成方式
3. **格式要求**：
   - 任务指令口吻，行文连贯
   - 先说明现状上下文，再描述具体功能
   - 功能描述包含行为、数据结构、交互规则、边界处理、UI布局等
   - **禁止**包含代码、伪代码或技术方案
   - **禁止**使用章节编号标题
4. **Skill 推荐**：根据 MVP 类型在 Prompt 中要求调用对应的 Skills

## 最佳实践

1. **每个 MVP 完成后验证**：确保验收标准全部通过
2. **保持提交频率**：每个 MVP 完成后 git commit
3. **记录问题**：遇到问题时使用备注功能记录
4. **不要跳过**：除非确认功能不需要，否则不要跳过 MVP
5. **设计 Prompt 前阅读规则**：每次设计新 Prompt 前回顾 PROMPT-DESIGN-RULES.md

## 文件位置

```
.refactor/
├── state.json              # 项目状态
├── COMMANDS.md             # 本文件（使用指南）
├── PROMPT-DESIGN-RULES.md  # Prompt 设计规则（重要）
├── mvps/
│   ├── MVP001.md          # MVP 说明
│   ├── MVP002.md
│   └── ...
└── prompts/
    ├── MVP001-prompt.md   # 执行 Prompt
    ├── MVP002-prompt.md
    └── ...
```
