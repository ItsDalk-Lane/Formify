/**
 * AI自动补全设置页面组件
 */

import { Setting } from 'obsidian';
import type FormPlugin from 'src/main';
import { StrictMode, useEffect, useState } from 'react';
import type { AutoCompletionSettings, DisplayStyle, CursorPositionAfter } from './settings';

interface AutoCompletionSettingTabProps {
	plugin: FormPlugin;
}

/**
 * AI自动补全设置标签页组件
 */
export function AutoCompletionSettingTab({ plugin }: AutoCompletionSettingTabProps) {
	const [settings, setSettings] = useState<AutoCompletionSettings>(plugin.settings.autoCompletion);
	const [providers, setProviders] = useState<Array<{ tag: string; vendor: string }>>([]);

	useEffect(() => {
		// 获取已配置的provider列表
		const tarsProviders = plugin.settings.tars?.settings?.providers || [];
		setProviders(tarsProviders.map(p => ({ tag: p.tag, vendor: p.vendor })));
	}, [plugin.settings.tars]);

	const updateSetting = async <K extends keyof AutoCompletionSettings>(
		key: K,
		value: AutoCompletionSettings[K]
	) => {
		const newSettings = { ...settings, [key]: value };
		setSettings(newSettings);
		await plugin.replaceSettings({
			autoCompletion: newSettings
		});
	};

	return (
		<div className="auto-completion-settings">
			{/* 基础功能设置区域 */}
			<div className="setting-section">
				<h3 className="setting-section-title">基础功能设置</h3>
				
				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">启用自动补全</div>
						<div className="setting-item-description">
							启用后,在编辑器中连续按两次空格将触发AI自动补全
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="checkbox"
							className="checkbox-toggle"
							checked={settings.enabled}
							onChange={(e) => updateSetting('enabled', e.target.checked)}
						/>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">默认补全模型</div>
						<div className="setting-item-description">
							选择用于自动补全的AI模型(使用Tars配置的Provider)
						</div>
					</div>
					<div className="setting-item-control">
						{providers.length === 0 ? (
							<div className="setting-item-warning">
								请先在Tars设置中配置AI服务商
							</div>
						) : (
							<select
								className="dropdown"
								value={settings.defaultModel}
								onChange={(e) => updateSetting('defaultModel', e.target.value)}
							>
								<option value="">请选择模型</option>
								{providers.map((p) => (
									<option key={p.tag} value={p.tag}>
										{p.tag} ({p.vendor})
									</option>
								))}
							</select>
						)}
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全提示词模板</div>
						<div className="setting-item-description">
							使用 {'{{'} context {'}}'}  作为上下文占位符
						</div>
					</div>
					<div className="setting-item-control">
						<textarea
							className="setting-textarea"
							rows={5}
							value={settings.promptTemplate}
							onChange={(e) => updateSetting('promptTemplate', e.target.value)}
						/>
					</div>
				</div>
			</div>

			{/* AI模型设置区域 */}
			<div className="setting-section">
				<h3 className="setting-section-title">AI模型设置</h3>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">温度参数</div>
						<div className="setting-item-description">
							控制生成文本的随机性 (0-1),值越高越随机
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="0"
							max="1"
							step="0.1"
							value={settings.temperature}
							onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
						/>
						<span className="setting-value-label">{settings.temperature}</span>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全内容最大长度</div>
						<div className="setting-item-description">
							生成的补全内容的最大token数 (10-500)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="10"
							max="500"
							value={settings.maxTokens}
							onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
						/>
						<span className="setting-value-label">{settings.maxTokens} tokens</span>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">请求超时时间</div>
						<div className="setting-item-description">
							AI请求的超时时间 (5-60秒)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="5"
							max="60"
							value={settings.requestTimeout / 1000}
							onChange={(e) => updateSetting('requestTimeout', parseInt(e.target.value) * 1000)}
						/>
						<span className="setting-value-label">{settings.requestTimeout / 1000} 秒</span>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">最大上下文长度</div>
						<div className="setting-item-description">
							提取的上下文文本的最大字符数 (500-5000)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="500"
							max="5000"
							step="100"
							value={settings.maxContextLength}
							onChange={(e) => updateSetting('maxContextLength', parseInt(e.target.value))}
						/>
						<span className="setting-value-label">{settings.maxContextLength} 字符</span>
					</div>
				</div>
			</div>

			{/* 交互设置区域 */}
			<div className="setting-section">
				<h3 className="setting-section-title">交互设置</h3>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全显示样式</div>
						<div className="setting-item-description">
							选择补全内容的视觉呈现方式
						</div>
					</div>
					<div className="setting-item-control">
						<select
							className="dropdown"
							value={settings.displayStyle}
							onChange={(e) => updateSetting('displayStyle', e.target.value as DisplayStyle)}
						>
							<option value="transparent">半透明</option>
							<option value="underline">下划线</option>
							<option value="highlight">高亮</option>
						</select>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全文本颜色</div>
						<div className="setting-item-description">
							补全文本的颜色(十六进制)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="color"
							value={settings.textColor}
							onChange={(e) => updateSetting('textColor', e.target.value)}
						/>
						<input
							type="text"
							value={settings.textColor}
							onChange={(e) => updateSetting('textColor', e.target.value)}
							style={{ marginLeft: '8px', width: '100px' }}
						/>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全文本背景色</div>
						<div className="setting-item-description">
							补全文本的背景颜色(十六进制)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="color"
							value={settings.backgroundColor}
							onChange={(e) => updateSetting('backgroundColor', e.target.value)}
						/>
						<input
							type="text"
							value={settings.backgroundColor}
							onChange={(e) => updateSetting('backgroundColor', e.target.value)}
							style={{ marginLeft: '8px', width: '100px' }}
						/>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全文本透明度</div>
						<div className="setting-item-description">
							补全文本的透明度 (0-1)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="0"
							max="1"
							step="0.1"
							value={settings.textOpacity}
							onChange={(e) => updateSetting('textOpacity', parseFloat(e.target.value))}
						/>
						<span className="setting-value-label">{settings.textOpacity}</span>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">自动接受短补全</div>
						<div className="setting-item-description">
							自动接受少于5个字符的补全内容
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="checkbox"
							className="checkbox-toggle"
							checked={settings.autoAcceptShort}
							onChange={(e) => updateSetting('autoAcceptShort', e.target.checked)}
						/>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">补全后光标位置</div>
						<div className="setting-item-description">
							接受补全后光标的位置
						</div>
					</div>
					<div className="setting-item-control">
						<select
							className="dropdown"
							value={settings.cursorPositionAfter}
							onChange={(e) => updateSetting('cursorPositionAfter', e.target.value as CursorPositionAfter)}
						>
							<option value="end">补全内容末尾</option>
							<option value="stay">保持原位</option>
						</select>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">防抖延迟时间</div>
						<div className="setting-item-description">
							触发补全前的延迟时间 (100-2000毫秒)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="number"
							min="100"
							max="2000"
							step="100"
							value={settings.debounceDelay}
							onChange={(e) => updateSetting('debounceDelay', parseInt(e.target.value))}
						/>
						<span className="setting-value-label">{settings.debounceDelay} 毫秒</span>
					</div>
				</div>
			</div>

			{/* 高级设置区域 */}
			<div className="setting-section">
				<h3 className="setting-section-title">高级设置</h3>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">排除文件类型</div>
						<div className="setting-item-description">
							在这些文件类型中不触发自动补全,用逗号分隔(例如: canvas,excalidraw)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="text"
							value={settings.excludeFileTypes.join(',')}
							onChange={(e) => updateSetting('excludeFileTypes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
							placeholder="canvas,excalidraw"
						/>
					</div>
				</div>

				<div className="setting-item">
					<div className="setting-item-info">
						<div className="setting-item-name">排除文件夹路径</div>
						<div className="setting-item-description">
							在这些文件夹中不触发自动补全,用逗号分隔(例如: Archive,Templates)
						</div>
					</div>
					<div className="setting-item-control">
						<input
							type="text"
							value={settings.excludeFolders.join(',')}
							onChange={(e) => updateSetting('excludeFolders', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
							placeholder="Archive,Templates"
						/>
					</div>
				</div>
			</div>

			<style>{`
				.auto-completion-settings {
					padding: 20px;
				}

				.setting-section {
					margin-bottom: 32px;
				}

				.setting-section-title {
					color: #333333;
					font-size: 16px;
					font-weight: bold;
					margin-bottom: 16px;
					border-bottom: 2px solid #4A90E2;
					padding-bottom: 8px;
				}

				.setting-item {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 12px 0;
					border-bottom: 1px solid #e0e0e0;
				}

				.setting-item:last-child {
					border-bottom: none;
				}

				.setting-item-info {
					flex: 1;
					padding-right: 20px;
				}

				.setting-item-name {
					color: #333333;
					font-size: 14px;
					font-weight: 500;
					margin-bottom: 4px;
				}

				.setting-item-description {
					color: #666666;
					font-size: 12px;
					line-height: 1.4;
				}

				.setting-item-control {
					display: flex;
					align-items: center;
					gap: 8px;
				}

				.setting-item-warning {
					color: #d32f2f;
					font-size: 12px;
					font-style: italic;
				}

				.setting-value-label {
					color: #666666;
					font-size: 12px;
					min-width: 80px;
				}

				.dropdown {
					padding: 4px 8px;
					border: 1px solid #cccccc;
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					min-width: 200px;
				}

				.checkbox-toggle {
					width: 20px;
					height: 20px;
					cursor: pointer;
				}

				.setting-textarea {
					width: 100%;
					min-width: 400px;
					padding: 8px;
					border: 1px solid #cccccc;
					border-radius: 4px;
					font-family: monospace;
					resize: vertical;
					background: var(--background-primary);
					color: var(--text-normal);
				}

				input[type="number"],
				input[type="text"] {
					padding: 4px 8px;
					border: 1px solid #cccccc;
					border-radius: 4px;
					background: var(--background-primary);
					color: var(--text-normal);
					min-width: 80px;
				}

				input[type="color"] {
					width: 40px;
					height: 30px;
					border: 1px solid #cccccc;
					border-radius: 4px;
					cursor: pointer;
				}
			`}</style>
		</div>
	);
}
