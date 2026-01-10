import { Extension } from '@codemirror/state'
import { Notice, Plugin } from 'obsidian'
import { RequestController } from './editor'
import { t } from './lang/helper'
import { ProviderSettings } from './providers'
import { TarsSettings } from './settings'
import { StatusBarManager } from './statusBarManager'
import {
	createTabCompletionExtension,
	updateTabCompletionSettings,
	updateTabCompletionProviders,
	disposeTabCompletionService,
	TabCompletionSettings
} from './tab-completion'

export class TarsFeatureManager {
	private statusBarManager: StatusBarManager | null = null
	private aborterInstance: AbortController | null = null
	private registeredCommandIds: Set<string> = new Set()
	private tabCompletionExtensions: Extension[] = []
	private tabCompletionRegistered: boolean = false

	constructor(
		private readonly plugin: Plugin,
		private settings: TarsSettings
	) {}

	initialize() {
		this.settings.editorStatus = this.settings.editorStatus ?? { isTextInserting: false }
		const statusBarItem = this.plugin.addStatusBarItem()
		this.statusBarManager = new StatusBarManager(this.plugin.app, statusBarItem)

		this.syncTabCompletion()

		this.registerCommand('cancelGeneration', {
			id: 'cancelGeneration',
			name: t('Cancel generation'),
			callback: async () => {
				this.settings.editorStatus.isTextInserting = false

				if (this.aborterInstance === null) {
					new Notice(t('No active generation to cancel'))
					return
				}
				if (this.aborterInstance.signal.aborted) {
					new Notice(t('Generation already cancelled'))
					return
				}

				this.aborterInstance.abort()
			}
		})
	}

	dispose() {
		this.registeredCommandIds.forEach((id) => this.plugin.removeCommand(id))
		this.registeredCommandIds.clear()

		this.disposeTabCompletion()

		this.statusBarManager?.dispose()
		this.statusBarManager = null
		this.aborterInstance = null
	}

	updateSettings(settings: TarsSettings) {
		console.debug('[Tars] 更新设置，检查 provider 变化')
		
		// 检测 provider 是否有实质性变化（API key、baseURL、model 等）
		const hasProviderChanges = this.hasProviderConfigChanges(this.settings.providers, settings.providers)
		
		// 检测 Tab 补全设置是否有变化
		const hasTabCompletionChanges = this.hasTabCompletionChanges(this.settings, settings)
		
		this.settings = settings
		
		// 如果 provider 配置有变化，需要更新 Tab 补全的 providers
		if (hasProviderChanges) {
			console.debug('[Tars] 检测到 provider 配置变化，更新 Tab 补全')
			updateTabCompletionProviders(settings.providers)
		}
		
		// 处理 Tab 补全设置变化
		if (hasTabCompletionChanges) {
			this.syncTabCompletion()
		} else {
			// 只更新设置，不重新注册扩展
			updateTabCompletionSettings(this.getTabCompletionSettings())
		}
	}

	/**
	 * 检测 provider 配置是否有实质性变化
	 */
	private hasProviderConfigChanges(oldProviders: ProviderSettings[], newProviders: ProviderSettings[]): boolean {
		if (oldProviders.length !== newProviders.length) {
			return true
		}

		for (let i = 0; i < oldProviders.length; i++) {
			const oldProvider = oldProviders[i]
			const newProvider = newProviders[i]

			// 检查关键配置是否变化
			if (
				oldProvider.tag !== newProvider.tag ||
				oldProvider.vendor !== newProvider.vendor ||
				oldProvider.options.apiKey !== newProvider.options.apiKey ||
				oldProvider.options.baseURL !== newProvider.options.baseURL ||
				oldProvider.options.model !== newProvider.options.model ||
				JSON.stringify(oldProvider.options.parameters) !== JSON.stringify(newProvider.options.parameters)
			) {
				console.debug(
					`[Tars] Provider ${oldProvider.tag} 配置变化:`,
					{
						apiKey: oldProvider.options.apiKey !== newProvider.options.apiKey,
						baseURL: oldProvider.options.baseURL !== newProvider.options.baseURL,
						model: oldProvider.options.model !== newProvider.options.model,
						parameters: JSON.stringify(oldProvider.options.parameters) !== JSON.stringify(newProvider.options.parameters)
					}
				)
				return true
			}
		}

		return false
	}

	private registerCommand(
		id: string,
		command: Parameters<Plugin['addCommand']>[0],
		track: boolean = true
	) {
		this.plugin.addCommand(command)
		if (track) {
			this.registeredCommandIds.add(id)
		}
	}

	/**
	 * 完全重建所有命令，确保使用最新的配置
	 */
	private rebuildAllCommands() {
		// 移除所有现有的 tag 命令
		this.tagCmdIds.forEach((cmdId) => {
			this.plugin.removeCommand(cmdId)
		})
		this.tagCmdIds = []
		this.tagLowerCaseMap.clear()

		// 重新构建命令（suppressNotifications = true 避免重复通知）
		this.buildTagCommands(true)

		console.debug('[Tars] 所有命令已重建完成')
	}

	private registerCommand(
		id: string,
		command: Parameters<Plugin['addCommand']>[0],
		track: boolean = true
	) {
		this.plugin.addCommand(command)
		if (track) {
			this.registeredCommandIds.add(id)
		}
	}

