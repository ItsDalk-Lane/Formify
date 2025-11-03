import { Notice, Plugin } from 'obsidian'
import {
	asstTagCmd,
	exportCmd,
	exportCmdId,
	getMeta,
	getTagCmdIdsFromSettings,
	newChatTagCmd,
	replaceCmd,
	replaceCmdId,
	selectMsgAtCursorCmd,
	systemTagCmd,
	userTagCmd
} from './commands'
import { RequestController } from './editor'
import { t } from './lang/helper'
import { ProviderSettings } from './providers'
import { TarsSettings } from './settings'
import { StatusBarManager } from './statusBarManager'
import { getMaxTriggerLineLength, TagEditorSuggest, TagEntry } from './suggest'

export class TarsFeatureManager {
	private statusBarManager: StatusBarManager | null = null
	private readonly tagLowerCaseMap: Map<string, Omit<TagEntry, 'replacement'>> = new Map()
	private aborterInstance: AbortController | null = null
	private tagCmdIds: string[] = []
	private registeredCommandIds: Set<string> = new Set()
	private tagEditorSuggest: TagEditorSuggest | null = null

	constructor(
		private readonly plugin: Plugin,
		private settings: TarsSettings
	) {}

	initialize() {
		this.settings.editorStatus = this.settings.editorStatus ?? { isTextInserting: false }
		const statusBarItem = this.plugin.addStatusBarItem()
		this.statusBarManager = new StatusBarManager(this.plugin.app, statusBarItem)

		this.buildTagCommands(true)

		const selectCommand = selectMsgAtCursorCmd(this.plugin.app, this.settings)
		this.registerCommand(selectCommand.id, selectCommand)

		this.syncEditorSuggest()

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

		this.syncOptionalCommands()
	}

	dispose() {
		this.registeredCommandIds.forEach((id) => this.plugin.removeCommand(id))
		this.registeredCommandIds.clear()

		this.tagCmdIds.forEach((id) => this.plugin.removeCommand(id))
		this.tagCmdIds = []
		this.tagLowerCaseMap.clear()

		this.disposeEditorSuggest(true)

		this.statusBarManager?.dispose()
		this.statusBarManager = null
		this.aborterInstance = null
	}

	updateSettings(settings: TarsSettings) {
		console.debug('[Tars] 更新设置，检查 provider 变化')
		
		// 检测 provider 是否有实质性变化（API key、baseURL、model 等）
		const hasProviderChanges = this.hasProviderConfigChanges(this.settings.providers, settings.providers)
		
		this.settings = settings
		
		// 如果 provider 配置有变化，需要完全重建命令以确保使用新的 API 密钥
		if (hasProviderChanges) {
			console.debug('[Tars] 检测到 provider 配置变化，重建所有命令')
			this.rebuildAllCommands()
		} else {
			// 否则只进行增量更新
			console.debug('[Tars] 未检测到 provider 配置变化，执行增量更新')
			this.buildTagCommands()
		}
		
		this.syncOptionalCommands()
		this.syncEditorSuggest()
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

	private syncOptionalCommands() {
		if (this.settings.enableReplaceTag) {
			if (!this.registeredCommandIds.has(replaceCmdId)) {
				const command = replaceCmd(this.plugin.app)
				this.registerCommand(command.id, command)
			}
		} else if (this.registeredCommandIds.has(replaceCmdId)) {
			this.plugin.removeCommand(replaceCmdId)
			this.registeredCommandIds.delete(replaceCmdId)
		}

		if (this.settings.enableExportToJSONL) {
			if (!this.registeredCommandIds.has(exportCmdId)) {
				const command = exportCmd(this.plugin.app, this.settings)
				this.registerCommand(command.id, command)
			}
		} else if (this.registeredCommandIds.has(exportCmdId)) {
			this.plugin.removeCommand(exportCmdId)
			this.registeredCommandIds.delete(exportCmdId)
		}
	}
}
