# 任务：实现 Formify 插件的 Settings 基础框架

## 上下文
这是一个 Obsidian 插件项目 "Formify"。
已完成：MVP001（插件骨架）
当前阶段：MVP002 - Settings 基础框架

## 要求

### 1. 创建设置类型定义
```typescript
// src/settings/PluginSettings.ts
export interface PluginSettings {
  formFolder: string;
  scriptFolder: string;
  promptTemplateFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  formFolder: 'System/formify',
  scriptFolder: 'System/scripts',
  promptTemplateFolder: 'System/ai prompts'
};
```

### 2. 创建 Settings Tab（React 版本）
```typescript
// src/settings/PluginSettingTab.tsx
import { App, PluginSettingTab } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import FormPlugin from '../main';
import { SettingsView } from './SettingsView';

export class PluginSettingTab extends PluginSettingTab {
  plugin: FormPlugin;
  private root: Root | null = null;

  constructor(app: App, plugin: FormPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const mountPoint = containerEl.createDiv();
    this.root = createRoot(mountPoint);
    this.root.render(
      <SettingsView
        settings={this.plugin.settings}
        onSave={(settings) => {
          this.plugin.settings = settings;
          this.plugin.saveSettings();
        }}
      />
    );
  }

  hide(): void {
    this.root?.unmount();
    this.root = null;
  }
}
```

### 3. 创建 SettingsView 组件
```typescript
// src/settings/SettingsView.tsx
import React, { useState } from 'react';
import { PluginSettings } from './PluginSettings';

interface Props {
  settings: PluginSettings;
  onSave: (settings: PluginSettings) => void;
}

export function SettingsView({ settings, onSave }: Props) {
  const [formFolder, setFormFolder] = useState(settings.formFolder);
  const [scriptFolder, setScriptFolder] = useState(settings.scriptFolder);
  const [promptTemplateFolder, setPromptTemplateFolder] = useState(settings.promptTemplateFolder);

  const handleChange = (key: keyof PluginSettings, value: string) => {
    const newSettings = { ...settings, [key]: value };
    onSave(newSettings);
  };

  return (
    <div className="formify-settings">
      <h2>Formify Settings</h2>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Form Folder</div>
          <div className="setting-item-description">Default folder for form files</div>
        </div>
        <div className="setting-item-control">
          <input
            type="text"
            value={formFolder}
            onChange={(e) => {
              setFormFolder(e.target.value);
              handleChange('formFolder', e.target.value);
            }}
          />
        </div>
      </div>

      {/* 类似添加其他设置项 */}
    </div>
  );
}
```

### 4. 更新 main.ts
```typescript
// src/main.ts 更新
import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './settings/PluginSettings';
import { PluginSettingTab } from './settings/PluginSettingTab';

export default class FormPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    console.log('Formify loaded');
    await this.loadSettings();
    this.addSettingTab(new PluginSettingTab(this.app, this));
  }

  onunload() {
    console.log('Formify unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

## 技术约束
- 使用 React 18 createRoot
- 遵循 Obsidian 设置页面的样式约定
- 设置变更时自动保存

## 交付物
1. `src/settings/PluginSettings.ts`
2. `src/settings/PluginSettingTab.tsx`
3. `src/settings/SettingsView.tsx`
4. 更新 `src/main.ts`

## 验收
- [ ] 插件设置页面能正确显示
- [ ] 修改设置后能正确保存
- [ ] 重启插件后设置能正确加载
- [ ] 设置页面关闭时 React 组件正确卸载