	private addTagCommand(cmdId: string) {
		const tagCmdMeta = getMeta(cmdId)
		switch (tagCmdMeta.role) {
			case 'newChat':
				this.registerCommand(cmdId, newChatTagCmd(tagCmdMeta), false)
				break
			case 'system':
				this.registerCommand(cmdId, systemTagCmd(tagCmdMeta, this.plugin.app, this.settings), false)
				break
			case 'user':
				this.registerCommand(cmdId, userTagCmd(tagCmdMeta, this.plugin.app, this.settings), false)
				break
			case 'assistant':
				this.registerCommand(
					cmdId,
					asstTagCmd(
						tagCmdMeta,
						this.plugin.app,
						this.settings,
						this.statusBarManager!,
						this.getRequestController()
					),
					false
				)
				break
			default:
				throw new Error('Unknown tag role')
		}
	}

	private buildTagCommands(suppressNotifications: boolean = false) {
		this.settings.tagSuggestMaxLineLength = getMaxTriggerLineLength(this.settings)

		const newTagCmdIds = getTagCmdIdsFromSettings(this.settings)

		const toRemove = this.tagCmdIds.filter((cmdId) => !newTagCmdIds.includes(cmdId))
		toRemove.forEach((cmdId) => {
			this.plugin.removeCommand(cmdId)
			const { tag } = getMeta(cmdId)
			this.tagLowerCaseMap.delete(tag.toLowerCase())
		})

		const toAdd = newTagCmdIds.filter((cmdId) => !this.tagCmdIds.includes(cmdId))
		toAdd.forEach((cmdId) => {
			this.addTagCommand(cmdId)
			const { role, tag } = getMeta(cmdId)
			this.tagLowerCaseMap.set(tag.toLowerCase(), { role, tag })
		})

		this.tagCmdIds = newTagCmdIds
		if (suppressNotifications) return

		const removedTags = toRemove.map((cmdId) => getMeta(cmdId).tag)
		if (removedTags.length > 0) {
			console.debug('Removed commands', removedTags)
		}
		const addedTags = toAdd.map((cmdId) => getMeta(cmdId).tag)
		if (addedTags.length > 0) {
			console.debug('Added commands', addedTags)
		}
	}

	private syncEditorSuggest() {
		if (!this.settings.enableTagSuggest) {
			this.disposeEditorSuggest()
			return
		}

		if (this.tagEditorSuggest) {
			this.tagEditorSuggest.settings = this.settings
			this.tagEditorSuggest.setActive(true)
			return
		}

		if (!this.statusBarManager) return

		this.tagEditorSuggest = new TagEditorSuggest(
			this.plugin.app,
			this.settings,
			this.tagLowerCaseMap,
			this.statusBarManager,
			this.getRequestController()
		)
		this.tagEditorSuggest.setActive(true)
		this.plugin.registerEditorSuggest(this.tagEditorSuggest)
	}

	private disposeEditorSuggest(clearRef: boolean = false) {
		if (!this.tagEditorSuggest) return
		this.tagEditorSuggest.setActive(false)
		if (clearRef) {
			this.tagEditorSuggest = null
		}
	}

	private getRequestController(): RequestController {
		return {
			getController: () => {
				if (!this.aborterInstance) {
					this.aborterInstance = new AbortController()
				}
				return this.aborterInstance
			},
			cleanup: () => {
				this.settings.editorStatus.isTextInserting = false
				this.aborterInstance = null
			}
		}
	}

	/**
	 * 从 TarsSettings 提取 Tab 补全设置
	 */
	private getTabCompletionSettings(): TabCompletionSettings {
		return {
			enabled: this.settings.enableTabCompletion ?? false,
			triggerKey: this.settings.tabCompletionTriggerKey ?? 'Alt',
			contextLengthBefore: this.settings.tabCompletionContextLengthBefore ?? 1000,
			contextLengthAfter: this.settings.tabCompletionContextLengthAfter ?? 500,
			timeout: this.settings.tabCompletionTimeout ?? 5000,
			providerTag: this.settings.tabCompletionProviderTag ?? '',
			promptTemplate: this.settings.tabCompletionPromptTemplate ?? '{{rules}}\n\n{{context}}'
		}
	}

	/**
	 * 检测 Tab 补全设置是否有实质性变化
	 */
	private hasTabCompletionChanges(oldSettings: TarsSettings, newSettings: TarsSettings): boolean {
		return (
			oldSettings.enableTabCompletion !== newSettings.enableTabCompletion ||
			oldSettings.tabCompletionTriggerKey !== newSettings.tabCompletionTriggerKey
		)
	}

	/**
	 * 同步 Tab 补全功能
	 */
	private syncTabCompletion(): void {
		const tabCompletionSettings = this.getTabCompletionSettings()

		if (!tabCompletionSettings.enabled) {
			// 功能被禁用，移除扩展
			this.disposeTabCompletion()
			console.debug('[Tars] Tab 补全功能已禁用')
			return
		}

		// 如果已经注册，需要先移除（因为快捷键可能变化）
		if (this.tabCompletionRegistered) {
			this.disposeTabCompletion()
		}

		// 创建并注册新的扩展
		this.tabCompletionExtensions = createTabCompletionExtension(
			this.plugin.app,
			this.settings.providers,
			tabCompletionSettings
		)

		// 注册到 Obsidian
		this.plugin.registerEditorExtension(this.tabCompletionExtensions)
		this.tabCompletionRegistered = true

		console.debug('[Tars] Tab 补全功能已启用', {
			triggerKey: tabCompletionSettings.triggerKey,
			providerTag: tabCompletionSettings.providerTag || '(使用第一个可用)'
		})
	}

	/**
	 * 销毁 Tab 补全功能
	 */
	private disposeTabCompletion(): void {
		if (this.tabCompletionRegistered) {
			disposeTabCompletionService()
			// 注意：Obsidian 的 registerEditorExtension 没有提供取消注册的方法
			// 扩展会在插件卸载时自动清理
			// 但我们可以通过清空扩展数组来标记状态
			this.tabCompletionExtensions = []
			this.tabCompletionRegistered = false
		}
	}
}
