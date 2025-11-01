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
import { getTitleFromCmdId, loadTemplateFileCommand, promptTemplateCmd, templateToCmdId } from './prompt'
import { TarsSettings } from './settings'
import { StatusBarManager } from './statusBarManager'
import { getMaxTriggerLineLength, TagEditorSuggest, TagEntry } from './suggest'

type PersistSettings = () => Promise<void>

export class TarsFeatureManager {
	private statusBarManager: StatusBarManager | null = null
	private readonly tagLowerCaseMap: Map<string, Omit<TagEntry, 'replacement'>> = new Map()
	private aborterInstance: AbortController | null = null
	private tagCmdIds: string[] = []
	private promptCmdIds: string[] = []
	private registeredCommandIds: Set<string> = new Set()
	private tagEditorSuggest: TagEditorSuggest | null = null

	constructor(
		private readonly plugin: Plugin,
		private settings: TarsSettings,
		private readonly persistSettings: PersistSettings
	) {}

	initialize() {
		this.settings.editorStatus = this.settings.editorStatus ?? { isTextInserting: false }
		const statusBarItem = this.plugin.addStatusBarItem()
		this.statusBarManager = new StatusBarManager(this.plugin.app, statusBarItem)

		this.buildTagCommands(true)
		this.buildPromptCommands(true)

		const selectCommand = selectMsgAtCursorCmd(this.plugin.app, this.settings)
		this.registerCommand(selectCommand.id, selectCommand)
		const loadTemplateCommand = loadTemplateFileCommand(
			this.plugin.app,
			this.settings,
			() => this.persistSettings(),
			() => this.buildPromptCommands()
		)
		this.registerCommand(loadTemplateCommand.id, loadTemplateCommand)

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
		this.promptCmdIds.forEach((id) => this.plugin.removeCommand(id))
		this.promptCmdIds = []
		this.tagLowerCaseMap.clear()

		this.disposeEditorSuggest(true)

		this.statusBarManager?.dispose()
		this.statusBarManager = null
		this.aborterInstance = null
	}

	updateSettings(settings: TarsSettings) {
		this.settings = settings
		this.buildTagCommands()
		this.buildPromptCommands()
		this.syncOptionalCommands()
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
			new Notice(`${t('Removed commands')}: ${removedTags.join(', ')}`)
		}
		const addedTags = toAdd.map((cmdId) => getMeta(cmdId).tag)
		if (addedTags.length > 0) {
			console.debug('Added commands', addedTags)
			new Notice(`${t('Added commands')}: ${addedTags.join(', ')}`)
		}
	}

	private buildPromptCommands(suppressNotifications: boolean = false) {
		const newPromptCmdIds = this.settings.promptTemplates.map(templateToCmdId)

		const toRemove = this.promptCmdIds.filter((cmdId) => !newPromptCmdIds.includes(cmdId))
		toRemove.forEach((cmdId) => this.plugin.removeCommand(cmdId))

		const toAdd = this.settings.promptTemplates.filter((t) => !this.promptCmdIds.includes(templateToCmdId(t)))
		toAdd.forEach((t) => {
			const command = promptTemplateCmd(templateToCmdId(t), t.title, this.plugin.app, this.settings)
			this.registerCommand(command.id, command, false)
		})

		this.promptCmdIds = newPromptCmdIds
		if (suppressNotifications) return

		const removedTitles = toRemove.map((cmdId) => getTitleFromCmdId(cmdId))
		if (removedTitles.length > 0) {
			console.debug('Removed commands', removedTitles)
			new Notice(`${t('Removed commands')}: ${removedTitles.join(', ')}`)
		}
		const addedTitles = toAdd.map((t) => t.title)
		if (addedTitles.length > 0) {
			console.debug('Added commands', addedTitles)
			new Notice(`${t('Added commands')}: ${addedTitles.join(', ')}`)
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
