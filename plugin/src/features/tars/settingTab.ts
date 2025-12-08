import { App, DropdownComponent, Notice, requestUrl, Setting } from 'obsidian'
import { t } from './lang/helper'
import { SelectModelModal, SelectVendorModal, ProviderSettingModal } from './modal'
import { BaseOptions, Message, Optional, ProviderSettings, ResolveEmbedAsBinary, Vendor } from './providers'
import { ClaudeOptions, claudeVendor } from './providers/claude'
import { DebugLogger } from '../../utils/DebugLogger'
import {
	DoubaoOptions,
	doubaoVendor,
	DoubaoThinkingType,
	DoubaoReasoningEffort,
	DOUBAO_REASONING_EFFORT_OPTIONS,
	DEFAULT_DOUBAO_THINKING_TYPE,
	getDoubaoModelCapability
} from './providers/doubao'
import { DoubaoImageOptions, doubaoImageVendor, DOUBAO_IMAGE_SIZE_PRESETS } from './providers/doubaoImage'
import { GptImageOptions, gptImageVendor } from './providers/gptImage'
import { grokVendor, GrokOptions } from './providers/grok'
import { kimiVendor, KimiOptions } from './providers/kimi'
import { deepSeekVendor, DeepSeekOptions } from './providers/deepSeek'
import { ollamaVendor } from './providers/ollama'
import { OpenRouterOptions, openRouterVendor, isImageGenerationModel } from './providers/openRouter'
import { qianFanVendor } from './providers/qianFan'
import { qwenVendor, QwenOptions } from './providers/qwen'
import { siliconFlowVendor } from './providers/siliconflow'
import { zhipuVendor, ZhipuOptions, ZHIPU_THINKING_TYPE_OPTIONS, DEFAULT_ZHIPU_THINKING_TYPE, isReasoningModel } from './providers/zhipu'
import { getCapabilityEmoji, getCapabilityDisplayText } from './providers/utils'
import { availableVendors, DEFAULT_TARS_SETTINGS } from './settings'
import type { TarsSettings } from './settings'
import FolderSuggest from '../../component/combobox/FolderSuggest'
import type { ChatSettings } from '../chat/types/chat'

export interface TarsSettingsContext {
	getSettings: () => TarsSettings
	getChatSettings: () => ChatSettings
	saveSettings: () => Promise<void>
	updateChatSettings: (partial: Partial<ChatSettings>) => Promise<void>
}

export class TarsSettingTab {
	private containerEl!: HTMLElement
	private providersContainerEl!: HTMLElement
	private providerTitleEls = new Map<number, HTMLElement>()
	private providerCapabilityEls = new Map<number, HTMLElement>()
	private currentOpenProviderIndex = -1
	private autoSaveEnabled = true
	private isProvidersCollapsed = true // 默认折叠列表
	private isMessageCollapsed = true // 默认折叠消息设置
	private isChatCollapsed = true // 默认折叠AI Chat设置
	private isAdvancedCollapsed = true // 默认折叠高级设置
	private doubaoRenderers = new Map<any, () => void>()

	constructor(private readonly app: App, private readonly settingsContext: TarsSettingsContext) {}

	private get settings() {
		return this.settingsContext.getSettings()
	}

	private get chatSettings() {
		return this.settingsContext.getChatSettings()
	}

	private async saveSettings() {
		if (this.autoSaveEnabled) {
			await this.settingsContext.saveSettings()
		}
	}

	private async updateChatSettings(partial: Partial<ChatSettings>) {
		await this.settingsContext.updateChatSettings(partial)
	}

