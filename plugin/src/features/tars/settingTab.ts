import { App, Notice, requestUrl, Setting } from 'obsidian'
import { t } from './lang/helper'
import { SelectModelModal, SelectVendorModal } from './modal'
import { BaseOptions, Message, Optional, ProviderSettings, ResolveEmbedAsBinary, Vendor } from './providers'
import { ClaudeOptions, claudeVendor } from './providers/claude'
import { DoubaoImageOptions, doubaoImageVendor, DOUBAO_IMAGE_SIZE_PRESETS } from './providers/doubaoImage'
import { GptImageOptions, gptImageVendor } from './providers/gptImage'
import { grokVendor } from './providers/grok'
import { kimiVendor } from './providers/kimi'
import { ollamaVendor } from './providers/ollama'
import { openRouterVendor } from './providers/openRouter'
import { siliconFlowVendor } from './providers/siliconflow'
import { getCapabilityEmoji } from './providers/utils'
import { availableVendors, DEFAULT_TARS_SETTINGS } from './settings'
import type { TarsSettings } from './settings'

export interface TarsSettingsContext {
	getSettings: () => TarsSettings
	getEnabled: () => boolean
	setEnabled: (value: boolean) => Promise<void>
	saveSettings: () => Promise<void>
}

export class TarsSettingTab {
	private containerEl!: HTMLElement

	constructor(private readonly app: App, private readonly context: TarsSettingsContext) {}

	private get settings() {
		return this.context.getSettings()
	}

	private async saveSettings() {
		await this.context.saveSettings()
	}

	render(containerEl: HTMLElement, expandLastProvider = false): void {
		this.containerEl = containerEl
		containerEl.empty()

		const enabled = this.context.getEnabled()
		new Setting(containerEl)
			.setName(t('Enable Tars feature'))
			.addToggle((toggle) =>
				toggle.setValue(enabled).onChange(async (value) => {
					await this.context.setEnabled(value)
					this.render(containerEl, expandLastProvider)
				})
			)

		if (!enabled) {
			containerEl.createEl('p', { text: t('Tars feature disabled description') })
			return
		}

		new Setting(containerEl).setName(t('AI assistants')).setHeading()

		new Setting(containerEl)
			.setName(t('New AI assistant'))
			.setDesc(t('For those compatible with the OpenAI protocol, you can select OpenAI.'))
			.addButton((btn) => {
				btn.setButtonText(t('Add AI Provider')).onClick(async () => {
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
						this.render(this.containerEl, true)
					}
					new SelectVendorModal(this.app, availableVendors, onChoose).open()
				})
			})

		if (!this.settings.providers.length) {
			new Setting(containerEl).setDesc(t('Please add at least one AI assistant to start using the plugin.'))
		}

		for (const [index, provider] of this.settings.providers.entries()) {
			const isLast = index === this.settings.providers.length - 1
			this.createProviderSetting(index, provider, isLast && expandLastProvider)
		}

		containerEl.createEl('br')
		new Setting(containerEl)
			.setName(t('Message tags'))
			.setDesc(t('Keywords for tags in the text box are separated by spaces'))
			.setHeading()

		let newChatTagsInput: HTMLInputElement | null = null
		new Setting(containerEl)
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
		new Setting(containerEl)
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
		new Setting(containerEl)
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

		containerEl.createEl('br')

		new Setting(containerEl).setName(t('System message')).setHeading()
		let defaultSystemMsgInput: HTMLTextAreaElement | null = null
		new Setting(containerEl)
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

		new Setting(containerEl).setName(t('Default system message')).addTextArea((textArea) => {
			defaultSystemMsgInput = textArea.inputEl
			textArea
				.setDisabled(!this.settings.enableDefaultSystemMsg)
				.setValue(this.settings.defaultSystemMsg)
				.onChange(async (value) => {
					this.settings.defaultSystemMsg = value.trim()
					await this.saveSettings()
				})
		})

		containerEl.createEl('br')

		new Setting(containerEl)
			.setName(t('Confirm before regeneration'))
			.setDesc(t('Confirm before replacing existing assistant responses when using assistant commands'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.confirmRegenerate).onChange(async (value) => {
					this.settings.confirmRegenerate = value
					await this.saveSettings()
				})
			)

