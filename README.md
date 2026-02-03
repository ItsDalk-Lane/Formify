# Formify

> 强大的 Obsidian 工作流与 AI 集成插件

[![Version](https://img.shields.io/badge/version-0.2.8.260203-blue.svg)](https://github.com/vran-dev/obsidian-form-flow)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.8.0+-purple.svg)](https://obsidian.md)

## 📖 项目简介

Formify 是一个功能强大的 Obsidian 插件，结合了表单工作流系统和 AI 聊天功能，为用户提供高效的知识管理和内容创作体验。

### 核心特性

- **📋 表单工作流系统** - 创建简单、单动作的工作流
- **🤖 AI 聊天功能** - 集成 17+ 个主流 AI 提供商
- **🛠️ 技能系统** - 支持自定义提示词和技能组
- **⚡ 快捷工具栏** - 划词快捷 AI 操作
- **🎯 Tab 补全** - AI 辅助文本补全
- **🔧 工具调用** - 支持 Tool Calling 功能

## 🏗️ 项目来源

本项目基于以下两个优秀的开源项目构建：

- **[obsidian-form-flow](https://github.com/vran-dev/obsidian-form-flow)** by [vran](https://github.com/vran-dev)
  - 提供表单工作流系统的核心功能
  - 实现表单定义、字段类型和动作执行

- **[obsidian-tars](https://github.com/TarsLab/obsidian-tars)** by [TarsLab](https://github.com/TarsLab)
  - 提供多 AI 提供商集成

> 💡 本项目在两个开源项目的基础上进行了深度整合和功能扩展，实现了表单工作流与 AI 功能的无缝集成。

## ✨ 主要功能

### 1. 表单工作流系统

#### 丰富的字段类型

支持 15+ 种字段类型：
- 文本输入 / 文本域 / 密码
- 数字 / 日期时间 / 时间
- 选择框 / 复选框 / 单选按钮
- 文件列表 / 文件夹路径
- 属性值输入 / 开关切换

#### 强大的动作系统

支持 20+ 种动作类型：
- **AI 动作** - 调用大模型处理内容
- **文件操作** - 创建文件、插入文本
- **命令执行** - 执行 Obsidian 命令和脚本
- **循环控制** - break / continue / loop
- **数据收集** - 收集表单数据
- **表单生成** - 动态生成子表单

#### 灵活的执行模式

- **串行执行** - 按顺序依次执行动作
- **并行执行** - 同时执行多个动作
- **条件控制** - 根据条件跳过或执行动作
- **循环控制** - 支持循环和中断

### 2. AI 聊天功能

#### 多提供商支持

集成 17+ 个主流 AI 提供商：
- OpenAI (GPT-4, GPT-3.5)
- Anthropic Claude
- Google Gemini
- 阿里通义千问
- 百度文心一言
- Ollama (本地模型)
- Kimi 月之暗面
- DeepSeek
- Grok
- 等等...

#### 聊天会话管理

- 创建、保存、加载聊天历史
- 支持文件、文件夹、图片作为上下文
- 全局和会话级系统提示词
- 自动解析 Obsidian 内部链接
- 实时流式响应输出

#### 技能系统

- **普通技能** - 自定义提示词
- **技能组** - 组织和管理子技能
- **表单技能** - 调用表单工作流
- **3 层嵌套** - 支持最多 3 层技能组嵌套

#### 快捷操作

- **快捷工具栏** - 划词后快速调用 AI 技能
- **编辑器触发** - 输入 @ 符号触发 AI 补全
- **右键菜单** - 在选中文本上快速调用

### 3. TARS 功能

- **Tab 补全** - AI 辅助文本补全
- **推理模式** - 支持推理模型
- **图像支持** - 视觉和图像生成能力
- **加密存储** - API 密钥安全加密存储

## 🚀 快速开始

### 环境要求

- **Obsidian 版本**: 1.8.0 或更高
- **Node.js 版本**: 18.0 或更高（开发使用）
- **操作系统**: Windows / macOS / Linux

### 安装方式

#### 方式一：手动安装

1. 下载最新版本的 [main.js](releases) 和 [manifest.json](releases)
2. 在你的 Obsidian vault 中创建插件目录：`.obsidian/plugins/formify/`
3. 将下载的文件复制到该目录
4. 重启 Obsidian 并在设置中启用 Formify 插件

#### 方式二：从源码构建

```bash
# 克隆仓库
git clone https://github.com/your-username/form-flow.git
cd form-flow/plugin

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 本地测试（构建并复制到本地 vault）
npm run build:local
```

### 基础配置

1. **启用插件** - 在 Obsidian 设置中启用 Formify
2. **配置 AI** - 在插件设置中添加 API 密钥
3. **创建表单** - 右键文件 → 创建新的表单
4. **开始聊天** - 使用命令面板打开 AI 聊天窗口

## 📁 项目结构

```
form-flow/
├── plugin/                    # 插件核心代码
│   ├── src/
│   │   ├── main.ts           # 插件入口
│   │   ├── api/              # API 接口层
│   │   ├── component/        # React 组件库（30+ 组件）
│   │   ├── context/          # React Context
│   │   ├── features/         # 功能模块
│   │   │   ├── chat/         # AI 聊天功能
│   │   │   └── tars/         # AI 文本生成与推理
│   │   ├── hooks/            # React Hooks
│   │   ├── i18n/             # 国际化
│   │   ├── model/            # 数据模型
│   │   ├── service/          # 业务服务层
│   │   ├── settings/         # 设置管理
│   │   ├── style/            # 样式文件
│   │   ├── types/            # TypeScript 类型
│   │   ├── utils/            # 工具函数
│   │   └── view/             # 视图层
│   ├── esbuild.config.mjs    # 构建配置
│   ├── tsconfig.json         # TypeScript 配置
│   ├── package.json          # 依赖配置
│   └── manifest.json         # 插件清单
└── README.md                 # 项目说明文档
```

## 🛠️ 技术栈

### 核心技术

- **TypeScript 4.7** - 主要开发语言
- **React 18.3** - UI 框架
- **Obsidian API** - 插件基础 API

### 构建工具

- **esbuild 0.17** - 快速打包构建
- **TypeScript** - 类型检查和编译

### UI 组件

- **Radix UI** - 无障碍 UI 组件库
- **Atlaskit Pragmatic Drag and Drop** - 拖拽功能
- **Lucide React** - 图标库
- **@floating-ui/react** - 浮动定位
- **@tanstack/react-virtual** - 虚拟滚动
- **CodeMirror 6** - 代码编辑器

### AI 集成

- **@anthropic-ai/sdk** - Claude API
- **openai** - OpenAI API
- **@google/generative-ai** - Gemini API
- **ollama** - 本地 Ollama 模型
- **axios** - HTTP 客户端
- **gpt-tokenizer** - Token 计数

### 工具库

- **uuid** - 唯一标识符生成
- **luxon** - 日期时间处理
- **handlebars** - 模板引擎
- **jose** - JWT 加密
- **react-error-boundary** - 错误边界

## 📝 使用示例

### 创建表单工作流

1. 在任意笔记中，点击右键菜单
2. 选择 "Create new form"
3. 定义字段和动作
4. 保存并执行表单

### 使用 AI 聊天

1. 使用命令面板 (Ctrl/Cmd + P)
2. 输入 "Open AI Chat"
3. 选择 AI 提供商和模型
4. 开始对话

### 配置技能

1. 打开插件设置
2. 进入 "Skills" 标签
3. 创建新技能或技能组
4. 配置提示词和参数

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 代码规范

- 遵循 TypeScript 严格模式
- 使用 2 空格缩进
- 保持函数单一职责
- 添加适当的注释和类型定义

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 🙏 致谢

- [obsidian-form-flow](https://github.com/vran-dev/obsidian-form-flow) - 表单工作流系统
- [obsidian-tars](https://github.com/TarsLab/obsidian-tars) - AI 集成功能
- [Obsidian](https://obsidian.md) - 强大的知识管理工具
- 所有贡献者和支持者

## 📮 联系方式

- **作者**: Lane
- **GitHub**: [ItsDalk-Lane](https://github.com/ItsDalk-Lane)

---

<p align="center">
  <b>如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！</b>
</p>
