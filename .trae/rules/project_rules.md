## 🔧 Obsidian插件开发专用规则

使用 npm run build 构建Obsidian插件项目文件，严禁使用 npm run dev 命令来启动开发服务器来验证修复效果

### Windows开发环境优化
- 🖥️ **利用Windows特性**：
  - 使用Windows原生路径处理
  - 考虑Windows文件系统特点
  - 适配Windows快捷键习惯
- ⚡ **性能优化**：
  - 充分利用i9-14900KF的多核性能
  - 优化编译和构建配置
  - 使用并行处理提升效率

### 架构分析规则
- 📊 **第一性原理分析**：
  - 理解Obsidian的核心设计理念
  - 分析插件在整个生态中的定位
  - 识别核心功能与辅助功能的边界
  - 理解数据流和事件流的本质

### 调试信息管理规则
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

### 测试和调试规则
- 🚫 **禁止**添加浏览器测试相关代码
- 🚫 **禁止**手动配置 sourcemap
- ✅ **依赖**真实 Obsidian 环境测试
- ✅ **信任** Obsidian 的调试能力

### Obsidian特定文件保护
- 🛡️ **必须保护**：
  - manifest.json
  - main.js
  - styles.css
  - data.json
  - 所有插件API相关文件

### Obsidian插件开发检查清单
- ✅ 调试输出是否可控
- ✅ 是否兼容Obsidian API版本
- ✅ 是否处理了插件生命周期
- ✅ 是否正确管理了事件监听器
- ✅ 是否避免了内存泄漏
