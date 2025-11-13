# Obsidian 插件开发规则

## 核心架构要求

### 1. main.ts 文件职责（必须遵守）
- **必须包含**：继承自 `Plugin` 的主插件类，并作为默认导出
- **必须包含**：`onload()` 和 `onunload()` 生命周期方法
- **必须在此处**：所有 Obsidian API 的注册调用（`addCommand`, `addRibbonIcon`, `addSettingTab`, `registerView` 等）
- **保持简洁**：只包含注册、初始化和生命周期管理，不包含具体业务逻辑

### 2. 模块化要求
- **命令实现**：具体的命令逻辑必须分离到独立的模块文件
- **UI 组件**：所有 Modal、View、SettingTab 等 UI 组件放在独立文件
- **业务逻辑**：数据处理、文件操作等业务逻辑放在 services 目录
- **工具函数**：通用工具函数放在 utils 目录
- **设置管理**：设置接口定义和管理逻辑分离到独立文件

### 3. 推荐目录结构
```
src/
├── main.ts              # 插件入口（仅核心注册逻辑）
├── settings.ts          # 设置接口和管理
├── commands/            # 命令实现
├── ui/                  # UI 组件
│   ├── modals/
│   ├── views/
│   └── settings-tab.ts
├── services/            # 业务逻辑服务
└── utils/               # 工具函数
```

## 开发环境与构建规则

### 4. 构建要求（强制）
- 🔧 **必须使用** `npm run build` 构建 Obsidian 插件项目文件
- 🚫 **严禁使用** `npm run dev` 命令来启动开发服务器来验证修复效果
- ✅ **依赖**真实 Obsidian 环境测试
- ✅ **信任** Obsidian 的调试能力

### 5. Windows 开发环境优化
- 🖥️ **利用 Windows 特性**：
  - 使用 Windows 原生路径处理
  - 考虑 Windows 文件系统特点
  - 适配 Windows 快捷键习惯
- ⚡ **性能优化**：
  - 充分利用 i9-14900KF 的多核性能
  - 优化编译和构建配置
  - 使用并行处理提升效率

## 调试信息管理规则

### 6. 调试输出控制（强制要求）
- 🔒 **强制要求**：所有调试信息输出必须有开关控制
- 📋 **实现方式**：
  ```typescript
  interface PluginSettings {
      debugMode: boolean;
      debugLevel: 'info' | 'warn' | 'error' | 'debug';
  }
  
  class DebugLogger {
      constructor(private settings: PluginSettings, private pluginName: string) {}
      
      log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
          if (this.settings.debugMode && this.shouldLog(level)) {
              console[level](`[${this.pluginName}] ${message}`);
          }
      }
      
      private shouldLog(level: string): boolean {
          const levels = ['debug', 'info', 'warn', 'error'];
          return levels.indexOf(level) >= levels.indexOf(this.settings.debugLevel);
      }
  }
  ```

## 代码规范

### 7. TypeScript 要求
- 必须使用 TypeScript
- 所有接口和类型必须明确定义
- 使用 Obsidian 官方类型定义：`import { App, Plugin, ... } from 'obsidian'`

### 8. 依赖传递
- 通过构造函数或方法参数传递插件实例
- 避免在模块间使用全局变量
- 使用依赖注入模式

### 9. 错误处理
- 所有异步操作必须包含错误处理
- 用户操作失败时提供友好的错误提示
- 使用 `new Notice()` 显示用户通知

## 架构分析规则

### 10. 第一性原理分析
- 📊 **理解本质**：
  - 理解 Obsidian 的核心设计理念
  - 分析插件在整个生态中的定位
  - 识别核心功能与辅助功能的边界
  - 理解数据流和事件流的本质

## 开发约束

### 11. 性能要求
- 避免在 `onload()` 中执行耗时操作
- 大量数据处理应使用异步方式
- 及时清理事件监听器和定时器

### 12. 兼容性
- 代码必须兼容当前稳定版本的 Obsidian
- 使用官方 API，避免访问私有属性
- 遵循 Obsidian 插件开发最佳实践

### 13. 测试和调试规则
- 🚫 **禁止**添加浏览器测试相关代码
- 🚫 **禁止**手动配置 sourcemap
- ✅ **依赖**真实 Obsidian 环境测试

### 14. Obsidian 特定文件保护
- 🛡️ **必须保护**：
  - manifest.json
  - main.js
  - styles.css
  - data.json
  - 所有插件 API 相关文件

## 示例模板要求

### 15. main.ts 示例模板
```typescript
import { Plugin } from 'obsidian';
import { SettingsManager, MyPluginSettings } from './settings';
import { CommandManager } from './commands';
import { DebugLogger } from './utils/logger';

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    logger: DebugLogger;

    async onload() {
        await this.loadSettings();
        this.initializeLogger();
        this.registerCommands();
        this.registerUI();
        
        this.logger.log('Plugin loaded successfully');
    }

    onunload() {
        this.logger.log('Plugin unloading');
        // 清理事件监听器和定时器
    }

    private async loadSettings() {
        this.settings = await SettingsManager.load(this);
    }

    private initializeLogger() {
        this.logger = new DebugLogger(this.settings, this.manifest.name);
    }

    private registerCommands() {
        CommandManager.registerAll(this);
    }

    private registerUI() {
        // UI 注册逻辑
    }
}
```

## 开发检查清单

### 16. Obsidian 插件开发检查清单
- ✅ 调试输出是否可控
- ✅ 是否兼容 Obsidian API 版本
- ✅ 是否处理了插件生命周期
- ✅ 是否正确管理了事件监听器
- ✅ 是否避免了内存泄漏
- ✅ 是否使用了正确的构建命令
- ✅ 是否遵循了模块化架构
- ✅ 是否包含了适当的错误处理

## 禁止事项

### 17. 严格禁止
- 不要在 main.ts 中编写具体的业务逻辑
- 不要在一个文件中混合多种职责
- 不要直接操作 DOM，使用 Obsidian 提供的 API
- 不要忽略错误处理和用户反馈
- 不要使用 `npm run dev` 进行验证
- 不要添加浏览器测试相关代码
- 不要手动配置 sourcemap

---

**请严格遵守以上规则，确保生成的代码结构清晰、可维护且符合 Obsidian 插件开发标准。**