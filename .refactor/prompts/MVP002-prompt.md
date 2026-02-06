# 执行任务：扩展 Form 插件的 Settings 框架

**前置要求**：在开始实现之前，必须先读取目标项目 `C:\Desktop\插件开发\.obsidian\plugins\form` 的 `CLAUDE.md` 了解项目开发规范。然后调用 `/find-skills` 搜索与 Obsidian 插件开发、TypeScript、React 组件开发相关的 Skills，调用 `/coding-standards` 获取编码规范，调用 `/frontend-patterns` 获取 React 组件最佳实践。

---

目标项目的设置系统已经有了一个可用的基础版本。当前的 settings.ts 文件定义了 FormPluginSettings 接口，继承自 DebugSettings，包含 debugMode、debugLevel 两个调试配置字段，以及一个示例性质的 mySetting 字段。FormSettingTab 类使用 Obsidian 原生的 Setting API 渲染设置界面，提供了调试模式开关、调试级别下拉选择和一个示例文本输入框。main.ts 中已经集成了 loadSettings、saveSettings 和设置标签页注册逻辑。utils/logger.ts 中的 DebugLogger 类依赖 DebugSettings 接口工作。

你的任务是将这个基础设置系统扩展为支持表单工作流的完整设置框架，并将设置界面从 Obsidian 原生 Setting API 升级为 React 渲染方式，为后续更复杂的设置 UI 做准备。

关于设置接口的扩展，FormPluginSettings 接口需要保留现有的 DebugSettings 继承关系（debugMode 和 debugLevel），但要移除示例性质的 mySetting 字段，替换为表单工作流所需的真实配置项：表单文件的默认存储目录、脚本文件的存储目录、以及 AI 提示词模板的存储目录。这三个配置项都是字符串类型的 Vault 内相对路径，默认值应分别指向 System/form、System/scripts 和 System/ai-prompts 目录。DEFAULT_SETTINGS 常量需要同步更新，确保包含所有字段的默认值。

关于设置标签页的 React 化，当前的 FormSettingTab 直接使用 Obsidian 的 Setting 类来构建 UI。为了支持后续更复杂的设置界面（如带 Tab 切换的多面板布局），需要改为使用 React 18 的 createRoot 来挂载 React 组件树。FormSettingTab 类仍然继承 Obsidian 的 PluginSettingTab，但在 display 方法中创建一个 DOM 挂载点并渲染 React 组件，在 hide 方法中卸载 React 组件树以防止内存泄漏。

关于设置视图组件，创建一个 React 组件作为设置界面的根组件。组件接收当前设置对象和保存回调作为属性。界面需要分为两个区域：通用设置区域和调试设置区域。通用设置区域包含三个文件夹路径输入框，每个输入框要显示设置项名称、描述说明和文本输入控件。调试设置区域保留现有的调试模式开关和日志级别选择。所有设置项的标签和描述文本暂时使用中文硬编码（国际化将在 MVP003 中实现）。每个设置项变更时应立即保存，不需要额外的保存按钮。界面样式应遵循 Obsidian 设置页面的视觉风格，使用 Obsidian 提供的 CSS 类名（如 setting-item、setting-item-info、setting-item-name、setting-item-description、setting-item-control）。

关于文件组织，当前 settings.ts 是一个包含接口定义和 UI 组件的单文件。扩展后应按职责拆分：设置接口和默认值作为独立模块，设置标签页适配器（负责 React 挂载/卸载）作为独立模块，React 设置视图组件作为独立模块。所有设置相关文件应放在 src/settings/ 目录下，原来的 src/settings.ts 文件内容应迁移至该目录并在新的 index.ts 中统一导出，确保 main.ts 中已有的导入路径调整最小化。

关于与现有代码的集成，main.ts 中已有的 loadSettings 和 saveSettings 逻辑应保持不变，只需要调整导入路径。DebugLogger 的 updateSettings 调用模式也需要保留——当调试相关设置变更时，要调用 logger.updateSettings 同步日志器的配置。命令管理器和模态框组件不需要修改。

关于边界处理，当用户输入空字符串作为文件夹路径时应回退到默认值。设置加载时使用 Object.assign 合并机制确保新增字段有默认值，兼容旧版本保存的数据中不存在新字段的情况。

验收时需要确认以下几点：执行 npm run build 编译无错误，执行 npm run lint 检查无警告，在 Obsidian 设置页面中能看到 Form 插件的设置标签页且界面正确渲染，三个文件夹路径输入框能正确显示和编辑，调试模式开关和日志级别选择功能正常，修改任何设置后重启插件设置值保持不变，关闭并重新打开设置页面不会出现内存泄漏或 React 报错。

本次任务的边界是只扩展基础设置框架，不添加 TARS 和 Chat 相关设置，不实现 API Key 加密存储，不添加设置数据验证逻辑，不实现设置迁移机制。这些内容将在后续 MVP 中按需添加。

**执行提示**：完成实现后，请调用 `/code-review` 对代码进行质量审查。特别注意 React 组件的挂载和卸载是否正确处理、设置变更后 DebugLogger 是否同步更新。
