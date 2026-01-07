import { App, DropdownComponent, Notice, requestUrl, Setting } from 'obsidian'
import { t } from './lang/helper'
import { SelectModelModal, SelectVendorModal, ProviderSettingModal } from './modal'
import { BaseOptions, Message, Optional, ProviderSettings, ResolveEmbedAsBinary, Vendor } from './providers'
import { ClaudeOptions, claudeVendor } from './providers/claude'
import { DebugLogger } from '../../utils/DebugLogger'
import { SkillDataService } from '../chat/selection-toolbar/SkillDataService'
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
import { localInstance } from '../../i18n/locals'

export interface TarsSettingsContext {
	getSettings: () => TarsSettings
	getChatSettings: () => ChatSettings
	getPromptTemplateFolder: () => string
	saveSettings: () => Promise<void>
	updateChatSettings: (partial: Partial<ChatSettings>) => Promise<void>
	refreshSkillsCache?: () => Promise<void>
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
	private isSelectionToolbarCollapsed = true // 默认折叠AI划词设置
	private isTabCompletionCollapsed = true // 默认折叠Tab补全设置
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

		new Setting(messageSection)
			.setName('内链解析最大深度')
			.setDesc('限制嵌套内链的递归层数，避免循环引用（默认 5 层）')
			.addSlider((slider) => {
				slider
					.setLimits(1, 10, 1)
					.setValue(this.settings.maxLinkParseDepth ?? 5)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.maxLinkParseDepth = value
						await this.saveSettings()
					})
			})

		new Setting(messageSection)
			.setName('内链解析超时时间')
			.setDesc('单个内链的解析超时（毫秒），超时后保留原始链接文本')
			.addSlider((slider) => {
				slider
					.setLimits(1000, 30000, 1000)
					.setValue(this.settings.linkParseTimeout ?? 5000)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.linkParseTimeout = value
						await this.saveSettings()
					})
			})

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

		// 功能区图标显示设置
		new Setting(chatSection)
			.setName("显示功能区图标")
			.setDesc("在Obsidian左侧功能区显示AI Chat图标按钮。禁用后可以通过命令面板或快捷键打开AI Chat。")
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.showRibbonIcon ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ showRibbonIcon: value });
				});
			});

		// 模态框宽度
		new Setting(chatSection)
			.setName("模态框宽度")
			.setDesc("AI Chat 模态框的宽度（像素）")
			.addSlider((slider) => {
				slider
					.setLimits(400, 1200, 50)
					.setValue(this.chatSettings.chatModalWidth ?? 700)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.updateChatSettings({ chatModalWidth: value });
					});
			});

		// 模态框高度
		new Setting(chatSection)
			.setName("模态框高度")
			.setDesc("AI Chat 模态框的高度（像素）")
			.addSlider((slider) => {
				slider
					.setLimits(300, 800, 50)
					.setValue(this.chatSettings.chatModalHeight ?? 500)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.updateChatSettings({ chatModalHeight: value });
					});
			});

		// 快捷技能设置区域
		this.renderSelectionToolbarSettings(containerEl);

		// AI Tab 补全设置区域（使用 Setting 组件，与上方保持一致）
		const tabCompletionHeaderSetting = new Setting(containerEl)
			.setName('AI Tab 补全')

		// 创建一个包装器来容纳图标
		const tabCompletionButtonWrapper = tabCompletionHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		tabCompletionButtonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加Chevron图标
		const tabCompletionChevronIcon = tabCompletionButtonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		tabCompletionChevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		tabCompletionChevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isTabCompletionCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域
		const tabCompletionHeaderEl = tabCompletionHeaderSetting.settingEl
		tabCompletionHeaderEl.style.cursor = 'pointer'
		tabCompletionHeaderEl.style.borderRadius = '0px'
		tabCompletionHeaderEl.style.border = '1px solid var(--background-modifier-border)'
		tabCompletionHeaderEl.style.marginBottom = '0px'
		tabCompletionHeaderEl.style.padding = '12px 12px'

		// 创建Tab补全设置容器
		const tabCompletionSection = containerEl.createDiv({ cls: 'tab-completion-settings-container' })
		tabCompletionSection.style.padding = '0 8px 8px 8px'
		tabCompletionSection.style.backgroundColor = 'var(--background-secondary)'
		tabCompletionSection.style.borderRadius = '0px'
		tabCompletionSection.style.border = '1px solid var(--background-modifier-border)'
		tabCompletionSection.style.borderTop = 'none'
		tabCompletionSection.style.display = this.isTabCompletionCollapsed ? 'none' : 'block'

		// 添加Tab补全区域折叠/展开功能
		const toggleTabCompletionSection = () => {
			this.isTabCompletionCollapsed = !this.isTabCompletionCollapsed
			tabCompletionChevronIcon.style.transform = this.isTabCompletionCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			tabCompletionSection.style.display = this.isTabCompletionCollapsed ? 'none' : 'block'
		}

		tabCompletionHeaderEl.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleTabCompletionSection()
		})

		tabCompletionChevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleTabCompletionSection()
		})

		new Setting(tabCompletionSection)
			.setName('启用 Tab 补全')
			.setDesc('启用后按 Alt 键可触发 AI 自动续写建议。再次按 Alt 或 Enter 确认，按 Esc 或其他键取消')
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enableTabCompletion ?? false).onChange(async (value) => {
					this.settings.enableTabCompletion = value
					await this.saveSettings()
				})
			)

		new Setting(tabCompletionSection)
			.setName('触发快捷键')
			.setDesc('触发 Tab 补全的快捷键')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'Alt': 'Alt 键',
						'Ctrl-Space': 'Ctrl + Space',
						'Alt-Tab': 'Alt + Tab'
					})
					.setValue(this.settings.tabCompletionTriggerKey ?? 'Alt')
					.onChange(async (value) => {
						this.settings.tabCompletionTriggerKey = value
						await this.saveSettings()
					})
			)

		new Setting(tabCompletionSection)
			.setName('Tab 补全 AI Provider')
			.setDesc('选择用于 Tab 补全的 AI 服务。留空使用第一个可用的 provider')
			.addDropdown((dropdown) => {
				const providers = this.settings.providers
				dropdown.addOption('', '自动选择（第一个可用）')
				providers.forEach((provider) => {
					dropdown.addOption(provider.tag, provider.tag)
				})
				dropdown.setValue(this.settings.tabCompletionProviderTag ?? '')
				dropdown.onChange(async (value) => {
					this.settings.tabCompletionProviderTag = value
					await this.saveSettings()
				})
			})

		new Setting(tabCompletionSection)
			.setName('上下文长度（光标前）')
			.setDesc('发送给 AI 的光标前文本长度（字符数）')
			.addSlider((slider) =>
				slider
					.setLimits(200, 3000, 100)
					.setValue(this.settings.tabCompletionContextLengthBefore ?? 1000)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.tabCompletionContextLengthBefore = value
						await this.saveSettings()
					})
			)

		new Setting(tabCompletionSection)
			.setName('上下文长度（光标后）')
			.setDesc('发送给 AI 的光标后文本长度（字符数）')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1500, 100)
					.setValue(this.settings.tabCompletionContextLengthAfter ?? 500)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.tabCompletionContextLengthAfter = value
						await this.saveSettings()
					})
			)

		new Setting(tabCompletionSection)
			.setName('请求超时时间')
			.setDesc('AI 请求的最大等待时间（秒）')
			.addSlider((slider) =>
				slider
					.setLimits(3, 30, 1)
					.setValue((this.settings.tabCompletionTimeout ?? 5000) / 1000)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.tabCompletionTimeout = value * 1000
						await this.saveSettings()
					})
			)

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
	 * 渲染快捷技能设置区域
	 */
	private renderSelectionToolbarSettings(containerEl: HTMLElement): void {
		// 快捷技能设置标题行
		const selectionToolbarHeaderSetting = new Setting(containerEl)
			.setName('快捷技能')
			.setDesc('选中文本时显示悬浮工具栏，快速执行AI技能')

		// 创建一个包装器来容纳按钮和图标
		const selectionToolbarButtonWrapper = selectionToolbarHeaderSetting.controlEl.createDiv({ cls: 'ai-provider-button-wrapper' })
		selectionToolbarButtonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: flex-end; gap: 8px;'

		// 添加技能按钮
		const addSkillButton = selectionToolbarButtonWrapper.createEl('button', { cls: 'mod-cta' })
		addSkillButton.textContent = '+ 添加技能'
		addSkillButton.style.cssText = 'font-size: var(--font-ui-smaller); padding: 4px 12px;'
		addSkillButton.onclick = async () => {
			await this.openSkillEditModal()
		}

		// 添加Chevron图标
		const selectionToolbarChevronIcon = selectionToolbarButtonWrapper.createEl('div', { cls: 'ai-provider-chevron' })
		selectionToolbarChevronIcon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`
		selectionToolbarChevronIcon.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			cursor: pointer;
			transition: transform 0.2s ease;
			transform: ${this.isSelectionToolbarCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
			width: 16px;
			height: 16px;
		`

		// 扩大整行的点击区域
		const selectionToolbarHeaderEl = selectionToolbarHeaderSetting.settingEl
		selectionToolbarHeaderEl.style.cursor = 'pointer'
		selectionToolbarHeaderEl.style.borderRadius = '0px'
		selectionToolbarHeaderEl.style.border = '1px solid var(--background-modifier-border)'
		selectionToolbarHeaderEl.style.marginBottom = '0px'
		selectionToolbarHeaderEl.style.padding = '12px 12px'

		// 创建划词设置容器
		const selectionToolbarSection = containerEl.createDiv({ cls: 'selection-toolbar-settings-container' })
		selectionToolbarSection.style.padding = '0 8px 8px 8px'
		selectionToolbarSection.style.backgroundColor = 'var(--background-secondary)'
		selectionToolbarSection.style.borderRadius = '0px'
		selectionToolbarSection.style.border = '1px solid var(--background-modifier-border)'
		selectionToolbarSection.style.borderTop = 'none'
		selectionToolbarSection.style.display = this.isSelectionToolbarCollapsed ? 'none' : 'block'

		// 添加折叠/展开功能
		const toggleSelectionToolbarSection = () => {
			this.isSelectionToolbarCollapsed = !this.isSelectionToolbarCollapsed
			selectionToolbarChevronIcon.style.transform = this.isSelectionToolbarCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
			selectionToolbarSection.style.display = this.isSelectionToolbarCollapsed ? 'none' : 'block'
		}

		selectionToolbarHeaderEl.addEventListener('click', (e) => {
			// 避免点击按钮时触发折叠
			if ((e.target as HTMLElement).closest('button')) {
				return
			}
			if ((e.target as HTMLElement).closest('.ai-provider-chevron')) {
				return
			}
			toggleSelectionToolbarSection()
		})

		selectionToolbarChevronIcon.addEventListener('click', (e) => {
			e.stopPropagation()
			toggleSelectionToolbarSection()
		})

		// 启用快捷技能开关
		new Setting(selectionToolbarSection)
			.setName('启用快捷技能')
			.setDesc('关闭后，编辑器选中文本时不再显示悬浮工具栏')
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.enableSelectionToolbar ?? true)
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ enableSelectionToolbar: value })
				})
			})

		// 最多显示按钮数
		new Setting(selectionToolbarSection)
			.setName(localInstance.selection_toolbar_max_buttons)
			.setDesc(localInstance.selection_toolbar_max_buttons_desc)
			.addSlider((slider) => {
				slider
					.setLimits(2, 8, 1)
					.setValue(this.chatSettings.maxToolbarButtons ?? 4)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.updateChatSettings({ maxToolbarButtons: value })
					})
			})

		// 流式输出设置
		new Setting(selectionToolbarSection)
			.setName(localInstance.selection_toolbar_stream_output)
			.setDesc(localInstance.selection_toolbar_stream_output_desc)
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.selectionToolbarStreamOutput ?? true)
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ selectionToolbarStreamOutput: value })
				})
			})

		// 分隔线
		const separator = selectionToolbarSection.createEl('hr')
		separator.style.cssText = `
			margin: 16px 0;
			border: none;
			border-top: 1px solid var(--background-modifier-border);
		`

		// 编辑器触发符号设置
		new Setting(selectionToolbarSection)
			.setName(localInstance.chat_trigger_symbol)
			.setDesc(localInstance.chat_trigger_symbol_desc)
			.addText((text) => {
				// 兼容旧数据：确保 chatTriggerSymbol 始终是数组
				let symbolsArray = this.chatSettings.chatTriggerSymbol ?? ['@'];

				// 如果是字符串（旧数据），转换为数组
				if (typeof symbolsArray === 'string') {
					symbolsArray = [symbolsArray];
				}

				// 将数组转换为逗号分隔的字符串显示
				let currentValue = Array.isArray(symbolsArray) ? symbolsArray.join(',') : '@';

				text
					.setPlaceholder('@,/,#')
					.setValue(currentValue)
					.onChange(async (value) => {
						// 更新当前显示的值
						currentValue = value;

						// 将输入的字符串分割成数组，过滤空字符串
						const symbols = value
							.split(',')
							.map(s => s.trim())
							.filter(s => s.length > 0);

						// 如果为空数组，使用默认值 ['@']
						const symbolsToSave = symbols.length > 0 ? symbols : ['@'];

						await this.updateChatSettings({ chatTriggerSymbol: symbolsToSave });
					});
				text.inputEl.style.width = '200px';
			});

		// 启用编辑器触发
		new Setting(selectionToolbarSection)
			.setName(localInstance.chat_trigger_enable)
			.setDesc(localInstance.chat_trigger_enable_desc)
			.addToggle((toggle) => {
				toggle.setValue(this.chatSettings.enableChatTrigger ?? true);
				toggle.onChange(async (value) => {
					await this.updateChatSettings({ enableChatTrigger: value });
				});
			});

		// 技能列表管理区域
		const skillsListContainer = selectionToolbarSection.createDiv({ cls: 'skills-list-container' })
		skillsListContainer.style.cssText = `
			margin-top: 12px;
			padding: 12px;
			background: var(--background-primary);
			border-radius: 8px;
			border: 1px solid var(--background-modifier-border);
		`

		// 技能列表标题
		const skillsListHeader = skillsListContainer.createDiv({ cls: 'skills-list-header' })
		skillsListHeader.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 8px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--background-modifier-border);
			cursor: pointer;
		`

		const leftHeader = skillsListHeader.createDiv()
		leftHeader.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
		`

		const chevron = leftHeader.createDiv()
		chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>`
		chevron.style.cssText = `
			display: flex;
			align-items: center;
			transition: transform 0.2s ease;
			color: var(--text-muted);
		`

		const skillsListTitle = leftHeader.createEl('div')
		skillsListTitle.style.cssText = `
			font-size: var(--font-ui-small);
			font-weight: 500;
			color: var(--text-normal);
		`
		skillsListTitle.textContent = '技能管理'

		const skillsListHint = skillsListHeader.createEl('div')
		skillsListHint.style.cssText = `
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
		`
		skillsListHint.textContent = '前 ' + (this.chatSettings.maxToolbarButtons ?? 4) + ' 个技能将显示在工具栏上，其他的将隐藏在下拉菜单中'

		// 技能列表内容
		const skillsListContent = skillsListContainer.createDiv({ cls: 'skills-list-content' })
		skillsListContent.style.display = 'none' // 默认折叠
		void this.renderSkillsList(skillsListContent)

		// 点击切换折叠状态
		skillsListHeader.onclick = () => {
			const isCollapsed = skillsListContent.style.display === 'none'
			skillsListContent.style.display = isCollapsed ? 'block' : 'none'
			chevron.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)'
		}
	}

	/**
	 * 渲染技能列表
	 */
	private async renderSkillsList(container: HTMLElement): Promise<void> {
		container.empty()

		const skills = await this.getSkillsFromService()

		if (skills.length === 0) {
			const emptyTip = container.createEl('div', { cls: 'skills-list-empty' })
			emptyTip.style.cssText = `
				padding: 24px;
				color: var(--text-muted);
				font-size: var(--font-ui-small);
				text-align: center;
				font-style: italic;
			`
			emptyTip.textContent = '暂无技能，点击上方"添加技能"按钮创建'
			return
		}

		// 按 order 排序
		const sortedSkills = [...skills].sort((a, b) => a.order - b.order)

		sortedSkills.forEach((skill, index) => {
			const skillItem = container.createDiv({ cls: 'skill-item' })
			skillItem.dataset.skillId = skill.id
			skillItem.draggable = true
			skillItem.style.cssText = `
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 10px 12px;
				margin-bottom: 4px;
				background: var(--background-secondary);
				border-radius: 6px;
				border: 1px solid transparent;
				transition: border-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
				cursor: grab;
			`

			// 添加 hover 效果
			skillItem.addEventListener('mouseenter', () => {
				skillItem.style.borderColor = 'var(--background-modifier-border)'
			})
			skillItem.addEventListener('mouseleave', () => {
				skillItem.style.borderColor = 'transparent'
			})

			// 拖拽排序事件
			skillItem.addEventListener('dragstart', (e) => {
				skillItem.style.opacity = '0.5'
				e.dataTransfer?.setData('text/plain', skill.id)
			})

			skillItem.addEventListener('dragend', () => {
				skillItem.style.opacity = '1'
				// 移除所有拖拽指示器
				container.querySelectorAll('.skill-item').forEach(item => {
					const el = item as HTMLElement
					el.style.borderTop = ''
					el.style.borderBottom = ''
				})
			})

			skillItem.addEventListener('dragover', (e) => {
				e.preventDefault()
				skillItem.style.borderTop = '2px solid var(--interactive-accent)'
			})

			skillItem.addEventListener('dragleave', () => {
				skillItem.style.borderTop = ''
			})

			skillItem.addEventListener('drop', async (e) => {
				e.preventDefault()
				skillItem.style.borderTop = ''
				const draggedId = e.dataTransfer?.getData('text/plain')
				if (draggedId && draggedId !== skill.id) {
					await this.reorderSkills(draggedId, skill.id)
					await this.renderSkillsList(container)
				}
			})

			// 左侧：拖拽手柄和技能名称
			const leftSection = skillItem.createDiv()
			leftSection.style.cssText = `
				display: flex;
				align-items: center;
				gap: 12px;
			`

			// 拖拽手柄
			const dragHandle = leftSection.createEl('div', { cls: 'skill-drag-handle' })
			dragHandle.innerHTML = `
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
					<circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
				</svg>
			`
			dragHandle.style.cssText = `
				display: flex;
				color: var(--text-muted);
				cursor: grab;
			`
			dragHandle.title = '拖拽排序'

			// 显示在工具栏上的复选框
			const showInToolbarCheckbox = leftSection.createEl('input', { type: 'checkbox' }) as HTMLInputElement
			showInToolbarCheckbox.checked = skill.showInToolbar
			showInToolbarCheckbox.style.cssText = `
				cursor: pointer;
				accent-color: var(--interactive-accent);
			`
			showInToolbarCheckbox.title = skill.showInToolbar ? '已显示在工具栏' : '未显示在工具栏'
			showInToolbarCheckbox.onclick = (e) => e.stopPropagation()
			showInToolbarCheckbox.onchange = async () => {
				await this.updateSkillShowInToolbar(skill.id, showInToolbarCheckbox.checked)
				await this.renderSkillsList(container)
			}

			// 技能名称
			const skillName = leftSection.createEl('span')
			skillName.style.cssText = `
				font-size: var(--font-ui-small);
				color: ${skill.showInToolbar ? 'var(--interactive-accent)' : 'var(--text-normal)'};
				font-weight: ${skill.showInToolbar ? '500' : 'normal'};
			`
			skillName.textContent = skill.name

			// 右侧：操作按钮
			const rightSection = skillItem.createDiv()
			rightSection.style.cssText = `
				display: flex;
				align-items: center;
				gap: 8px;
			`

			// 编辑按钮 (使用文字而不是图标)
			const editBtn = rightSection.createEl('button')
			editBtn.style.cssText = `
				padding: 4px 8px;
				border: none;
				border-radius: 4px;
				background: transparent;
				color: var(--text-muted);
				font-size: var(--font-ui-smaller);
				cursor: pointer;
				transition: background-color 0.15s ease, color 0.15s ease;
			`
			editBtn.textContent = '编辑'
			editBtn.addEventListener('mouseenter', () => {
				editBtn.style.backgroundColor = 'var(--background-modifier-hover)'
				editBtn.style.color = 'var(--text-normal)'
			})
			editBtn.addEventListener('mouseleave', () => {
				editBtn.style.backgroundColor = 'transparent'
				editBtn.style.color = 'var(--text-muted)'
			})
			editBtn.onclick = async (e) => {
				e.stopPropagation()
				await this.openSkillEditModal(skill)
			}

			// 删除按钮
			const deleteBtn = rightSection.createEl('button')
			deleteBtn.style.cssText = `
				padding: 4px 8px;
				border: none;
				border-radius: 4px;
				background: transparent;
				color: var(--text-muted);
				font-size: var(--font-ui-smaller);
				cursor: pointer;
				transition: background-color 0.15s ease, color 0.15s ease;
			`
			deleteBtn.textContent = '删除'
			deleteBtn.title = '删除'
			deleteBtn.addEventListener('mouseenter', () => {
				deleteBtn.style.backgroundColor = 'var(--background-modifier-error)'
				deleteBtn.style.color = 'var(--text-on-accent)'
			})
			deleteBtn.addEventListener('mouseleave', () => {
				deleteBtn.style.backgroundColor = 'transparent'
				deleteBtn.style.color = 'var(--text-muted)'
			})
			deleteBtn.onclick = async (e) => {
				e.stopPropagation()
				await this.deleteSkill(skill.id)
				await this.renderSkillsList(container)
			}
		})
	}

	/**
	 * 打开技能编辑模态框
	 */
	private async openSkillEditModal(skill?: import('../chat/types/chat').Skill): Promise<void> {
		// 阻止所有事件冒泡的辅助函数
		const stopAllPropagation = (e: Event) => {
			e.stopPropagation()
		}

		// 使用原生 DOM 创建简单的模态框
		const overlay = document.createElement('div')
		overlay.className = 'skill-edit-modal-overlay'
		overlay.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.5);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 9999;
			padding: 20px;
			pointer-events: auto;
		`

		// 阻止 overlay 上的所有事件冒泡
		overlay.addEventListener('mousedown', stopAllPropagation)
		overlay.addEventListener('mouseup', stopAllPropagation)
		overlay.addEventListener('click', stopAllPropagation)
		overlay.addEventListener('focusin', stopAllPropagation)
		overlay.addEventListener('focusout', stopAllPropagation)

		const modal = document.createElement('div')
		modal.className = 'skill-edit-modal'
		modal.style.cssText = `
			display: flex;
			flex-direction: column;
			width: 100%;
			max-width: 520px;
			max-height: 90vh;
			background: var(--background-primary);
			border-radius: 12px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
			overflow: hidden;
			pointer-events: auto;
		`

		// 阻止模态框内的所有事件冒泡到 Obsidian
		modal.addEventListener('keydown', stopAllPropagation)
		modal.addEventListener('keyup', stopAllPropagation)
		modal.addEventListener('keypress', stopAllPropagation)
		modal.addEventListener('mousedown', stopAllPropagation)
		modal.addEventListener('mouseup', stopAllPropagation)
		modal.addEventListener('click', stopAllPropagation)
		modal.addEventListener('focusin', stopAllPropagation)
		modal.addEventListener('focusout', stopAllPropagation)
		modal.addEventListener('input', stopAllPropagation)

		const isEditMode = !!skill
		const allSkills = await this.getSkillsFromService()
		const existingNames = allSkills
			.filter(s => s.id !== skill?.id)
			.map(s => s.name)

		// 头部
		const header = document.createElement('div')
		header.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 20px 24px;
			border-bottom: 1px solid var(--background-modifier-border);
		`

		const title = document.createElement('span')
		title.style.cssText = `
			font-size: var(--font-ui-medium);
			font-weight: 600;
			color: var(--text-normal);
		`
		title.textContent = isEditMode ? '编辑技能' : '添加技能'

		const closeBtn = document.createElement('button')
		closeBtn.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			width: 32px;
			height: 32px;
			border: none;
			border-radius: 6px;
			background: transparent;
			color: var(--text-muted);
			cursor: pointer;
		`
		closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
		closeBtn.onclick = () => overlay.remove()

		header.appendChild(title)
		header.appendChild(closeBtn)

		// 表单内容
		const body = document.createElement('div')
		body.style.cssText = `
			flex: 1;
			overflow-y: auto;
			padding: 20px 24px;
			pointer-events: auto;
		`

		// 技能名称字段
		const nameField = document.createElement('div')
		nameField.style.cssText = 'margin-bottom: 20px; pointer-events: auto;'

		const nameLabel = document.createElement('label')
		nameLabel.style.cssText = `
			display: block;
			margin-bottom: 8px;
			font-size: var(--font-ui-small);
			font-weight: 500;
			color: var(--text-normal);
		`
		nameLabel.innerHTML = '技能名称和图标 <span style="color: var(--text-error);">*</span>'

		const nameRow = document.createElement('div')
		nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px; pointer-events: auto;'

		const nameInput = document.createElement('input')
		nameInput.type = 'text'
		nameInput.autocomplete = 'off'
		nameInput.autocapitalize = 'off'
		nameInput.spellcheck = false
		nameInput.style.cssText = `
			flex: 1;
			padding: 10px 12px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			pointer-events: auto;
			user-select: text;
		`
		nameInput.placeholder = '在这里命名你的技能...'
		nameInput.maxLength = 20
		nameInput.value = skill?.name || ''

		const nameCounter = document.createElement('span')
		nameCounter.style.cssText = `
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
			white-space: nowrap;
		`
		nameCounter.textContent = `${nameInput.value.length}/20`
		nameInput.addEventListener('input', () => {
			nameCounter.textContent = `${nameInput.value.length}/20`
		})

		const iconBtn = document.createElement('button')
		iconBtn.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			background: var(--background-primary);
			color: var(--text-muted);
			cursor: pointer;
		`
		iconBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`

		nameRow.appendChild(nameInput)
		nameRow.appendChild(nameCounter)
		nameRow.appendChild(iconBtn)

		const nameError = document.createElement('span')
		nameError.style.cssText = `
			display: none;
			margin-top: 4px;
			font-size: var(--font-ui-smaller);
			color: var(--text-error);
		`

		nameField.appendChild(nameLabel)
		nameField.appendChild(nameRow)
		nameField.appendChild(nameError)

		// AI 模型选择字段
		const modelField = document.createElement('div')
		modelField.style.cssText = 'margin-bottom: 20px; pointer-events: auto;'

		const modelLabel = document.createElement('label')
		modelLabel.style.cssText = `
			display: block;
			margin-bottom: 8px;
			font-size: var(--font-ui-small);
			font-weight: 500;
			color: var(--text-normal);
		`
		modelLabel.textContent = 'AI 模型'

		const modelHint = document.createElement('div')
		modelHint.style.cssText = `
			margin-bottom: 8px;
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
		`
		modelHint.textContent = '选择执行此技能时使用的 AI 模型，留空则使用默认模型'

		const modelSelect = document.createElement('select')
		modelSelect.style.cssText = `
			width: 100%;
			padding: 10px 12px;
			height: 42px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			cursor: pointer;
			pointer-events: auto;
		`

		// 添加默认选项
		const defaultOption = document.createElement('option')
		defaultOption.value = ''
		defaultOption.textContent = '使用默认模型'
		modelSelect.appendChild(defaultOption)

		// 添加所有可用的 AI 模型
		const providers = this.settings.providers || []
		providers.forEach(provider => {
			const option = document.createElement('option')
			option.value = provider.tag
			option.textContent = provider.tag
			if (skill?.modelTag === provider.tag) {
				option.selected = true
			}
			modelSelect.appendChild(option)
		})

		modelField.appendChild(modelLabel)
		modelField.appendChild(modelHint)
		modelField.appendChild(modelSelect)

		// 提示词来源选择字段
		const promptSourceField = document.createElement('div')
		promptSourceField.style.cssText = 'margin-bottom: 20px; pointer-events: auto;'

		const promptSourceLabel = document.createElement('label')
		promptSourceLabel.style.cssText = `
			display: block;
			margin-bottom: 8px;
			font-size: var(--font-ui-small);
			font-weight: 500;
			color: var(--text-normal);
		`
		promptSourceLabel.innerHTML = '提示词来源 <span style="color: var(--text-error);">*</span>'

		const promptSourceRow = document.createElement('div')
		promptSourceRow.style.cssText = 'display: flex; gap: 16px; margin-bottom: 12px;'

		// 自定义提示词单选按钮
		const customRadioWrapper = document.createElement('label')
		customRadioWrapper.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer;'
		const customRadio = document.createElement('input')
		customRadio.type = 'radio'
		customRadio.name = 'promptSource'
		customRadio.value = 'custom'
		customRadio.checked = (skill?.promptSource || 'custom') === 'custom'
		customRadio.style.cssText = 'cursor: pointer; accent-color: var(--interactive-accent);'
		const customLabel = document.createElement('span')
		customLabel.textContent = '自定义'
		customLabel.style.cssText = 'font-size: var(--font-ui-small); color: var(--text-normal);'
		customRadioWrapper.appendChild(customRadio)
		customRadioWrapper.appendChild(customLabel)

		// 内置模板单选按钮
		const templateRadioWrapper = document.createElement('label')
		templateRadioWrapper.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer;'
		const templateRadio = document.createElement('input')
		templateRadio.type = 'radio'
		templateRadio.name = 'promptSource'
		templateRadio.value = 'template'
		templateRadio.checked = skill?.promptSource === 'template'
		templateRadio.style.cssText = 'cursor: pointer; accent-color: var(--interactive-accent);'
		const templateLabel = document.createElement('span')
		templateLabel.textContent = '内置模板'
		templateLabel.style.cssText = 'font-size: var(--font-ui-small); color: var(--text-normal);'
		templateRadioWrapper.appendChild(templateRadio)
		templateRadioWrapper.appendChild(templateLabel)

		promptSourceRow.appendChild(customRadioWrapper)
		promptSourceRow.appendChild(templateRadioWrapper)

		promptSourceField.appendChild(promptSourceLabel)
		promptSourceField.appendChild(promptSourceRow)

		// 自定义提示词内容区域
		const customPromptSection = document.createElement('div')
		customPromptSection.style.cssText = 'pointer-events: auto;'
		customPromptSection.style.display = (skill?.promptSource || 'custom') === 'custom' ? 'block' : 'none'

		const promptHint = document.createElement('div')
		promptHint.style.cssText = `
			margin-bottom: 8px;
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
			pointer-events: auto;
		`
		promptHint.innerHTML = '使用 <code style="background: var(--background-modifier-hover); padding: 2px 4px; border-radius: 3px;">{{}}</code> 或 <code style="background: var(--background-modifier-hover); padding: 2px 4px; border-radius: 3px;">{{@描述文字}}</code> 作为占位符代表选中的文本，系统执行时会自动替换为实际选中的内容。'

		const promptTextarea = document.createElement('textarea')
		promptTextarea.spellcheck = false
		promptTextarea.style.cssText = `
			width: 100%;
			padding: 12px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			font-family: var(--font-text);
			line-height: 1.5;
			resize: vertical;
			min-height: 150px;
			box-sizing: border-box;
			pointer-events: auto;
			user-select: text;
		`
		promptTextarea.placeholder = '在此输入提示词，例如：将<user_text>{{}}</user_text>翻译成英文。'
		promptTextarea.value = skill?.promptSource === 'custom' || !skill?.promptSource ? (skill?.prompt || '') : ''

		customPromptSection.appendChild(promptHint)
		customPromptSection.appendChild(promptTextarea)

		// 内置模板选择区域
		const templateSection = document.createElement('div')
		templateSection.style.cssText = 'pointer-events: auto;'
		templateSection.style.display = skill?.promptSource === 'template' ? 'block' : 'none'

		const templateHint = document.createElement('div')
		templateHint.style.cssText = `
			margin-bottom: 8px;
			font-size: var(--font-ui-smaller);
			color: var(--text-muted);
		`
		templateHint.innerHTML = '从 AI 提示词模板目录中选择模板文件，模板中同样支持使用 <code style="background: var(--background-modifier-hover); padding: 2px 4px; border-radius: 3px;">{{}}</code> 或 <code style="background: var(--background-modifier-hover); padding: 2px 4px; border-radius: 3px;">{{@描述文字}}</code> 占位符。'

		const templateSelect = document.createElement('select')
		templateSelect.style.cssText = `
			width: 100%;
			padding: 10px 12px;
			height: 42px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			cursor: pointer;
			pointer-events: auto;
		`

		// 获取模板文件列表
		const promptTemplateFolder = this.settingsContext.getPromptTemplateFolder()
		const templateFiles = this.app.vault.getMarkdownFiles().filter(f => 
			f.path.startsWith(promptTemplateFolder + '/') || f.path.startsWith(promptTemplateFolder)
		)

		const defaultTemplateOption = document.createElement('option')
		defaultTemplateOption.value = ''
		defaultTemplateOption.textContent = '请选择模板文件...'
		templateSelect.appendChild(defaultTemplateOption)

		templateFiles.forEach(file => {
			const option = document.createElement('option')
			option.value = file.path
			// 显示相对于模板目录的路径
			const displayName = file.path.startsWith(promptTemplateFolder + '/') 
				? file.path.substring(promptTemplateFolder.length + 1) 
				: file.name
			option.textContent = displayName
			if (skill?.templateFile === file.path) {
				option.selected = true
			}
			templateSelect.appendChild(option)
		})

		templateSection.appendChild(templateHint)
		templateSection.appendChild(templateSelect)

		// 提示词错误提示
		const promptError = document.createElement('span')
		promptError.style.cssText = `
			display: none;
			margin-top: 4px;
			font-size: var(--font-ui-smaller);
			color: var(--text-error);
		`

		promptSourceField.appendChild(customPromptSection)
		promptSourceField.appendChild(templateSection)
		promptSourceField.appendChild(promptError)

		// 切换提示词来源时更新显示
		const updatePromptSourceDisplay = () => {
			const isCustom = customRadio.checked
			customPromptSection.style.display = isCustom ? 'block' : 'none'
			templateSection.style.display = isCustom ? 'none' : 'block'
		}

		customRadio.addEventListener('change', updatePromptSourceDisplay)
		templateRadio.addEventListener('change', updatePromptSourceDisplay)

		body.appendChild(nameField)
		body.appendChild(modelField)
		body.appendChild(promptSourceField)

		// 底部操作栏
		const footer = document.createElement('div')
		footer.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 12px;
			padding: 16px 24px;
			border-top: 1px solid var(--background-modifier-border);
		`

		const cancelBtn = document.createElement('button')
		cancelBtn.style.cssText = `
			padding: 10px 20px;
			border: none;
			border-radius: 8px;
			background: var(--background-modifier-hover);
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			font-weight: 500;
			cursor: pointer;
		`
		cancelBtn.textContent = '取消'
		cancelBtn.onclick = () => overlay.remove()

		const saveBtn = document.createElement('button')
		saveBtn.style.cssText = `
			padding: 10px 20px;
			border: none;
			border-radius: 8px;
			background: var(--interactive-accent);
			color: var(--text-on-accent);
			font-size: var(--font-ui-small);
			font-weight: 500;
			cursor: pointer;
		`
		saveBtn.textContent = '保存'
		saveBtn.onclick = async () => {
			// 验证
			let hasError = false
			
			if (!nameInput.value.trim()) {
				nameError.textContent = '技能名称不能为空'
				nameError.style.display = 'block'
				nameInput.style.borderColor = 'var(--text-error)'
				hasError = true
			} else if (existingNames.includes(nameInput.value.trim())) {
				nameError.textContent = '技能名称已存在'
				nameError.style.display = 'block'
				nameInput.style.borderColor = 'var(--text-error)'
				hasError = true
			} else {
				nameError.style.display = 'none'
				nameInput.style.borderColor = 'var(--background-modifier-border)'
			}

			// 根据提示词来源验证
			const isCustomPrompt = customRadio.checked
			if (isCustomPrompt) {
				if (!promptTextarea.value.trim()) {
					promptError.textContent = '提示词内容不能为空'
					promptError.style.display = 'block'
					promptTextarea.style.borderColor = 'var(--text-error)'
					hasError = true
				} else {
					promptError.style.display = 'none'
					promptTextarea.style.borderColor = 'var(--background-modifier-border)'
				}
			} else {
				if (!templateSelect.value) {
					promptError.textContent = '请选择一个模板文件'
					promptError.style.display = 'block'
					templateSelect.style.borderColor = 'var(--text-error)'
					hasError = true
				} else {
					promptError.style.display = 'none'
					templateSelect.style.borderColor = 'var(--background-modifier-border)'
				}
			}

			if (hasError) return

			// 保存技能
			const now = Date.now()
			const savedSkill: import('../chat/types/chat').Skill = {
				id: skill?.id || crypto.randomUUID(),
				name: nameInput.value.trim(),
				prompt: isCustomPrompt ? promptTextarea.value.trim() : '',
				promptSource: isCustomPrompt ? 'custom' : 'template',
				templateFile: isCustomPrompt ? undefined : templateSelect.value,
				modelTag: modelSelect.value || undefined,
				showInToolbar: skill?.showInToolbar ?? true,
				order: skill?.order ?? allSkills.length,
				createdAt: skill?.createdAt || now,
				updatedAt: now
			}

			await this.saveSkill(savedSkill)
			overlay.remove()

			// 只重新渲染技能列表部分，而不是整个设置页面
			// 找到技能列表容器并重新渲染
			const skillsListContainer = this.containerEl.querySelector('.skills-list-content') as HTMLElement
			if (skillsListContainer) {
				await this.renderSkillsList(skillsListContainer)
			}
		}

		footer.appendChild(cancelBtn)
		footer.appendChild(saveBtn)

		modal.appendChild(header)
		modal.appendChild(body)
		modal.appendChild(footer)

		overlay.appendChild(modal)

		// 点击遮罩关闭 - 使用 mousedown 而不是 click，在事件冒泡被阻止前处理
		overlay.onmousedown = (e) => {
			if (e.target === overlay) {
				overlay.remove()
			}
		}

		document.body.appendChild(overlay)

		// 延迟聚焦，确保DOM完全渲染
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				nameInput.focus()
			})
		})
	}

	/**
	 * 获取技能列表（从 SkillDataService）
	 */
	private async getSkillsFromService(): Promise<import('../chat/types/chat').Skill[]> {
		const skillDataService = SkillDataService.getInstance(this.app)
		await skillDataService.initialize()
		return await skillDataService.getSortedSkills()
	}

	/**
	 * 保存技能
	 */
	private async saveSkill(skill: import('../chat/types/chat').Skill): Promise<void> {
		DebugLogger.debug('[TarsSettingTab] 开始保存技能:', skill.name, 'ID:', skill.id)

		const skillDataService = SkillDataService.getInstance(this.app)
		await skillDataService.initialize()

		const existingSkills = await skillDataService.getSkills()
		const existingIndex = existingSkills.findIndex(s => s.id === skill.id)

		DebugLogger.debug('[TarsSettingTab] 当前技能数量:', existingSkills.length, '是否为更新:', existingIndex >= 0)

		await skillDataService.saveSkill(skill)

		// 刷新 ChatFeatureManager 中的技能缓存
		await this.settingsContext.refreshSkillsCache?.()

		// 验证保存是否成功
		const savedSkills = await skillDataService.getSkills()
		DebugLogger.debug('[TarsSettingTab] 保存后技能数量:', savedSkills.length)

		new Notice(existingIndex >= 0 ? '技能已更新' : '技能已创建')
	}

	/**
	 * 删除技能
	 */
	private async deleteSkill(skillId: string): Promise<void> {
		const skillDataService = SkillDataService.getInstance(this.app)
		await skillDataService.initialize()

		await skillDataService.deleteSkill(skillId)

		// 刷新 ChatFeatureManager 中的技能缓存
		await this.settingsContext.refreshSkillsCache?.()

		new Notice('技能已删除')
	}

	/**
	 * 更新技能显示在工具栏状态
	 */
	private async updateSkillShowInToolbar(skillId: string, showInToolbar: boolean): Promise<void> {
		const skillDataService = SkillDataService.getInstance(this.app)
		await skillDataService.initialize()

		await skillDataService.updateSkillShowInToolbar(skillId, showInToolbar)

		// 刷新 ChatFeatureManager 中的技能缓存
		await this.settingsContext.refreshSkillsCache?.()
	}

	/**
	 * 重新排序技能
	 */
	private async reorderSkills(draggedId: string, targetId: string): Promise<void> {
		const skillDataService = SkillDataService.getInstance(this.app)
		await skillDataService.initialize()

		const skills = await skillDataService.getSkills()
		const sortedSkills = skills.sort((a, b) => a.order - b.order)

		const draggedIndex = sortedSkills.findIndex(s => s.id === draggedId)
		const targetIndex = sortedSkills.findIndex(s => s.id === targetId)

		if (draggedIndex === -1 || targetIndex === -1) return

		// 移动技能
		const [draggedSkill] = sortedSkills.splice(draggedIndex, 1)
		sortedSkills.splice(targetIndex, 0, draggedSkill)

		// 更新所有技能的 order
		const orderedIds = sortedSkills.map((s, index) => {
			s.order = index
			s.updatedAt = Date.now()
			return s.id
		})

		await skillDataService.updateSkillsOrder(orderedIds)

		// 刷新 ChatFeatureManager 中的技能缓存
		await this.settingsContext.refreshSkillsCache?.()
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