		new Setting(containerEl)
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

		containerEl.createEl('br')

		const advancedSection = containerEl.createEl('details')
		advancedSection.createEl('summary', { text: t('Advanced'), cls: 'tars-setting-h4' })

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
	}

	createProviderSetting = (index: number, settings: ProviderSettings, isOpen: boolean = false) => {
		const vendor = availableVendors.find((v) => v.name === settings.vendor)
		if (!vendor) throw new Error('No vendor found ' + settings.vendor)
		const { containerEl } = this
		const details = containerEl.createEl('details')
		details.createEl('summary', { text: getSummary(settings.tag, vendor.name), cls: 'tars-setting-h4' })
		details.open = isOpen

		const capabilities =
			t('Supported features') +
			' : ' +
			vendor.capabilities.map((cap) => `${getCapabilityEmoji(cap)} ${t(cap)}`).join('    ')

		this.addTagSection(details, settings, index, vendor.name)

		// model setting
		const modelConfig = MODEL_FETCH_CONFIGS[vendor.name as keyof typeof MODEL_FETCH_CONFIGS]
		if (modelConfig) {
			new Setting(details)
				.setName(t('Model'))
				.setDesc(capabilities)
				.addButton((btn) => {
					btn
						.setButtonText(settings.options.model ? settings.options.model : t('Select the model to use'))
						.onClick(async () => {
							// Check if API key is required but not provided
							if (modelConfig.requiresApiKey && !settings.options.apiKey) {
								new Notice(t('Please input API key first'))
								return
							}
							try {
								const models = await fetchModels(
									modelConfig.url,
									modelConfig.requiresApiKey ? settings.options.apiKey : undefined
								)
								const onChoose = async (selectedModel: string) => {
									settings.options.model = selectedModel
									await this.saveSettings()
									btn.setButtonText(selectedModel)
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
		} else if (vendor.models.length > 0) {
			this.addModelDropDownSection(details, settings.options, vendor.models, capabilities)
		} else {
			this.addModelTextSection(details, settings.options, capabilities)
		}

		if (vendor.name !== ollamaVendor.name) {
			this.addAPIkeySection(
				details,
				settings.options,
				vendor.websiteToObtainKey ? t('Obtain key from ') + vendor.websiteToObtainKey : ''
			)
		}

		if ('apiSecret' in settings.options)
			this.addAPISecretOptional(details, settings.options as BaseOptions & Pick<Optional, 'apiSecret'>)

		if (vendor.capabilities.includes('Web Search')) {
			new Setting(details)
				.setName(t('Web search'))
				.setDesc(t('Enable web search for AI'))
				.addToggle((toggle) =>
					toggle.setValue(settings.options.enableWebSearch ?? false).onChange(async (value) => {
						settings.options.enableWebSearch = value
						await this.saveSettings()
					})
				)
		}

		if (vendor.name === claudeVendor.name) {
			this.addClaudeSections(details, settings.options as ClaudeOptions)
		}

		if (vendor.name === gptImageVendor.name) {
			this.addGptImageSections(details, settings.options as GptImageOptions)
		}

		if (vendor.name === doubaoImageVendor.name) {
			this.addDoubaoImageSections(details, settings.options as DoubaoImageOptions)
		}

		this.addBaseURLSection(details, settings.options, vendor.defaultOptions.baseURL)

		if ('endpoint' in settings.options)
			this.addEndpointOptional(details, settings.options as BaseOptions & Pick<Optional, 'endpoint'>)

		if ('apiVersion' in settings.options)
			this.addApiVersionOptional(details, settings.options as BaseOptions & Pick<Optional, 'apiVersion'>)

		this.addParametersSection(details, settings.options)

		const testButtonLabel = t('Test now')
		new Setting(details)
			.setName(t('Test model'))
			.setDesc(t('Test model description'))
			.addButton((btn) => {
				btn
					.setButtonText(testButtonLabel)
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

		new Setting(details).setName(t('Remove') + ' ' + vendor.name).addButton((btn) => {
			btn
				.setWarning()
				.setButtonText(t('Remove'))
				.onClick(async () => {
					this.settings.providers.splice(index, 1)
					await this.saveSettings()
					this.render(this.containerEl)
				})
		})
	}

	addTagSection = (details: HTMLDetailsElement, settings: ProviderSettings, index: number, defaultTag: string) =>
		new Setting(details)
			.setName('✨ ' + t('Assistant message tag'))
			.setDesc(t('Tag used to trigger AI text generation'))
			.addText((text) =>
				text
					.setPlaceholder(defaultTag)
					.setValue(settings.tag)
					.onChange(async (value) => {
						const trimmed = value.trim()
						// console.debug('trimmed', trimmed)
						if (trimmed.length === 0) return
						if (!validateTag(trimmed)) return
						const otherTags = this.settings.providers
							.filter((e, i) => i !== index)
							.map((e) => e.tag.toLowerCase())
						if (otherTags.includes(trimmed.toLowerCase())) {
							new Notice(t('Keyword for tag must be unique'))
							return
						}

						settings.tag = trimmed
						const summaryElement = details.querySelector('summary')
						if (summaryElement != null) summaryElement.textContent = getSummary(settings.tag, defaultTag) // 更新summary
						await this.saveSettings()
					})
			)

	addBaseURLSection = (details: HTMLDetailsElement, options: BaseOptions, defaultValue: string) => {
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

	addAPIkeySection = (details: HTMLDetailsElement, options: BaseOptions, desc: string = '') => {
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
		details: HTMLDetailsElement,
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

	addModelDropDownSection = (details: HTMLDetailsElement, options: BaseOptions, models: string[], desc: string) =>
		new Setting(details)
			.setName(t('Model'))
			.setDesc(desc)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(
						models.reduce((acc: Record<string, string>, cur: string) => {
							acc[cur] = cur
							return acc
						}, {})
					)
					.setValue(options.model)
					.onChange(async (value) => {
						options.model = value
						await this.saveSettings()
					})
			)

	addModelTextSection = (details: HTMLDetailsElement, options: BaseOptions, desc: string) =>
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

	addClaudeSections = (details: HTMLDetailsElement, options: ClaudeOptions) => {
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

	addEndpointOptional = (details: HTMLDetailsElement, options: BaseOptions & Pick<Optional, 'endpoint'>) =>
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

	addApiVersionOptional = (details: HTMLDetailsElement, options: BaseOptions & Pick<Optional, 'apiVersion'>) =>
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

	addParametersSection = (details: HTMLDetailsElement, options: BaseOptions) =>
		new Setting(details)
			.setName(t('Override input parameters'))
			.setDesc(
				t(
					'Developer feature, in JSON format. For example, if the model list doesn\'t have the model you want, enter {"model": "your desired model"}'
				)
			)
			.addTextArea((text) =>
				text
					.setPlaceholder('{}')
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
							options.parameters = JSON.parse(trimmed)
							await this.saveSettings()
						} catch {
							// This is difficult to handle properly - onChange triggers quickly, and users might receive frequent error messages before they finish typing, which is annoying
							return
						}
					})
			)

	addGptImageSections = (details: HTMLDetailsElement, options: GptImageOptions) => {
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

	addDoubaoImageSections = (details: HTMLDetailsElement, options: DoubaoImageOptions) => {
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
		
		// 输入图片URL（支持图文生图和多图融合）
		new Setting(details)
			.setName('输入图片 URL')
			.setDesc('可选：输入一个或多个图片 URL（每行一个），支持图文生图、多图融合等功能')
			.addTextArea((text) => {
				text
					.setPlaceholder('https://example.com/image1.jpg\nhttps://example.com/image2.jpg')
					.setValue((options.inputImages || []).join('\n'))
					.onChange(async (value) => {
						// 将文本按行分割并过滤空行
						options.inputImages = value
							.split('\n')
							.map(url => url.trim())
							.filter(url => url.length > 0)
						await this.saveSettings()
					})
				text.inputEl.rows = 4
				text.inputEl.style.width = '100%'
				return text
			})
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
				console.debug(`[Test Mode] Would save file: ${filename}, size: ${data.byteLength} bytes`)
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