	render(containerEl: HTMLElement, expandLastProvider = false, keepOpenIndex: number = -1): void {
		this.containerEl = containerEl
		containerEl.empty()

		// 每次渲染时清空标题元素引用，避免引用过期
		this.providerTitleEls.clear()

		// Tars功能始终启用，移除启用/禁用选项

		// 创建标题行（可点击折叠/展开）
		const aiAssistantHeaderSetting = new Setting(containerEl)
			.setName(t('New AI assistant'))
			.setDesc(t('For those compatible with the OpenAI protocol, you can select OpenAI.'))

		// 创建一个包装器来容纳按钮和图标
		const buttonWrapper = aiAssistantHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		buttonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加AI服务商按钮
		const addButton = buttonWrapper.createEl('button', { cls: 'mod-cta' })
		addButton.textContent = t('Add AI Provider')
		addButton.onclick = async () => {
			const onChoose = async (vendor: Vendor) => {
				const defaultTag = vendor.name
				const isTagDuplicate = this.settings.providers.map((e) => e.tag).includes(defaultTag)
				const newTag = isTagDuplicate ? '' : defaultTag

				const deepCopiedOptions = JSON.parse(JSON.stringify(vendor.defaultOptions))
				this.settings.providers.push({
					tag: newTag,
					vendor: vendor.name,
					options: deepCopiedOptions
				})
				await this.saveSettings()
				this.isProvidersCollapsed = false // 添加后展开列表
				this.render(this.containerEl, true)
			}
			new SelectVendorModal(this.app, availableVendors, onChoose).open()
		}

		// 添加Chevron图标
		const chevronIcon = buttonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		chevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		chevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isProvidersCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域（除了按钮）
		const headerEl = aiAssistantHeaderSetting.settingEl
		headerEl.style.cursor = 'pointer'
		// 设置直角设计，移除圆角效果
		headerEl.style.borderRadius = '0px'
		// 统一内边距，确保标题文字和图标的上下间距一致
		headerEl.style.padding = '12px 12px'
		
		const toggleProviders = () => {
			this.isProvidersCollapsed = !this.isProvidersCollapsed
			chevronIcon.style.transform = this.isProvidersCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			if (this.providersContainerEl) {
				this.providersContainerEl.style.display = this.isProvidersCollapsed ? 'none' : 'block'
			}
		}

		// 点击整行（除按钮和图标外）切换折叠状态
		headerEl.addEventListener('click', (e) => {
			// 避免点击按钮时触发折叠
			if ((e.target as HTMLElement).closest('button')) {
				return
			}
			// 避免点击图标时重复触发
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleProviders()
		})
		
		// 点击图标也能切换折叠状态
		chevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleProviders()
		})

		// 创建服务商卡片容器
		this.providersContainerEl = containerEl.createDiv({ cls: 'ai-providers-container' })
		this.providersContainerEl.style.display = this.isProvidersCollapsed ? 'none' : 'block'
		this.providersContainerEl.style.backgroundColor = 'var(--background-secondary)'
		// 设置直角设计，移除圆角效果
		this.providersContainerEl.style.borderRadius = '0px'
		this.providersContainerEl.style.border = '1px solid var(--background-modifier-border)'
		this.providersContainerEl.style.borderTop = 'none'
		this.providersContainerEl.style.padding = '0 8px 8px 8px'

		if (!this.settings.providers.length) {
			const emptyTip = this.providersContainerEl.createEl('div', { 
				cls: 'ai-providers-empty-tip'
			})
			emptyTip.textContent = t('Please add at least one AI assistant to start using the plugin.')
			emptyTip.style.cssText = `
				padding: 12px;
				color: var(--text-muted);
				font-size: var(--font-ui-small);
				text-align: center;
				font-style: italic;
			`
		}

		for (const [index, provider] of this.settings.providers.entries()) {
			const isLast = index === this.settings.providers.length - 1
			const shouldOpen = (isLast && expandLastProvider) || index === keepOpenIndex
			this.createProviderSetting(index, provider, shouldOpen)
		}

		// 移除间隔行，使区域直接相邻

		// 消息区域（使用 Setting 组件，与上方保持一致）
		const messageHeaderSetting = new Setting(containerEl)
			.setName('消息')
			.setDesc('标签在文本框中的关键词，之间用空格隔开')

		// 创建一个包装器来容纳图标
		const messageButtonWrapper = messageHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		messageButtonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加Chevron图标
		const messageChevronIcon = messageButtonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		messageChevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		messageChevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isMessageCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域（除了按钮）
		const messageHeaderEl = messageHeaderSetting.settingEl
		messageHeaderEl.style.cursor = 'pointer'
		// 移除背景色设置，使用默认背景色，与"新的AI助手"标题行保持一致
		// 设置直角设计，移除圆角效果
		messageHeaderEl.style.borderRadius = '0px'
		messageHeaderEl.style.border = '1px solid var(--background-modifier-border)'
		messageHeaderEl.style.marginBottom = '0px'  // 移除底部边距，使区域直接相邻
		// 统一内边距，确保标题文字和图标的上下间距一致
		messageHeaderEl.style.padding = '12px 12px'

		// 创建消息设置容器
		const messageSection = containerEl.createDiv({ cls: 'message-settings-container' })
		messageSection.style.padding = '0 8px 8px 8px'
		// 保持折叠区域的背景色为secondary，与标题行形成对比
		messageSection.style.backgroundColor = 'var(--background-secondary)'
		// 设置直角设计，移除圆角效果
		messageSection.style.borderRadius = '0px'
		messageSection.style.border = '1px solid var(--background-modifier-border)'
		messageSection.style.borderTop = 'none'
		// 移除底部边框，使消息区域与高级区域紧密相连
		// 根据折叠状态设置显示/隐藏
		messageSection.style.display = this.isMessageCollapsed ? 'none' : 'block'

		// 添加消息区域折叠/展开功能
		const toggleMessageSection = () => {
			this.isMessageCollapsed = !this.isMessageCollapsed
			messageChevronIcon.style.transform = this.isMessageCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			messageSection.style.display = this.isMessageCollapsed ? 'none' : 'block'
		}

		// 点击整行切换折叠状态
		messageHeaderEl.addEventListener('click', (e) => {
			// 避免点击图标时重复触发
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleMessageSection()
		})

		// 点击图标也能切换折叠状态
		messageChevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleMessageSection()
		})

		let newChatTagsInput: HTMLInputElement | null = null
		new Setting(messageSection)
			.setName(this.settings.roleEmojis.newChat + ' ' + t('New chat tags'))
			.addExtraButton((btn) => {
				btn
					.setIcon('reset')
					.setTooltip(t('Restore default'))
					.onClick(async () => {
						this.settings.newChatTags = [...DEFAULT_TARS_SETTINGS.newChatTags]
						await this.saveSettings()
						if (newChatTagsInput) {
							newChatTagsInput.value = this.settings.newChatTags.join(' ')
						}
					})
			})
			.addText((text) => {
				newChatTagsInput = text.inputEl
				text
					.setPlaceholder(DEFAULT_TARS_SETTINGS.newChatTags.join(' '))
					.setValue(this.settings.newChatTags.join(' '))
					.onChange(async (value) => {
						const tags = value.split(' ').filter((e) => e.length > 0)
						if (!validateTagList(tags)) return
						this.settings.newChatTags = tags
						await this.saveSettings()
					})
			})

		let userTagsInput: HTMLInputElement | null = null
		new Setting(messageSection)
			.setName(this.settings.roleEmojis.user + ' ' + t('User message tags'))
			.addExtraButton((btn) => {
				btn
					.setIcon('reset')
					.setTooltip(t('Restore default'))
					.onClick(async () => {
						this.settings.userTags = [...DEFAULT_TARS_SETTINGS.userTags]
						await this.saveSettings()
						if (userTagsInput) {
							userTagsInput.value = this.settings.userTags.join(' ')
						}
					})
			})
			.addText((text) => {
				userTagsInput = text.inputEl
				text
					.setPlaceholder(DEFAULT_TARS_SETTINGS.userTags.join(' '))
					.setValue(this.settings.userTags.join(' '))
					.onChange(async (value) => {
						const tags = value.split(' ').filter((e) => e.length > 0)
						if (!validateTagList(tags)) return
						this.settings.userTags = tags
						await this.saveSettings()
					})
			})

		let systemTagsInput: HTMLInputElement | null = null
		new Setting(messageSection)
			.setName(this.settings.roleEmojis.system + ' ' + t('System message tags'))
			.addExtraButton((btn) => {
				btn
					.setIcon('reset')
					.setTooltip(t('Restore default'))
					.onClick(async () => {
						this.settings.systemTags = [...DEFAULT_TARS_SETTINGS.systemTags]
						await this.saveSettings()
						if (systemTagsInput) {
							systemTagsInput.value = this.settings.systemTags.join(' ')
						}
					})
			})
			.addText((text) => {
				systemTagsInput = text.inputEl
				text
					.setPlaceholder(DEFAULT_TARS_SETTINGS.systemTags.join(' '))
					.setValue(this.settings.systemTags.join(' '))
					.onChange(async (value) => {
						const tags = value.split(' ').filter((e) => e.length > 0)
						if (!validateTagList(tags)) return
						this.settings.systemTags = tags
						await this.saveSettings()
					})
			})

		// "重新生成前是否需要确认"设置项
		new Setting(messageSection)
			.setName(t('Confirm before regeneration'))
			.setDesc(t('Confirm before replacing existing assistant responses when using assistant commands'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.confirmRegenerate).onChange(async (value) => {
					this.settings.confirmRegenerate = value
					await this.saveSettings()
				})
			)

		let defaultSystemMsgInput: HTMLTextAreaElement | null = null
		new Setting(messageSection)
			.setName(t('Enable default system message'))
			.setDesc(t('Automatically add a system message when none exists in the conversation'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableDefaultSystemMsg).onChange(async (value) => {
					this.settings.enableDefaultSystemMsg = value
					await this.saveSettings()
					if (defaultSystemMsgInput) {
						defaultSystemMsgInput.disabled = !value
					}
				})
			)

		// "默认系统消息"设置项 - 修改为上下布局
		const defaultSystemMsgSetting = new Setting(messageSection)
			.setName(t('Default system message'))
		
		// 移除 Setting 的 flex 布局，改为块级布局
		defaultSystemMsgSetting.settingEl.style.display = 'block'
		defaultSystemMsgSetting.infoEl.style.marginBottom = '8px'
		
		const textArea = defaultSystemMsgSetting.controlEl.createEl('textarea', {
			cls: 'tars-system-message-input'
		})
		textArea.style.cssText = `
			width: 100%;
			min-height: 100px;
			padding: 8px;
			border: 1px solid var(--background-modifier-border);
			border-radius: var(--radius-s);
			background: var(--background-primary);
			color: var(--text-normal);
			font-family: var(--font-text);
			font-size: var(--font-ui-small);
			resize: vertical;
		`
		textArea.disabled = !this.settings.enableDefaultSystemMsg
		textArea.value = this.settings.defaultSystemMsg
		textArea.addEventListener('input', async () => {
			this.settings.defaultSystemMsg = textArea.value.trim()
			await this.saveSettings()
		})
		defaultSystemMsgInput = textArea

		// "内部链接"设置项
		new Setting(messageSection)
			.setName(t('Internal links'))
			.setDesc(
				t(
					'Internal links in user and system messages will be replaced with their referenced content. When disabled, only the original text of the links will be used.'
				)
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableInternalLink).onChange(async (value) => {
					this.settings.enableInternalLink = value
					await this.saveSettings()
				})
			)

		// 移除间隔行，使区域直接相邻

		// AI Chat 设置区域
		const chatHeaderSetting = new Setting(containerEl)
			.setName('AI Chat')

		// 创建一个包装器来容纳图标
		const chatButtonWrapper = chatHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		chatButtonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加Chevron图标
		const chatChevronIcon = chatButtonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		chatChevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		chatChevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isChatCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域
		const chatHeaderEl = chatHeaderSetting.settingEl
		chatHeaderEl.style.cursor = 'pointer'
		chatHeaderEl.style.borderRadius = '0px'
		chatHeaderEl.style.border = '1px solid var(--background-modifier-border)'
		chatHeaderEl.style.marginBottom = '0px'
		chatHeaderEl.style.padding = '12px 12px'

		// 创建AI Chat设置容器
		const chatSection = containerEl.createDiv({ cls: 'chat-settings-container' })
		chatSection.style.padding = '0 8px 8px 8px'
		chatSection.style.backgroundColor = 'var(--background-secondary)'
		chatSection.style.borderRadius = '0px'
		chatSection.style.border = '1px solid var(--background-modifier-border)'
		chatSection.style.borderTop = 'none'
		chatSection.style.display = this.isChatCollapsed ? 'none' : 'block'

		// 添加AI Chat区域折叠/展开功能
		const toggleChatSection = () => {
			this.isChatCollapsed = !this.isChatCollapsed
			chatChevronIcon.style.transform = this.isChatCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			chatSection.style.display = this.isChatCollapsed ? 'none' : 'block'
		}

		chatHeaderEl.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleChatSection()
		})

		chatChevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleChatSection()
		})

		new Setting(chatSection)
			.setName("聊天历史保存目录")
			.setDesc("AI聊天记录将以Markdown格式保存在此目录中")
			.addText((text) => {
				text.setValue(this.chatSettings.chatFolder);
				text.setPlaceholder("AI Chats");
				text.onChange(async (value) => {
					await this.updateChatSettings({ chatFolder: value });
				});
				const suggest = new FolderSuggest(this.app, text.inputEl);
				suggest.onSelect(async (folder) => {
					text.setValue(folder.path);
					await this.updateChatSettings({ chatFolder: folder.path });
				});
			});

		new Setting(chatSection)
			.setName("默认AI模型")
			.setDesc("为新建聊天会话预设的模型")
			.addDropdown((dropdown) => {
				const providers = this.settings.providers;
				const defaultValue =
					this.chatSettings.defaultModel ||
					providers[0]?.tag ||
					"";
				if (!providers.length) {
					dropdown.addOption("", "尚未配置模型");
					dropdown.setDisabled(true);
				} else {
					providers.forEach((provider) => {
						dropdown.addOption(
							provider.tag,
							provider.tag
						);
					});
					dropdown.setValue(defaultValue);
				}
				dropdown.onChange(async (value) => {
					await this.updateChatSettings({ defaultModel: value });
				});
			});

		new Setting(chatSection)
			.setName("自动保存聊天记录")
			.setDesc("在每次AI回复完成后自动将会话写入历史文件")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.autosaveChat);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ autosaveChat: value });
				});
			});

		// 动态获取打开方式的描述
		const getOpenModeDescription = (mode: string) => {
			switch (mode) {
				case 'sidebar':
					return '插件加载后自动在右侧边栏显示AI聊天界面';
				case 'left-sidebar':
					return '插件加载后自动在左侧边栏显示AI聊天界面';
				case 'tab':
					return '插件加载后自动在编辑区标签页显示AI聊天界面';
				case 'window':
					return '插件加载后自动在新窗口显示AI聊天界面';
				default:
					return '插件加载后自动显示AI聊天界面';
			}
		};

		// 创建打开方式设置项
		const openModeSetting = new Setting(chatSection)
			.setName("AI Chat 打开方式")
			.setDesc("选择AI Chat界面的默认打开位置")
			.addDropdown((dropdown) => {
				dropdown.addOption('sidebar', '右侧边栏');
				dropdown.addOption('left-sidebar', '左侧边栏');
				dropdown.addOption('tab', '编辑区标签页');
				dropdown.addOption('window', '新窗口');
				dropdown.setValue(this.chatSettings.openMode);
				dropdown.onChange(async (value) => {
					await this.updateChatSettings({ openMode: value as 'sidebar' | 'left-sidebar' | 'tab' | 'window' });
					// 更新自动打开设置的描述文本
					autoOpenSetting.setDesc(getOpenModeDescription(value));
				});
			});

		// 创建自动打开设置项，使用动态描述
		const autoOpenSetting = new Setting(chatSection)
			.setName("自动打开AI Chat界面")
			.setDesc(getOpenModeDescription(this.chatSettings.openMode))
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.showSidebarByDefault);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ showSidebarByDefault: value });
				});
			});

		// 添加系统提示词设置项
		new Setting(chatSection)
			.setName("启用系统提示词")
			.setDesc("使用AI助手功能中配置的系统提示词，为AI聊天提供一致的角色定义和行为指导")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.enableSystemPrompt ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ enableSystemPrompt: value });
				});
			});

		// 内链解析设置区域
		new Setting(chatSection)
			.setName("启用内链解析")
			.setDesc("自动解析用户消息中的内部链接（[[文件名]]），将链接指向的笔记内容提供给AI")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.enableInternalLinkParsing ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ enableInternalLinkParsing: value });
				});
			});

		new Setting(chatSection)
			.setName("解析模板中的内链")
			.setDesc("启用后，提示词模板中的内部链接也会被解析")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.parseLinksInTemplates ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ parseLinksInTemplates: value });
				});
			});

		new Setting(chatSection)
			.setName("内链解析最大深度")
			.setDesc("嵌套内链的最大解析层数，防止循环引用（默认：5层）")
			.addSlider((slider) => {
				slider
					.setLimits(1, 10, 1)
					.setValue(this.chatSettings.maxLinkParseDepth ?? 5)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.updateChatSettings({ maxLinkParseDepth: value });
					});
			});

		new Setting(chatSection)
			.setName("链接解析超时时间")
			.setDesc("单个链接解析的最大等待时间（毫秒），超时后保留原始文本（默认：5000ms）")
			.addSlider((slider) => {
				slider
					.setLimits(1000, 30000, 1000)
					.setValue(this.chatSettings.linkParseTimeout ?? 5000)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.updateChatSettings({ linkParseTimeout: value });
					});
			});

		// 自动添加活跃文件设置
		new Setting(chatSection)
			.setName("自动添加活跃文件")
			.setDesc("自动将当前活跃的Markdown文件添加至AI聊天上下文中，并在文件关闭时自动移除。可以手动删除已添加的活跃文件。")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.autoAddActiveFile ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ autoAddActiveFile: value });
				});
			});

		// 高级设置区域（使用 Setting 组件，与上方保持一致）
		const advancedHeaderSetting = new Setting(containerEl)
			.setName(t('Advanced'))

		// 创建一个包装器来容纳图标
		const advancedButtonWrapper = advancedHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		advancedButtonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加Chevron图标
		const advancedChevronIcon = advancedButtonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		advancedChevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		advancedChevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isAdvancedCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域
		const advancedHeaderEl = advancedHeaderSetting.settingEl
		advancedHeaderEl.style.cursor = 'pointer'
		// 移除背景色设置，使用默认背景色，与"新的AI助手"标题行保持一致
		// 设置直角设计，移除圆角效果
		advancedHeaderEl.style.borderRadius = '0px'
		advancedHeaderEl.style.border = '1px solid var(--background-modifier-border)'
		advancedHeaderEl.style.marginBottom = '0px'  // 移除底部边距，使区域直接相邻
		// 统一内边距，确保标题文字和图标的上下间距一致
		advancedHeaderEl.style.padding = '12px 12px'

		// 创建高级设置容器
		const advancedSection = containerEl.createDiv({ cls: 'advanced-settings-container' })
		advancedSection.style.padding = '0 8px 8px 8px'
		// 保持折叠区域的背景色为secondary，与标题行形成对比
		advancedSection.style.backgroundColor = 'var(--background-secondary)'
		// 设置直角设计，移除圆角效果
		advancedSection.style.borderRadius = '0px'
		advancedSection.style.border = '1px solid var(--background-modifier-border)'
		advancedSection.style.borderTop = 'none'
		// 根据折叠状态设置显示/隐藏
		advancedSection.style.display = this.isAdvancedCollapsed ? 'none' : 'block'

		// 添加高级区域折叠/展开功能
		const toggleAdvancedSection = () => {
			this.isAdvancedCollapsed = !this.isAdvancedCollapsed
			advancedChevronIcon.style.transform = this.isAdvancedCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			advancedSection.style.display = this.isAdvancedCollapsed ? 'none' : 'block'
		}

		// 点击整行切换折叠状态
		advancedHeaderEl.addEventListener('click', (e) => {
			// 避免点击图标时重复触发
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleAdvancedSection()
		})

		// 点击图标也能切换折叠状态
		advancedChevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleAdvancedSection()
		})

		new Setting(advancedSection)
			.setName(t('Internal links for assistant messages'))
			.setDesc(
				t(
					'Replace internal links in assistant messages with their referenced content. Note: This feature is generally not recommended as assistant-generated content may contain non-existent links.'
				)
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableInternalLinkForAssistantMsg ?? false).onChange(async (value) => {
					this.settings.enableInternalLinkForAssistantMsg = value
					await this.saveSettings()
				})
			)

		let answerDelayInput: HTMLInputElement | null = null
		new Setting(advancedSection)
			.setName(t('Delay before answer (Seconds)'))
			.setDesc(
				t(
					'If you encounter errors with missing user messages when executing assistant commands on selected text, it may be due to the need for more time to parse the messages. Please slightly increase the delay time.'
				)
			)
			.addExtraButton((btn) => {
				btn
					.setIcon('reset')
					.setTooltip(t('Restore default'))
					.onClick(async () => {
						this.settings.answerDelayInMilliseconds = DEFAULT_TARS_SETTINGS.answerDelayInMilliseconds
						await this.saveSettings()
						if (answerDelayInput) {
							answerDelayInput.value = (this.settings.answerDelayInMilliseconds / 1000).toString()
						}
					})
			})
			.addSlider((slider) => {
				answerDelayInput = slider.sliderEl
				slider
					.setLimits(1.5, 4, 0.5)
					.setValue(this.settings.answerDelayInMilliseconds / 1000)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.answerDelayInMilliseconds = Math.round(value * 1000)
						await this.saveSettings()
					})
			})

		new Setting(advancedSection)
			.setName(t('Replace tag Command'))
			.setDesc(t('Replace the names of the two most frequently occurring speakers with tag format.'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableReplaceTag).onChange(async (value) => {
					this.settings.enableReplaceTag = value
					await this.saveSettings()
				})
			)

		new Setting(advancedSection)
			.setName(t('Export to JSONL Command'))
			.setDesc(t('Export conversations to JSONL'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableExportToJSONL).onChange(async (value) => {
					this.settings.enableExportToJSONL = value
					await this.saveSettings()
				})
			)

		new Setting(advancedSection)
			.setName(t('Tag suggest'))
			.setDesc(
				t(
					'If you only use commands without needing tag suggestions, you can disable this feature. Changes will take effect after restarting the plugin.'
				)
			)
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableTagSuggest).onChange(async (value) => {
					this.settings.enableTagSuggest = value
					await this.saveSettings()
				})
			)

		// 调试模式设置
		new Setting(advancedSection)
			.setName('调试模式')
			.setDesc('启用后将在控制台输出调试日志。修改后需要重新加载插件才能生效。')
			.addToggle((toggle) =>
				toggle.setValue(this.settings.debugMode ?? false).onChange(async (value) => {
					this.settings.debugMode = value
					await this.saveSettings()
					DebugLogger.setDebugMode(value)
				})
			)

		// 调试级别设置
		new Setting(advancedSection)
			.setName('调试日志级别')
			.setDesc('选择要输出的最低日志级别。debug=全部, info=信息及以上, warn=警告及以上, error=仅错误')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('debug', 'Debug (全部)')
					.addOption('info', 'Info (信息)')
					.addOption('warn', 'Warn (警告)')
					.addOption('error', 'Error (错误)')
					.setValue(this.settings.debugLevel ?? 'error')
					.onChange(async (value: 'debug' | 'info' | 'warn' | 'error') => {
						this.settings.debugLevel = value
						await this.saveSettings()
						DebugLogger.setDebugLevel(value)
					})
			)
	}

	/**
	 * 更新提供商卡片中的功能显示
	 */
	private updateProviderCapabilities(index: number, settings: ProviderSettings) {
		const vendor = availableVendors.find((v) => v.name === settings.vendor)
		if (!vendor) return
		
		const capabilitiesEl = this.providerCapabilityEls.get(index)
		if (capabilitiesEl) {
			capabilitiesEl.textContent = getCapabilityDisplayText(vendor, settings.options)
		}
	}

    createProviderSetting = (index: number, settings: ProviderSettings, isOpen: boolean = false) => {
		const vendor = availableVendors.find((v) => v.name === settings.vendor)
		if (!vendor) throw new Error('No vendor found ' + settings.vendor)
		
		// 使用服务商容器而不是 containerEl
		const container = this.providersContainerEl || this.containerEl

		// 创建服务商卡片
		const card = container.createEl('div', { cls: 'ai-provider-card' })
		card.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
			margin-bottom: 8px;
			background-color: var(--background-secondary);
			border: 1px solid var(--background-modifier-border);
			border-radius: var(--radius-m);
			cursor: pointer;
			transition: all 0.2s ease;
		`

		// 左侧信息
		const leftSection = card.createEl('div', { cls: 'ai-provider-info' })
		leftSection.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 4px;
			flex: 1;
		`

		const titleEl = leftSection.createEl('div', { cls: 'ai-provider-title' })
		titleEl.style.cssText = `
			font-size: var(--font-ui-medium);
			font-weight: 500;
			color: var(--text-normal);
		`
		titleEl.textContent = getSummary(settings.tag, vendor.name)
		// 记录标题元素，便于在配置中实时更新标题
		this.providerTitleEls.set(index, titleEl)

		const capabilitiesEl = leftSection.createEl('div', { cls: 'ai-provider-capabilities' })
		capabilitiesEl.style.cssText = `
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
		`
		// 使用动态计算的功能而非vendor的capabilities
		capabilitiesEl.textContent = getCapabilityDisplayText(vendor, settings.options)
		// 记录功能元素，便于在配置中实时更新
		this.providerCapabilityEls.set(index, capabilitiesEl)

		// 右侧按钮 - 只保留删除按钮
		const rightSection = card.createEl('div', { cls: 'ai-provider-actions' })
		rightSection.style.cssText = `
			display: flex;
			gap: 8px;
			align-items: center;
		`

		// 删除按钮 - 使用SVG图标
		const deleteBtn = rightSection.createEl('button', { cls: 'ai-provider-delete-btn' })
		deleteBtn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="3 6 5 6 21 6"></polyline>
				<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
				<line x1="10" y1="11" x2="10" y2="17"></line>
				<line x1="14" y1="11" x2="14" y2="17"></line>
			</svg>
		`
		deleteBtn.style.cssText = `
			padding: 4px;
			background: transparent;
			border: none;
			cursor: pointer;
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: var(--radius-s);
			transition: color 0.2s ease, transform 0.1s ease;
		`
		deleteBtn.title = '删除此服务商'
		
		// 删除按钮悬停效果
		deleteBtn.addEventListener('mouseenter', () => {
			deleteBtn.style.color = 'var(--color-red)'
		})
		
		deleteBtn.addEventListener('mouseleave', () => {
			deleteBtn.style.color = 'var(--text-muted)'
		})

		// 悬停效果
		card.addEventListener('mouseenter', () => {
			card.style.backgroundColor = 'var(--background-modifier-hover)'
			card.style.borderColor = 'var(--interactive-accent)'
		})

		card.addEventListener('mouseleave', () => {
			card.style.backgroundColor = 'var(--background-secondary)'
			card.style.borderColor = 'var(--background-modifier-border)'
		})

		// 点击卡片打开 Modal
		const openConfigModal = () => {
			const modal = new ProviderSettingModal(this.app, getSummary(settings.tag, vendor.name), (modalContainer) => {
				// 在 Modal 中渲染配置内容
				this.renderProviderConfig(modalContainer, index, settings, vendor, modal)
			})
			modal.open()
		}

        card.addEventListener('click', (e) => {
            // 如果点击的是删除按钮，不触发卡片点击
            if (e.target === deleteBtn || (e.target as HTMLElement).closest('button') === deleteBtn) return
            openConfigModal()
        })

        // 删除按钮点击事件
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            this.settings.providers.splice(index, 1)
            await this.settingsContext.saveSettings()
            this.render(this.containerEl)
        })

        if (isOpen) {
            this.currentOpenProviderIndex = index
            openConfigModal()
        }
    }

	/**
	 * 在 Modal 容器中渲染服务商配置内容
	 */
	private renderProviderConfig(
		container: HTMLElement,
		index: number,
		settings: ProviderSettings,
		vendor: Vendor,
		modal?: ProviderSettingModal
	) {
		// 禁用自动保存，改为手动点击保存按钮
		const previousAutoSaveState = this.autoSaveEnabled
		this.autoSaveEnabled = false

		const capabilities =
			t('Supported features') +
			' : ' +
			getCapabilityDisplayText(vendor, settings.options)

		container.createEl('p', { text: capabilities, cls: 'setting-item-description' })

		this.addTagSection(container, settings, index, vendor.name)

		// model setting
		const modelConfig = MODEL_FETCH_CONFIGS[vendor.name as keyof typeof MODEL_FETCH_CONFIGS]
		if (modelConfig) {
			// 按钮选择模式（支持API获取模型列表 + 自定义输入）
			this.addModelButtonSection(container, settings.options, modelConfig, capabilities, vendor.name, index, settings, vendor, modal)
		} else if (vendor.models.length > 0) {
			// 下拉选择模式（预设模型列表 + 自定义输入）
			this.addModelDropDownSection(container, settings.options, vendor.models, capabilities)
		} else {
			// 纯文本输入模式（完全自定义）
			this.addModelTextSection(container, settings.options, capabilities)
		}

		if (vendor.name !== ollamaVendor.name) {
			this.addAPIkeySection(
				container,
				settings.options,
				vendor.websiteToObtainKey ? t('Obtain key from ') + vendor.websiteToObtainKey : ''
			)
		}

		if ('apiSecret' in settings.options)
			this.addAPISecretOptional(container, settings.options as BaseOptions & Pick<Optional, 'apiSecret'>)

		// OpenRouter 特殊处理：根据模型判断显示不同功能配置
		if (vendor.name === openRouterVendor.name) {
			const options = settings.options as OpenRouterOptions
			// 严格判断：只有模型名称包含 "image" 的才支持图像生成
			const supportsImageGeneration = isImageGenerationModel(options.model)

			// 网络搜索配置（非图像生成模型时显示）
			// 也要处理没有选择模型的情况，默认显示网络搜索配置
			if (!supportsImageGeneration && vendor.capabilities.includes('Web Search')) {
				new Setting(container)
					.setName(t('Web search'))
					.setDesc(t('Enable web search for AI'))
					.addToggle((toggle) =>
						toggle.setValue(settings.options.enableWebSearch ?? false).onChange(async (value) => {
							settings.options.enableWebSearch = value
							await this.saveSettings()
							// 更新功能显示
							this.updateProviderCapabilities(index, settings)
						})
					)

				this.addOpenRouterWebSearchSections(container, options)
			}

			// 图像生成配置（仅当模型真正支持时显示）
			if (supportsImageGeneration) {
				this.addOpenRouterImageGenerationSections(container, options)
			}

			// Reasoning 推理功能配置（仅非图像生成模型支持）
			if (!supportsImageGeneration && vendor.capabilities.includes('Reasoning')) {
				new Setting(container)
					.setName('启用推理功能')
					.setDesc('启用后模型将显示其推理过程。推理内容将使用 [!quote] 标记包裹显示')
					.addToggle((toggle) =>
						toggle.setValue(options.enableReasoning ?? false).onChange(async (value) => {
							options.enableReasoning = value
							await this.saveSettings()
							// 更新功能显示
							this.updateProviderCapabilities(index, settings)
						})
					)

				// 仅在启用 Reasoning 时显示详细配置
				if (options.enableReasoning) {
					this.addOpenRouterReasoningSections(container, options)
				}
			}
		} else {
			// 其他提供商的网络搜索配置
			if (vendor.capabilities.includes('Web Search')) {
				new Setting(container)
					.setName(t('Web search'))
					.setDesc(t('Enable web search for AI'))
					.addToggle((toggle) =>
						toggle.setValue(settings.options.enableWebSearch ?? false).onChange(async (value) => {
							settings.options.enableWebSearch = value
							await this.saveSettings()
							// 更新功能显示
							this.updateProviderCapabilities(index, settings)
						})
					)

				// OpenRouter 特定的网络搜索配置（已在上面处理）
			}

			}

		if (vendor.name === claudeVendor.name) {
			this.addClaudeSections(container, settings.options as ClaudeOptions)
		}

		if (vendor.name === doubaoVendor.name) {
			this.addDoubaoSections(container, settings.options as DoubaoOptions)
		}

		if (vendor.name === zhipuVendor.name) {
			this.addZhipuSections(container, settings.options as ZhipuOptions)
		}

		if (vendor.name === qwenVendor.name) {
			this.addQwenSections(container, settings.options as QwenOptions)
		}

		if (vendor.name === gptImageVendor.name) {
			this.addGptImageSections(container, settings.options as GptImageOptions)
		}

		if (vendor.name === doubaoImageVendor.name) {
			this.addDoubaoImageSections(container, settings.options as DoubaoImageOptions)
		}

		// 添加Kimi、DeepSeek和Grok的推理功能开关
		if (vendor.name === kimiVendor.name) {
			this.addKimiSections(container, settings.options as KimiOptions, index, settings)
		}

		if (vendor.name === deepSeekVendor.name) {
			this.addDeepSeekSections(container, settings.options as DeepSeekOptions, index, settings)
		}

		if (vendor.name === grokVendor.name) {
			this.addGrokSections(container, settings.options as GrokOptions, index, settings)
		}

		this.addBaseURLSection(container, settings.options, vendor.defaultOptions.baseURL)

		if ('endpoint' in settings.options)
			this.addEndpointOptional(container, settings.options as BaseOptions & Pick<Optional, 'endpoint'>)

		if ('apiVersion' in settings.options)
			this.addApiVersionOptional(container, settings.options as BaseOptions & Pick<Optional, 'apiVersion'>)

		this.addParametersSection(container, settings.options)

		const testButtonLabel = t('Test now')
		new Setting(container)
			.setName(t('Test model'))
			.setDesc(t('Test model description'))
			.addButton((btn) => {
				btn.setButtonText(testButtonLabel)
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true)
						btn.setButtonText(t('Testing model...'))
						try {
							await this.testProviderConfiguration(settings)
						} finally {
							btn.setDisabled(false)
							btn.setButtonText(testButtonLabel)
						}
					})
			})

		// 保存按钮
		new Setting(container).addButton((btn) => {
			btn.setButtonText('保存')
				.setCta()
				.onClick(async () => {
					// 保存前验证所有标签
					const tags = this.settings.providers.map((p) => p.tag.toLowerCase())
					const uniqueTags = new Set(tags)
					if (tags.length !== uniqueTags.size) {
						new Notice('❌ ' + t('Keyword for tag must be unique'))
						return
					}

					// 验证标签格式
					for (const provider of this.settings.providers) {
						if (!validateTag(provider.tag)) {
							new Notice('❌ 标签格式无效: ' + provider.tag)
							return
						}
					}

					// 临时启用自动保存来真正保存设置
					this.autoSaveEnabled = true
					await this.settingsContext.saveSettings()
					this.autoSaveEnabled = previousAutoSaveState
					new Notice('✅ 设置已保存')

					// OpenRouter: 保存后检查是否需要重新渲染（模型变化导致功能切换）
					if (vendor.name === openRouterVendor.name) {
						this.render(this.containerEl, false, this.currentOpenProviderIndex)
					}
					
					// 关闭模态框
					if (modal) {
						modal.close()
					}
				})
		})

		// 恢复自动保存状态
		this.autoSaveEnabled = previousAutoSaveState
	}

	// 旧的 createProviderSetting 方法（使用 details）已被上面的新实现替换

	addTagSection = (details: HTMLElement, settings: ProviderSettings, index: number, defaultTag: string) =>
		new Setting(details)
			.setName('✨ ' + t('Assistant message tag'))
			.setDesc(t('Tag used to trigger AI text generation'))
			.addText((text) =>
				text
					.setPlaceholder(defaultTag)
					.setValue(settings.tag)
					.onChange(async (value) => {
						const trimmed = value.trim()
						// 只更新内存中的值,不进行验证和弹出通知
						// 验证将在点击保存按钮时进行
						if (trimmed.length === 0) return
						
						settings.tag = trimmed
						// 实时更新外部卡片标题
						const titleEl = this.providerTitleEls.get(index)
						if (titleEl) {
							titleEl.textContent = getSummary(settings.tag, defaultTag)
						}
						await this.saveSettings()
					})
			)

	addBaseURLSection = (details: HTMLElement, options: BaseOptions, defaultValue: string) => {
		let textInput: HTMLInputElement | null = null
		return new Setting(details)
			.setName('baseURL')
			.setDesc(t('Default:') + ' ' + defaultValue)
			.addExtraButton((btn) => {
				btn
					.setIcon('reset')
					.setTooltip(t('Restore default'))
					.onClick(async () => {
						options.baseURL = defaultValue
						await this.saveSettings()
						if (textInput) {
							textInput.value = defaultValue
						}
					})
			})
			.addText((text) => {
				textInput = text.inputEl
				text.setValue(options.baseURL).onChange(async (value) => {
					options.baseURL = value.trim()
					await this.saveSettings()
				})
			})
	}

	addAPIkeySection = (details: HTMLElement, options: BaseOptions, desc: string = '') => {
		let isPasswordVisible = false
		let textInput: HTMLInputElement | null = null
		let toggleButton: HTMLButtonElement | null = null
		
		const setting = new Setting(details)
			.setName('API key')
			.setDesc(desc)
			.addText((text) => {
				textInput = text.inputEl
				textInput.type = 'password' // 默认隐藏
				text
					.setPlaceholder(t('API key (required)'))
					.setValue(options.apiKey)
					.onChange(async (value) => {
						options.apiKey = value.trim()
						await this.saveSettings()
					})
			})
			.addButton((btn) => {
				toggleButton = btn.buttonEl
				btn
					.setIcon('eye-off')
					.setTooltip('显示/隐藏密钥')
					.onClick(() => {
						isPasswordVisible = !isPasswordVisible
						if (textInput) {
							textInput.type = isPasswordVisible ? 'text' : 'password'
						}
						if (toggleButton) {
							btn.setIcon(isPasswordVisible ? 'eye' : 'eye-off')
						}
					})
				
				// 设置按钮样式
				toggleButton.addClass('clickable-icon')
			})
		
		return setting
	}

	addAPISecretOptional = (
		details: HTMLElement,
		options: BaseOptions & Pick<Optional, 'apiSecret'>,
		desc: string = ''
	) => {
		let isPasswordVisible = false
		let textInput: HTMLInputElement | null = null
		let toggleButton: HTMLButtonElement | null = null
		
		const setting = new Setting(details)
			.setName('API Secret')
			.setDesc(desc)
			.addText((text) => {
				textInput = text.inputEl
				textInput.type = 'password' // 默认隐藏
				text
					.setPlaceholder('')
					.setValue(options.apiSecret)
					.onChange(async (value) => {
						options.apiSecret = value.trim()
						await this.saveSettings()
					})
			})
			.addButton((btn) => {
				toggleButton = btn.buttonEl
				btn
					.setIcon('eye-off')
					.setTooltip('显示/隐藏密钥')
					.onClick(() => {
						isPasswordVisible = !isPasswordVisible
						if (textInput) {
							textInput.type = isPasswordVisible ? 'text' : 'password'
						}
						if (toggleButton) {
							btn.setIcon(isPasswordVisible ? 'eye' : 'eye-off')
						}
					})
				
				// 设置按钮样式
				toggleButton.addClass('clickable-icon')
			})
		
		return setting
	}

	addModelButtonSection = (
		details: HTMLElement,
		options: BaseOptions,
		modelConfig: { url: string; requiresApiKey: boolean },
		desc: string,
		vendorName?: string,
		index?: number,
		settings?: ProviderSettings,
		vendor?: Vendor,
		modal?: ProviderSettingModal
	) => {
		const setting = new Setting(details).setName(t('Model')).setDesc(desc)

		let buttonComponent: HTMLButtonElement | null = null
		let textInputComponent: HTMLInputElement | null = null
		let switchToCustomButtonEl: HTMLElement | null = null
		let switchToSelectButtonEl: HTMLElement | null = null
		let isShowingCustomInput = false

		// 创建选择按钮（用于从API获取模型列表）
		setting.addButton((btn) => {
			buttonComponent = btn.buttonEl
			btn
				.setButtonText(options.model ? options.model : t('Select the model to use'))
				.onClick(async () => {
					// Check if API key is required but not provided
					if (modelConfig.requiresApiKey && !options.apiKey) {
						new Notice(t('Please input API key first'))
						return
					}
					try {
						const models = await fetchModels(
							modelConfig.url,
							modelConfig.requiresApiKey ? options.apiKey : undefined
						)
						const onChoose = async (selectedModel: string) => {
							options.model = selectedModel
							await this.saveSettings()
							btn.setButtonText(selectedModel)
							// OpenRouter: 模型改变时更新功能显示和配置界面
							if (vendorName === openRouterVendor.name && index !== undefined && settings) {
								// 更新Provider卡片中的功能显示
								this.updateProviderCapabilities(index, settings)

								// 如果当前配置Modal是打开的，重新渲染Modal内容以更新配置项
								if (this.currentOpenProviderIndex === index && modal && vendor) {
									// 清空Modal容器并重新渲染配置内容
									modal.configContainer.empty()
									this.renderProviderConfig(modal.configContainer, index, settings, vendor, modal)
								}
							}
						}
						new SelectModelModal(this.app, models, onChoose).open()
					} catch (error) {
						if (error instanceof Error) {
							const errorMessage = error.message.toLowerCase()
							if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
								new Notice('🔑 ' + t('API key may be incorrect. Please check your API key.'))
							} else if (errorMessage.includes('403') || errorMessage.includes('forbidden')) {
								new Notice('🚫 ' + t('Access denied. Please check your API permissions.'))
							} else {
								new Notice('🔴 ' + error.message)
							}
						} else {
							new Notice('🔴 ' + String(error))
						}
					}
				})
		})

		// 创建文本输入框（用于自定义模型）
		setting.addText((text) => {
			textInputComponent = text.inputEl
			text
				.setPlaceholder(t('Enter custom model name'))
				.setValue(options.model || '')
				.onChange(async (value) => {
					options.model = value.trim()
					await this.saveSettings()
					if (buttonComponent) {
						buttonComponent.textContent = value.trim() || t('Select the model to use')
					}
					// OpenRouter: 模型改变时更新功能显示和配置界面
					if (vendorName === openRouterVendor.name && index !== undefined && settings) {
						// 更新Provider卡片中的功能显示
						this.updateProviderCapabilities(index, settings)

						// 如果当前配置Modal是打开的，重新渲染Modal内容以更新配置项
						if (this.currentOpenProviderIndex === index && modal && vendor) {
							// 清空Modal容器并重新渲染配置内容
							modal.configContainer.empty()
							this.renderProviderConfig(modal.configContainer, index, settings, vendor, modal)
						}
					}
				})

			// 初始状态：隐藏文本输入框
			textInputComponent.style.display = 'none'
			textInputComponent.style.width = '200px'
		})

		// 添加"切换到自定义"按钮
		setting.addButton((btn) => {
			switchToCustomButtonEl = btn.buttonEl
			btn
				.setButtonText('✏️')
				.setTooltip(t('Switch to custom input'))
				.onClick(() => {
					isShowingCustomInput = true
					if (buttonComponent) {
						buttonComponent.style.display = 'none'
					}
					if (textInputComponent) {
						textInputComponent.style.display = 'inline-block'
						textInputComponent.value = options.model || ''
						textInputComponent.focus()
					}
					if (switchToCustomButtonEl) {
						switchToCustomButtonEl.style.display = 'none'
					}
					if (switchToSelectButtonEl) {
						switchToSelectButtonEl.style.display = 'inline-block'
					}
				})
		})

		// 添加"切换到选择"按钮
		setting.addButton((btn) => {
			switchToSelectButtonEl = btn.buttonEl
			btn
				.setButtonText('↩')
				.setTooltip(t('Switch to model selection'))
				.onClick(() => {
					isShowingCustomInput = false
					if (buttonComponent) {
						buttonComponent.style.display = 'inline-block'
					}
					if (textInputComponent) {
						textInputComponent.style.display = 'none'
					}
					if (switchToCustomButtonEl) {
						switchToCustomButtonEl.style.display = 'inline-block'
					}
					if (switchToSelectButtonEl) {
						switchToSelectButtonEl.style.display = 'none'
					}
				})

			// 初始状态：隐藏此按钮
			switchToSelectButtonEl.style.display = 'none'
		})

		return setting
	}

	addModelDropDownSection = (details: HTMLElement, options: BaseOptions, models: string[], desc: string) => {
		const CUSTOM_MODEL_KEY = '__custom__'
		const isCustomModel = !models.includes(options.model) && options.model !== ''
		
		const setting = new Setting(details)
			.setName(t('Model'))
			.setDesc(desc)
		
		let dropdownComponent: DropdownComponent | null = null
		let textInputComponent: HTMLInputElement | null = null
		let backButtonEl: HTMLElement | null = null
		let isShowingCustomInput = isCustomModel
		
		// 创建下拉框
		setting.addDropdown((dropdown) => {
			dropdownComponent = dropdown
			// 添加所有预设模型
			const optionsMap = models.reduce((acc: Record<string, string>, cur: string) => {
				acc[cur] = cur
				return acc
			}, {})
			// 添加"自定义"选项
			optionsMap[CUSTOM_MODEL_KEY] = t('Custom')
			
			dropdown.addOptions(optionsMap)
			
			// 设置初始值
			if (isCustomModel) {
				dropdown.setValue(CUSTOM_MODEL_KEY)
			} else {
				dropdown.setValue(options.model || models[0])
			}
			
			dropdown.onChange(async (value) => {
				if (value === CUSTOM_MODEL_KEY) {
					// 切换到自定义输入模式
					isShowingCustomInput = true
					if (dropdownComponent) {
						dropdownComponent.selectEl.style.display = 'none'
					}
					if (textInputComponent) {
						textInputComponent.style.display = 'inline-block'
						textInputComponent.focus()
					}
					if (backButtonEl) {
						backButtonEl.style.display = 'inline-block'
					}
				} else {
					// 选择了预设模型
					options.model = value
					await this.saveSettings()
					this.doubaoRenderers.get(options)?.()
				}
			})
		})
		
		// 创建文本输入框（用于自定义模型）
		setting.addText((text) => {
			textInputComponent = text.inputEl
			text
				.setPlaceholder(t('Enter custom model name'))
				.setValue(isCustomModel ? options.model : '')
				.onChange(async (value) => {
					options.model = value.trim()
					await this.saveSettings()
					this.doubaoRenderers.get(options)?.()
				})
			
			// 初始状态：根据是否是自定义模型决定显示
			textInputComponent.style.display = isShowingCustomInput ? 'inline-block' : 'none'
			textInputComponent.style.width = '200px'
		})
		
		// 添加切换按钮（从自定义模式切换回下拉选择）
		setting.addButton((btn) => {
			backButtonEl = btn.buttonEl
			btn
				.setButtonText('↩')
				.setTooltip(t('Back to preset models'))
				.onClick(() => {
					isShowingCustomInput = false
					if (textInputComponent) {
						textInputComponent.style.display = 'none'
					}
					if (dropdownComponent) {
						dropdownComponent.selectEl.style.display = 'inline-block'
						// 选择第一个预设模型
						if (models.length > 0) {
							dropdownComponent.setValue(models[0])
							options.model = models[0]
							this.saveSettings()
							this.doubaoRenderers.get(options)?.()
						}
					}
					if (backButtonEl) {
						backButtonEl.style.display = 'none'
					}
				})
			
			// 初始状态：只在显示自定义输入时显示按钮
			backButtonEl.style.display = isShowingCustomInput ? 'inline-block' : 'none'
		})
		
		return setting
	}

	addModelTextSection = (details: HTMLElement, options: BaseOptions, desc: string) =>
		new Setting(details)
			.setName(t('Model'))
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder('')
					.setValue(options.model)
					.onChange(async (value) => {
						options.model = value.trim()
						await this.saveSettings()
					})
			)

	addClaudeSections = (details: HTMLElement, options: ClaudeOptions) => {
		new Setting(details)
			.setName(t('Thinking'))
			.setDesc(t('When enabled, Claude will show its reasoning process before giving the final answer.'))
			.addToggle((toggle) =>
				toggle.setValue(options.enableThinking ?? false).onChange(async (value) => {
					options.enableThinking = value
					await this.saveSettings()
				})
			)

		new Setting(details)
			.setName(t('Budget tokens for thinking'))
			.setDesc(t('Must be ≥1024 and less than max_tokens'))
			.addText((text) =>
				text
					.setPlaceholder('')
					.setValue(options.budget_tokens ? options.budget_tokens.toString() : '1600')
					.onChange(async (value) => {
						const number = parseInt(value)
						if (isNaN(number)) {
							new Notice(t('Please enter a number'))
							return
						}
						if (number < 1024) {
							new Notice(t('Minimum value is 1024'))
							return
						}
						options.budget_tokens = number
						await this.saveSettings()
					})
			)

		new Setting(details)
			.setName('Max tokens')
			.setDesc(t('Refer to the technical documentation'))
			.addText((text) =>
				text
					.setPlaceholder('')
					.setValue(options.max_tokens.toString())
					.onChange(async (value) => {
						const number = parseInt(value)
						if (isNaN(number)) {
							new Notice(t('Please enter a number'))
							return
						}
						if (number < 256) {
							new Notice(t('Minimum value is 256'))
							return
						}
						options.max_tokens = number
						await this.saveSettings()
					})
			)
	}

	addEndpointOptional = (details: HTMLElement, options: BaseOptions & Pick<Optional, 'endpoint'>) =>
		new Setting(details)
			.setName(t('Endpoint'))
			.setDesc('e.g. https://docs-test-001.openai.azure.com/')
			.addText((text) =>
				text
					.setPlaceholder('')
					.setValue(options.endpoint)
					.onChange(async (value) => {
						const url = value.trim()
						if (url.length === 0) {
							// Empty string is valid, clearing endpoint
							options.endpoint = ''
							await this.saveSettings()
						} else if (!isValidUrl(url)) {
							new Notice(t('Invalid URL'))
							return
						} else {
							options.endpoint = url
							await this.saveSettings()
						}
					})
			)

	addApiVersionOptional = (details: HTMLElement, options: BaseOptions & Pick<Optional, 'apiVersion'>) =>
		new Setting(details)
			.setName(t('API version'))
			.setDesc('e.g. 2024-xx-xx-preview')
			.addText((text) =>
				text
					.setPlaceholder('')
					.setValue(options.apiVersion)
					.onChange(async (value) => {
						options.apiVersion = value.trim()
						await this.saveSettings()
					})
			)

	addParametersSection = (details: HTMLElement, options: BaseOptions) => {
		const setting = new Setting(details)
			.setName(t('Additional parameters'))
			.setDesc(t('Additional parameters description'))
			.addTextArea((text) =>
				text
					.setPlaceholder('{"temperature": 0.7, "top_p": 0.9}')
					.setValue(JSON.stringify(options.parameters))
					.onChange(async (value) => {
						try {
							const trimmed = value.trim()
							if (trimmed === '') {
								// Empty string is valid, clearing parameters
								options.parameters = {}
								await this.saveSettings()
								return
							}
							const parsed = JSON.parse(trimmed)
							// 检查是否包含model字段，如果有则警告
							if (parsed.model) {
								new Notice(t('Please set model in the Model field above, not here'))
								return
							}
							options.parameters = parsed
							await this.saveSettings()
						} catch {
							// This is difficult to handle properly - onChange triggers quickly, and users might receive frequent error messages before they finish typing, which is annoying
							return
						}
					})
			)
		
		// 添加说明文本
		setting.descEl.createEl('div', {
			text: t('Common parameters example'),
			cls: 'setting-item-description'
		})
		
		return setting
	}

	addGptImageSections = (details: HTMLElement, options: GptImageOptions) => {
		new Setting(details)
			.setName(t('Image Display Width'))
			.setDesc(t('Example: 400px width would output as ![[image.jpg|400]]'))
			.addSlider((slider) =>
				slider
					.setLimits(200, 800, 100)
					.setValue(options.displayWidth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.displayWidth = value
						await this.saveSettings()
					})
			)
		new Setting(details)
			.setName(t('Number of images'))
			.setDesc(t('Number of images to generate (1-5)'))
			.addSlider((slider) =>
				slider
					.setLimits(1, 5, 1)
					.setValue(options.n)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.n = value
						await this.saveSettings()
					})
			)
		new Setting(details).setName(t('Image size')).addDropdown((dropdown) =>
			dropdown
				.addOptions({
					auto: 'Auto',
					'1024x1024': '1024x1024',
					'1536x1024': '1536x1024 ' + t('landscape'),
					'1024x1536': '1024x1536 ' + t('portrait')
				})
				.setValue(options.size)
				.onChange(async (value) => {
					options.size = value as GptImageOptions['size']
					await this.saveSettings()
				})
		)
		new Setting(details).setName(t('Output format')).addDropdown((dropdown) =>
			dropdown
				.addOptions({
					png: 'PNG',
					jpeg: 'JPEG',
					webp: 'WEBP'
				})
				.setValue(options.output_format)
				.onChange(async (value) => {
					options.output_format = value as GptImageOptions['output_format']
					await this.saveSettings()
				})
		)
		new Setting(details)
			.setName(t('Quality'))
			.setDesc(t('Quality level for generated images. default: Auto'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						auto: t('Auto'),
						high: t('High'),
						medium: t('Medium'),
						low: t('Low')
					})
					.setValue(options.quality)
					.onChange(async (value) => {
						options.quality = value as GptImageOptions['quality']
						await this.saveSettings()
					})
			)
		new Setting(details)
			.setName(t('Background'))
			.setDesc(t('Background of the generated image. default: Auto'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						auto: t('Auto'),
						transparent: t('Transparent'),
						opaque: t('Opaque')
					})
					.setValue(options.background)
					.onChange(async (value) => {
						options.background = value as GptImageOptions['background']
						await this.saveSettings()
					})
			)
		new Setting(details)
			.setName(t('Output compression'))
			.setDesc(t('Compression level of the output image, 10% - 100%. Only for webp or jpeg output format'))
			.addSlider((slider) =>
				slider
					.setLimits(10, 100, 10)
					.setValue(options.output_compression)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.output_compression = value
						await this.saveSettings()
					})
			)
	}

	addDoubaoSections = (details: HTMLElement, options: DoubaoOptions) => {
		const thinkingContainer = details.createDiv({ cls: 'tars-doubao-thinking-section' })
		const renderThinkingControls = () => {
			thinkingContainer.empty()
			this.renderDoubaoThinkingControls(thinkingContainer, options)
		}
		renderThinkingControls()
		this.doubaoRenderers.set(options, renderThinkingControls)

		// 图片理解精细度控制 - 使用detail字段
		new Setting(details)
			.setName('图片理解精细度（detail）')
			.setDesc('控制模型理解图片的精细程度。低分辨率速度快，高分辨率细节多。留空使用API默认值')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'': '不设置（使用默认）',
						'low': '低分辨率（速度快）',
						'high': '高分辨率（细节多）'
					})
					.setValue(options.imageDetail || '')
					.onChange(async (value) => {
						options.imageDetail = value ? (value as 'low' | 'high') : undefined
						await this.saveSettings()
					})
			)

		// 图片像素限制 - 最小像素
		new Setting(details)
			.setName('图片最小像素（min_pixels）')
			.setDesc('图片理解的最小像素值（196-36000000）。留空或0不设置。优先级高于detail字段')
			.addText((text) =>
				text
					.setPlaceholder('例如: 3136')
					.setValue(options.imagePixelLimit?.minPixels?.toString() || '')
					.onChange(async (value) => {
						const numValue = parseInt(value)
						if (!options.imagePixelLimit) {
							options.imagePixelLimit = {}
						}
						if (value === '' || isNaN(numValue) || numValue === 0) {
							delete options.imagePixelLimit.minPixels
						} else if (numValue >= 196 && numValue <= 36000000) {
							options.imagePixelLimit.minPixels = numValue
						} else {
							new Notice('像素值必须在 196 到 36000000 之间')
							return
						}
						await this.saveSettings()
					})
			)

		// 图片像素限制 - 最大像素
		new Setting(details)
			.setName('图片最大像素（max_pixels）')
			.setDesc('图片理解的最大像素值（196-36000000）。留空或0不设置。优先级高于detail字段')
			.addText((text) =>
				text
					.setPlaceholder('例如: 1048576')
					.setValue(options.imagePixelLimit?.maxPixels?.toString() || '')
					.onChange(async (value) => {
						const numValue = parseInt(value)
						if (!options.imagePixelLimit) {
							options.imagePixelLimit = {}
						}
						if (value === '' || isNaN(numValue) || numValue === 0) {
							delete options.imagePixelLimit.maxPixels
						} else if (numValue >= 196 && numValue <= 36000000) {
							options.imagePixelLimit.maxPixels = numValue
						} else {
							new Notice('像素值必须在 196 到 36000000 之间')
							return
						}
						await this.saveSettings()
					})
			)
	}

	private renderDoubaoThinkingControls = (container: HTMLElement, options: DoubaoOptions) => {
		const model = options.model
		const capability = getDoubaoModelCapability(model)
		const thinkingSetting = new Setting(container).setName(t('Doubao thinking mode'))

		if (!model) {
			thinkingSetting
				.setDesc(t('Select a model first to configure deep thinking.'))
				.addDropdown((dropdown) => {
					dropdown.addOption('', t('Select a model first'))
					dropdown.setValue('')
					dropdown.setDisabled(true)
				})
			return
		}

		if (!capability) {
			thinkingSetting
				.setDesc(t('Current model does not support configuring deep thinking.'))
				.addDropdown((dropdown) => {
					dropdown.addOption('', t('Not supported'))
					dropdown.setValue('')
					dropdown.setDisabled(true)
				})
			return
		}

		const supportedTypes = capability.thinkingTypes
		const fallbackType = supportedTypes.includes(DEFAULT_DOUBAO_THINKING_TYPE)
			? DEFAULT_DOUBAO_THINKING_TYPE
			: supportedTypes[0]
		const initialThinking: DoubaoThinkingType =
			options.thinkingType && supportedTypes.includes(options.thinkingType)
				? options.thinkingType
				: fallbackType

		let reasoningDropdown: DropdownComponent | null = null
		const thinkingLabels: Record<DoubaoThinkingType, string> = {
			enabled: t('Force enable deep thinking'),
			disabled: t('Force disable deep thinking'),
			auto: t('Let the model decide deep thinking automatically')
		}

		thinkingSetting
			.setDesc(t('Control whether the Doubao model performs deep thinking before answering.'))
			.addDropdown((dropdown) => {
				for (const type of supportedTypes) {
					dropdown.addOption(type, thinkingLabels[type])
				}
				dropdown.setValue(initialThinking)
				dropdown.onChange(async (value) => {
					const newValue = value as DoubaoThinkingType
					options.thinkingType = newValue
					if (capability.supportsReasoningEffort && reasoningDropdown) {
						if (newValue === 'enabled') {
							const validEffort =
								options.reasoningEffort && DOUBAO_REASONING_EFFORT_OPTIONS.includes(options.reasoningEffort)
									? options.reasoningEffort
									: 'low'
							reasoningDropdown.setDisabled(false)
							reasoningDropdown.setValue(validEffort)
							options.reasoningEffort = validEffort
						} else {
							reasoningDropdown.setDisabled(true)
							reasoningDropdown.setValue('minimal')
							options.reasoningEffort = 'minimal'
						}
					}
					await this.saveSettings()
				})
			})

		if (!capability.supportsReasoningEffort) {
			return
		}

		const reasoningLabels: Record<DoubaoReasoningEffort, string> = {
			minimal: t('Minimal reasoning (direct answer)'),
			low: t('Low reasoning (quick response)'),
			medium: t('Medium reasoning (balanced)'),
			high: t('High reasoning (deep analysis)')
		}

		const storedEffort =
			options.reasoningEffort && DOUBAO_REASONING_EFFORT_OPTIONS.includes(options.reasoningEffort)
				? options.reasoningEffort
				: 'low'
		const initialReasoning: DoubaoReasoningEffort = initialThinking === 'enabled' ? storedEffort : 'minimal'
		if (initialThinking === 'enabled') {
			options.reasoningEffort = storedEffort
		}

		new Setting(container)
			.setName(t('Reasoning effort'))
			.setDesc(t('Adjust how long the model thinks before answering. Only available when deep thinking is enabled.'))
			.addDropdown((dropdown) => {
				for (const effort of DOUBAO_REASONING_EFFORT_OPTIONS) {
					dropdown.addOption(effort, reasoningLabels[effort])
				}
				dropdown.setValue(initialReasoning)
				dropdown.setDisabled(initialThinking !== 'enabled')
				dropdown.onChange(async (value) => {
					options.reasoningEffort = value as DoubaoReasoningEffort
					await this.saveSettings()
				})
				reasoningDropdown = dropdown
			})
	}

	addDoubaoImageSections = (details: HTMLElement, options: DoubaoImageOptions) => {
		// 图片显示宽度
		new Setting(details)
			.setName(t('Image Display Width'))
			.setDesc(t('Example: 400px width would output as ![[image.jpg|400]]'))
			.addSlider((slider) =>
				slider
					.setLimits(200, 800, 100)
					.setValue(options.displayWidth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.displayWidth = value
						await this.saveSettings()
					})
			)
		
		// 图片尺寸
		new Setting(details)
			.setName(t('Image size'))
			.setDesc('支持分辨率（1K/2K/4K）或精确像素值')
			.addDropdown((dropdown) => {
				dropdown
					.addOptions(DOUBAO_IMAGE_SIZE_PRESETS)
					.setValue(options.size)
					.onChange(async (value) => {
						options.size = value
						await this.saveSettings()
					})
				return dropdown
			})
		
		// 响应格式
		new Setting(details)
			.setName('响应格式')
			.setDesc('选择接收生成图像的方式')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'b64_json': 'Base64 JSON (推荐)',
						'url': 'URL'
					})
					.setValue(options.response_format)
					.onChange(async (value) => {
						options.response_format = value as DoubaoImageOptions['response_format']
						await this.saveSettings()
					})
			)
		
		// 组图功能
		new Setting(details)
			.setName('组图功能')
			.setDesc('开启后模型可根据提示词生成多张关联图片')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'disabled': '关闭（单图输出）',
						'auto': '自动判断（组图输出）'
					})
					.setValue(options.sequential_image_generation || 'disabled')
					.onChange(async (value) => {
						options.sequential_image_generation = value as 'auto' | 'disabled'
						await this.saveSettings()
					})
			)
		
		// 最大图片数量（仅在组图模式下生效）
		new Setting(details)
			.setName('最大图片数量')
			.setDesc('组图模式下最多生成的图片数量（1-15）。注意：输入参考图+生成图总数≤15')
			.addSlider((slider) =>
				slider
					.setLimits(1, 15, 1)
					.setValue(options.max_images || 5)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.max_images = value
						await this.saveSettings()
					})
			)
		
		// 流式输出
		new Setting(details)
			.setName('流式输出')
			.setDesc('开启后每生成一张图片即返回，无需等待全部生成完成。注意：流式输出可能增加请求处理时间')
			.addToggle((toggle) =>
				toggle
					.setValue(options.stream ?? false)
					.onChange(async (value) => {
						options.stream = value
						await this.saveSettings()
					})
			)
		
		// 提示词优化
		new Setting(details)
			.setName('提示词优化模式')
			.setDesc('标准模式质量更高但耗时较长，快速模式速度快但质量一般')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'standard': '标准模式（推荐）',
						'fast': '快速模式'
					})
					.setValue(options.optimize_prompt_mode || 'standard')
					.onChange(async (value) => {
						options.optimize_prompt_mode = value as 'standard' | 'fast'
						await this.saveSettings()
					})
			)
		
		// 水印
		new Setting(details)
			.setName('水印')
			.setDesc('为生成的图像添加水印')
			.addToggle((toggle) =>
				toggle
					.setValue(options.watermark ?? false)
					.onChange(async (value) => {
						options.watermark = value
						await this.saveSettings()
					})
			)
	}

	/**
	 * OpenRouter 网络搜索配置部分
	 * 支持自定义搜索引擎、结果数量和搜索提示
	 */
	addOpenRouterWebSearchSections = (details: HTMLElement, options: OpenRouterOptions) => {
		// 搜索引擎选择
		new Setting(details)
			.setName('搜索引擎')
			.setDesc('选择搜索引擎。自动：OpenAI/Anthropic 使用 native，其他使用 exa')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'auto': '自动选择（推荐）',
						'native': 'Native（原生搜索）',
						'exa': 'Exa（通用搜索）'
					})
					.setValue(options.webSearchEngine || 'auto')
					.onChange(async (value) => {
						if (value === 'auto') {
							options.webSearchEngine = undefined
						} else {
							options.webSearchEngine = value as 'native' | 'exa'
						}
						await this.saveSettings()
					})
			)

		// 搜索结果数量
		new Setting(details)
			.setName('搜索结果数量')
			.setDesc('控制返回的搜索结果数量（1-10）。更多结果可能提供更全面的信息，但会增加 token 消耗')
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(options.webSearchMaxResults ?? 5)
					.setDynamicTooltip()
					.onChange(async (value) => {
						options.webSearchMaxResults = value
						await this.saveSettings()
					})
			)

		// 自定义搜索提示
		new Setting(details)
			.setName('自定义搜索提示')
			.setDesc('自定义在搜索结果前添加的提示文本。留空使用默认提示')
			.addTextArea((text) => {
				text
					.setPlaceholder('A web search was conducted on {date}. Incorporate the following web search results into your response.\n\nIMPORTANT: Cite them using markdown links.')
					.setValue(options.webSearchPrompt || '')
					.onChange(async (value) => {
						const trimmed = value.trim()
						options.webSearchPrompt = trimmed || undefined
						await this.saveSettings()
					})
				text.inputEl.rows = 4
				text.inputEl.style.width = '100%'
				return text
			})
	}

	/**
	 * OpenRouter 图像生成配置部分
	 * 支持配置图片宽高比、流式生成、格式和保存方式
	 */
	addOpenRouterImageGenerationSections = (details: HTMLElement, options: OpenRouterOptions) => {
		// 图片宽高比配置
		new Setting(details)
			.setName('图片宽高比')
			.setDesc('选择生成图片的宽高比。不同宽高比对应不同的像素尺寸')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'1:1': '1:1 (1024×1024)',
						'2:3': '2:3 (832×1248)',
						'3:2': '3:2 (1248×832)',
						'3:4': '3:4 (864×1184)',
						'4:3': '4:3 (1184×864)',
						'4:5': '4:5 (896×1152)',
						'5:4': '5:4 (1152×896)',
						'9:16': '9:16 (768×1344)',
						'16:9': '16:9 (1344×768)',
						'21:9': '21:9 (1536×672)'
					})
					.setValue(options.imageAspectRatio || '1:1')
					.onChange(async (value) => {
						options.imageAspectRatio = value as OpenRouterOptions['imageAspectRatio']
						await this.saveSettings()
					})
			)

		// 流式生成开关
		new Setting(details)
			.setName('流式图像生成')
			.setDesc('开启后图像生成过程将以流式方式返回。某些模型支持在生成过程中逐步显示结果')
			.addToggle((toggle) =>
				toggle
					.setValue(options.imageStream ?? false)
					.onChange(async (value) => {
						options.imageStream = value
						await this.saveSettings()
					})
			)

		// 图片格式选择
		new Setting(details)
			.setName('图片返回格式')
			.setDesc('选择图片的返回格式：Base64（嵌入在响应中）或 URL（提供下载链接）')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'b64_json': 'Base64 JSON（推荐）',
						'url': 'URL 链接'
					})
					.setValue(options.imageResponseFormat || 'b64_json')
					.onChange(async (value) => {
						options.imageResponseFormat = value as 'url' | 'b64_json'
						await this.saveSettings()
					})
			)

		// 保存方式选择
		new Setting(details)
			.setName('图片保存方式')
			.setDesc('选择是否将图片保存为附件。关闭后将直接输出 URL 或 Base64 数据')
			.addToggle((toggle) =>
				toggle
					.setValue(options.imageSaveAsAttachment ?? true)
					.onChange(async (value) => {
						options.imageSaveAsAttachment = value
						await this.saveSettings()
					})
			)

		// 图片显示宽度（仅在保存为附件时生效）
		if (options.imageSaveAsAttachment) {
			new Setting(details)
				.setName('图片显示宽度')
				.setDesc('设置图片在笔记中的显示宽度（像素）')
				.addSlider((slider) =>
					slider
						.setLimits(200, 800, 50)
						.setValue(options.imageDisplayWidth || 400)
						.setDynamicTooltip()
						.onChange(async (value) => {
							options.imageDisplayWidth = value
							await this.saveSettings()
						})
				)
		}
	}

	/**
	 * OpenRouter Reasoning 推理配置部分
	 * 支持配置推理努力级别
	 */
	addOpenRouterReasoningSections = (details: HTMLElement, options: OpenRouterOptions) => {
		// Reasoning 努力级别配置
		new Setting(details)
			.setName('推理努力级别')
			.setDesc('控制模型推理的计算努力程度。更高的级别会进行更深入的推理，但会消耗更多 token')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'minimal': 'Minimal（最小）',
						'low': 'Low（低）',
						'medium': 'Medium（中等，推荐）',
						'high': 'High（高）'
					})
					.setValue(options.reasoningEffort || 'medium')
					.onChange(async (value) => {
						options.reasoningEffort = value as OpenRouterOptions['reasoningEffort']
						await this.saveSettings()
					})
			)
	}

	private async testProviderConfiguration(provider: ProviderSettings): Promise<boolean> {
		const vendor = availableVendors.find((v) => v.name === provider.vendor)
		if (!vendor) {
			new Notice(`${t('Model test failed')}: ${t('Vendor not found')}`)
			return false
		}

		new Notice(t('Testing model...'))
		try {
			const sendRequest = vendor.sendRequestFunc(provider.options)
			const controller = new AbortController()
			const resolveEmbed: ResolveEmbedAsBinary = async () => {
				throw new Error(t('Model test embed unsupported'))
			}
			// 为图片生成模型提供模拟的 saveAttachment 函数
			const saveAttachment = async (filename: string, data: ArrayBuffer) => {
				DebugLogger.debug(`[Test Mode] Would save file: ${filename}, size: ${data.byteLength} bytes`)
				// 测试模式下不实际保存文件，只记录日志
			}
			const messages: Message[] = [
				{ role: 'system', content: t('Model test system prompt') },
				{ role: 'user', content: t('Model test user prompt') }
			]
			let received = ''
			for await (const chunk of sendRequest(messages, controller, resolveEmbed, saveAttachment)) {
				received += chunk
				if (received.length > 2000) {
					received = received.slice(0, 2000)
				}
			}
			if (received.trim().length === 0) {
				throw new Error(t('Model test empty response'))
			}
			new Notice(t('Model test succeeded'))
			return true
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (error instanceof Error && error.name === 'AbortError') {
				new Notice(t('Model test succeeded'))
				return true
			}
			new Notice(`${t('Model test failed')}: ${message}`)
			return false
		}
	}

	private addZhipuSections = (details: HTMLElement, options: ZhipuOptions) => {
		// 直接显示推理类型配置（通过选择推理类型来控制是否启用推理）
		this.addZhipuReasoningSections(details, options)
	}

	private addZhipuReasoningSections = (details: HTMLElement, options: ZhipuOptions) => {
		// 推理类型选择
		const supportedTypes = ZHIPU_THINKING_TYPE_OPTIONS.map(opt => opt.value)
		const initialType: import('./providers/zhipu').ZhipuThinkingType = options.thinkingType && supportedTypes.includes(options.thinkingType)
			? options.thinkingType
			: DEFAULT_ZHIPU_THINKING_TYPE

		new Setting(details)
			.setName('推理类型')
			.setDesc('控制 Zhipu AI 模型的推理行为')
			.addDropdown((dropdown) => {
				for (const option of ZHIPU_THINKING_TYPE_OPTIONS) {
					dropdown.addOption(option.value, option.label)
				}
				dropdown.setValue(initialType)
				dropdown.onChange(async (value) => {
					const newThinkingType = value as import('./providers/zhipu').ZhipuThinkingType
					options.thinkingType = newThinkingType
					// 根据选择的推理类型自动设置 enableReasoning 状态
					options.enableReasoning = newThinkingType !== 'disabled'
					await this.saveSettings()
				})
			})

		// 模型兼容性提示
		if (!isReasoningModel(options.model)) {
			new Setting(details)
				.setName('模型兼容性提示')
				.setDesc('注意：当前模型可能不支持推理功能。支持的模型：GLM-4.6, GLM-4.5, GLM-4.5v')
				.setDisabled(true)
		}
	}

	private addQwenSections = (details: HTMLElement, options: QwenOptions) => {
		// 添加思考模式开关
		new Setting(details)
			.setName('思考模式')
			.setDesc('启用 Qwen 模型的推理过程输出。启用后，模型会在回复前展示思考过程。所有模型都可以尝试此功能，API会自动判断是否支持。')
			.addToggle((toggle) => {
				toggle.setValue(options.enableThinking ?? false).onChange(async (value) => {
					options.enableThinking = value
					await this.saveSettings()
				})
			})

		// 模型兼容性信息（更友好的提示）
		const knownThinkingModels = [
			'qwen3-max-preview',
			'qwen-plus', 'qwen-plus-latest', 'qwen-plus-2025-04-28',
			'qwen-flash', 'qwen-flash-2025-07-28',
			'qwen-turbo', 'qwen-turbo-latest', 'qwen-turbo-2025-04-28'
		]

		new Setting(details)
			.setName('思考模式说明')
			.setDesc(`已确认支持思考模式的模型：${knownThinkingModels.join(', ')}。其他模型也可能支持，API会自动处理。`)
			.setDisabled(true)
	}

	addKimiSections = (details: HTMLElement, options: KimiOptions, index: number, settings: ProviderSettings) => {
		new Setting(details)
			.setName('启用推理功能')
			.setDesc('启用后模型将显示其推理过程。推理内容将使用 [!quote] 标记包裹显示')
			.addToggle((toggle) =>
				toggle.setValue(options.enableReasoning ?? false).onChange(async (value) => {
					options.enableReasoning = value
					await this.saveSettings()
					// 更新功能显示
					this.updateProviderCapabilities(index, settings)
				})
			)
	}

	addDeepSeekSections = (details: HTMLElement, options: DeepSeekOptions, index: number, settings: ProviderSettings) => {
		new Setting(details)
			.setName('启用推理功能')
			.setDesc('启用后模型将显示其推理过程。推理内容将使用 [!quote] 标记包裹显示')
			.addToggle((toggle) =>
				toggle.setValue(options.enableReasoning ?? false).onChange(async (value) => {
					options.enableReasoning = value
					await this.saveSettings()
					// 更新功能显示
					this.updateProviderCapabilities(index, settings)
				})
			)
	}

	addGrokSections = (details: HTMLElement, options: GrokOptions, index: number, settings: ProviderSettings) => {
		new Setting(details)
			.setName('启用推理功能')
			.setDesc('启用后模型将显示其推理过程。推理内容将使用 [!quote] 标记包裹显示')
			.addToggle((toggle) =>
				toggle.setValue(options.enableReasoning ?? false).onChange(async (value) => {
					options.enableReasoning = value
					await this.saveSettings()
					// 更新功能显示
					this.updateProviderCapabilities(index, settings)
				})
			)
	}
}

const getSummary = (tag: string, defaultTag: string) =>
	tag === defaultTag ? defaultTag : tag + ' (' + defaultTag + ')'

const validateTag = (tag: string) => {
	if (tag.includes('#')) {
		new Notice(t('Keyword for tag must not contain #'))
		return false
	}
	if (tag.includes(' ')) {
		new Notice(t('Keyword for tag must not contain space'))
		return false
	}
	return true
}

const validateTagList = (tags: string[]) => {
	if (tags.length === 0) {
		new Notice(t('At least one tag is required'))
		return false
	}
	for (const tag of tags) {
		if (!validateTag(tag)) return false
	}
	return true
}

const isValidUrl = (url: string) => {
	try {
		new URL(url)
		return true
	} catch {
		return false
	}
}

const fetchModels = async (url: string, apiKey?: string): Promise<string[]> => {
	const response = await requestUrl({
		url,
		headers: {
			...(apiKey && { Authorization: `Bearer ${apiKey}` }),
			'Content-Type': 'application/json'
		}
	})
	const result = response.json
	return result.data.map((model: { id: string }) => model.id)
}

// Model fetching configurations for different vendors
const MODEL_FETCH_CONFIGS = {
	[siliconFlowVendor.name]: {
		url: 'https://api.siliconflow.cn/v1/models?type=text&sub_type=chat',
		requiresApiKey: true
	},
	[openRouterVendor.name]: {
		url: 'https://openrouter.ai/api/v1/models',
		requiresApiKey: false
	},
	[kimiVendor.name]: {
		url: 'https://api.moonshot.cn/v1/models',
		requiresApiKey: true
	},
	[grokVendor.name]: {
		url: 'https://api.x.ai/v1/models',
		requiresApiKey: true
	}
} as const
