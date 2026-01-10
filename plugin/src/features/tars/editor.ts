import {
	App,
	Editor,
	EditorPosition,
	EmbedCache,
	LinkCache,
	MetadataCache,
	Notice,
	ReferenceCache,
	SectionCache,
	TagCache,
	Vault,
	debounce,
	normalizePath,
	parseLinktext,
	resolveSubpath
} from 'obsidian'
import { t } from 'tars/lang/helper'
import { CreatePlainText, Message, ProviderSettings, ResolveEmbedAsBinary, SaveAttachment, Vendor } from './providers'
import { withStreamLogging } from './providers/decorator'
import { APP_FOLDER, EditorStatus, TarsSettings, availableVendors } from './settings'
import { GenerationStats, StatusBarManager } from './statusBarManager'
import { TagRole } from './suggest'
import { DebugLogger } from '../../utils/DebugLogger'
import { InternalLinkParserService } from '../../service/InternalLinkParserService'
import { SystemPromptAssembler } from '../../service/SystemPromptAssembler'

export interface RunEnv {
	readonly app: App
	readonly appMeta: MetadataCache
	readonly vault: Vault
	readonly fileText: string
	readonly filePath: string
	readonly tags: TagCache[]
	readonly sections: SectionCache[]
	readonly links?: LinkCache[]
	readonly embeds?: ReferenceCache[]
	readonly options: {
		newChatTags: string[]
		userTags: string[]
		assistantTags: string[]
		systemTags: string[]
		enableInternalLink: boolean
		maxInternalLinkDepth: number
		linkParseTimeout: number
		enableStreamLog: boolean
	}
	saveAttachment: SaveAttachment
	resolveEmbed: ResolveEmbedAsBinary
	createPlainText: CreatePlainText
	linkParser: InternalLinkParserService
}

interface Tag extends Omit<Message, 'content'> {
	readonly tag: TagRole
	readonly lowerCaseTag: string
	readonly tagRange: [number, number]
	readonly tagLine: number
}

interface TaggedBlock extends Tag {
	readonly contentRange: [number, number]
	readonly line: [number, number]
	readonly sections: SectionCache[]
}

const ignoreSectionTypes: readonly string[] = ['callout']

const findLast = <T>(array: readonly T[], predicate: (value: T, index: number, arr: readonly T[]) => boolean): T | undefined => {
	for (let index = array.length - 1; index >= 0; index -= 1) {
		const item = array[index]
		if (predicate(item, index, array)) {
			return item
		}
	}
	return undefined
}

const findLastIndex = <T>(array: readonly T[], predicate: (value: T, index: number, arr: readonly T[]) => boolean): number => {
	for (let index = array.length - 1; index >= 0; index -= 1) {
		if (predicate(array[index], index, array)) {
			return index
		}
	}
	return -1
}

export const buildRunEnv = async (app: App, settings: TarsSettings): Promise<RunEnv> => {
	const activeFile = app.workspace.getActiveFile()
	if (!activeFile) {
		throw new Error('No active file')
	}

	const appMeta = app.metadataCache
	const vault = app.vault
	const fileText = await vault.cachedRead(activeFile)
	const filePath = activeFile.path
	const fileMeta = appMeta.getFileCache(activeFile)
	if (!fileMeta) {
		throw new Error(t('Waiting for metadata to be ready. Please try again.'))
	}

	const ignoreSections = fileMeta.sections?.filter((s) => ignoreSectionTypes.includes(s.type)) || []
	const filteredTags = (fileMeta.tags || []).filter(
		(t) =>
			!ignoreSections.some(
				(s) => s.position.start.offset <= t.position.start.offset && t.position.end.offset <= s.position.end.offset
			)
	)

	const options = {
		newChatTags: settings.newChatTags,
		userTags: settings.userTags,
		assistantTags: settings.providers.map((p) => p.tag),
		systemTags: settings.systemTags,
		enableInternalLink: settings.internalLinkParsing?.enabled ?? settings.enableInternalLink ?? true,
		maxInternalLinkDepth: settings.internalLinkParsing?.maxDepth ?? settings.maxLinkParseDepth ?? 5,
		linkParseTimeout: settings.internalLinkParsing?.timeout ?? settings.linkParseTimeout ?? 5000,
		enableStreamLog: settings.enableStreamLog
	}

	const saveAttachment = async (filename: string, data: ArrayBuffer) => {
		const attachmentPath = await app.fileManager.getAvailablePathForAttachment(filename)
		await vault.createBinary(attachmentPath, data)
	}
	const resolveEmbed = async (embed: EmbedCache) => {
		const { path, subpath } = parseLinktext(embed.link)
		DebugLogger.debug('resolveEmbed path', path, 'subpath', subpath)
		const targetFile = appMeta.getFirstLinkpathDest(path, filePath)
		if (targetFile === null) {
			throw new Error('LinkText broken: ' + embed.link.substring(0, 20))
		}
		return await vault.readBinary(targetFile)
	}
	const createPlainText = async (filePath: string, text: string) => {
		await vault.create(filePath, text)
	}

	return {
		app,
		appMeta,
		vault,
		fileText,
		filePath,
		tags: filteredTags,
		sections: fileMeta.sections?.filter((s) => !ignoreSectionTypes.includes(s.type)) || [],
		links: fileMeta.links,
		embeds: fileMeta.embeds,
		options,
		saveAttachment,
		resolveEmbed,
		createPlainText,
		linkParser: new InternalLinkParserService(app)
	}
}

const extractTaggedBlocks = (env: RunEnv, startOffset: number, endOffset: number) => {
	const {
		tags,
		sections,
		options: { userTags, assistantTags, systemTags }
	} = env

	const roleMappedTags: Tag[] = tags
		.filter((t) => startOffset <= t.position.start.offset && t.position.end.offset <= endOffset)
		.map((t) => {
			const lowerCaseTag = t.tag.slice(1).toLowerCase()
			const role = userTags.some((ut) => ut.toLowerCase() === lowerCaseTag)
				? 'user'
				: assistantTags.some((at) => at.toLowerCase() === lowerCaseTag)
					? 'assistant'
					: systemTags.some((st) => st.toLowerCase() === lowerCaseTag)
						? 'system'
						: null
			return role != null
				? {
						tag: t.tag,
						role,
						lowerCaseTag,
						tagRange: [t.position.start.offset, t.position.end.offset] as [number, number],
						tagLine: t.position.start.line
					}
				: null
		})
		.filter((t) => t !== null) as Tag[]
	DebugLogger.debug('roleMappedTags', roleMappedTags)

	const ranges: [number, number][] = roleMappedTags.map((tag, i) => [
		tag.tagRange[0],
		roleMappedTags[i + 1] ? roleMappedTags[i + 1].tagRange[0] - 1 : endOffset
	])

	const taggedBlocks: TaggedBlock[] = ranges.map((range, i) => ({
		...roleMappedTags[i],
		contentRange: [
			roleMappedTags[i].tagRange[1] + 2,
			roleMappedTags[i + 1] ? roleMappedTags[i + 1].tagRange[0] - 1 : endOffset
		], // +2 because there is a space and a colon after the tag
		sections: sections.filter(
			(section) =>
				section.position.end.offset <= range[1] &&
				(section.position.start.offset < range[0] ? section.position.end.offset > range[0] : true)
		),
		line: [roleMappedTags[i].tagLine, roleMappedTags[i + 1] ? roleMappedTags[i + 1].tagLine - 1 : Infinity]
	}))
	DebugLogger.debug('taggedBlocks', taggedBlocks)
	return taggedBlocks
}

const resolveTextRangeWithLinks = async (
	env: RunEnv,
	section: SectionCache,
	contentRange: readonly [number, number],
	role: 'user' | 'assistant' | 'system'
) => {
	const {
		fileText,
		links: links = [],
		embeds: embeds = [],
		options: { enableInternalLink, maxInternalLinkDepth, linkParseTimeout },
		linkParser,
		filePath
	} = env

	const startOffset = section.position.start.offset <= contentRange[0] ? contentRange[0] : section.position.start.offset

	const endOffset = section.position.end.offset

	const linksWithType = links.map((link) => ({
		ref: link,
		type: 'link' as const
	}))

	const embedsWithType = embeds.map((embed) => ({
		ref: embed,
		type: 'embed' as const
	}))

	const ordered = [...linksWithType, ...embedsWithType].sort(
		(a, b) => a.ref.position.start.offset - b.ref.position.start.offset
	)

	const filteredRefers = ordered.filter(
		(item) => startOffset <= item.ref.position.start.offset && item.ref.position.end.offset <= endOffset
	)

	const shouldResolveLinks = enableInternalLink
	let textWithoutEmbeds = fileText.slice(startOffset, endOffset)

	const embedsToStrip = filteredRefers.filter((item) => item.type === 'embed')
	if (embedsToStrip.length) {
		const sortedEmbeds = embedsToStrip.sort(
			(a, b) => b.ref.position.start.offset - a.ref.position.start.offset
		)
		sortedEmbeds.forEach(({ ref }) => {
			const relativeStart = ref.position.start.offset - startOffset
			const relativeEnd = ref.position.end.offset - startOffset
			textWithoutEmbeds =
				textWithoutEmbeds.slice(0, relativeStart) + textWithoutEmbeds.slice(relativeEnd)
		})
	}

	if (!shouldResolveLinks) {
		return {
			text: textWithoutEmbeds,
			range: [startOffset, endOffset] as [number, number]
		}
	}

	try {
		const parsedText = await linkParser.parseLinks(textWithoutEmbeds, filePath, {
			enableParsing: true,
			maxDepth: maxInternalLinkDepth,
			timeout: linkParseTimeout,
			preserveOriginalOnError: true,
			enableCache: true
		})
		return {
			text: parsedText,
			range: [startOffset, endOffset] as [number, number]
		}
	} catch (err) {
		DebugLogger.warn('内链解析失败，使用原文返回', err)
		return {
			text: textWithoutEmbeds,
			range: [startOffset, endOffset] as [number, number]
		}
	}
}

const extractTaggedBlockContent = async (env: RunEnv, taggedBlock: TaggedBlock) => {
	const textRanges = await Promise.all(
		taggedBlock.sections.map((section) =>
			resolveTextRangeWithLinks(env, section, taggedBlock.contentRange, taggedBlock.role)
		)
	)
	DebugLogger.debug('textRanges', textRanges)
	const accumulated = textRanges
		.map((range) => range.text)
		.join('\n\n')
		.trim()
	return accumulated
}

const filterEmbeds = (env: RunEnv, contentRange: [number, number]) =>
	env.embeds?.filter(
		(embed) => contentRange[0] <= embed.position.start.offset && embed.position.end.offset <= contentRange[1]
	)

const extractConversation = async (env: RunEnv, startOffset: number, endOffset: number) => {
	const {
		tags: tagsInMeta,
		options: { newChatTags }
	} = env

	const lastNewChatTag = findLast(
		tagsInMeta,
		(t) =>
			newChatTags.some((n) => t.tag.slice(1).toLowerCase() === n.toLowerCase()) &&
			startOffset <= t.position.start.offset &&
			t.position.end.offset <= endOffset
	)
	const conversationStart = lastNewChatTag ? lastNewChatTag.position.end.offset : startOffset

	const taggedBlocks = extractTaggedBlocks(env, conversationStart, endOffset)
	const conversation = await Promise.all(
		taggedBlocks.map(async (tag) => {
			const message = {
				...tag,
				content: await extractTaggedBlockContent(env, tag)
			}
			// Only add the embeds property when there are embedded contents
			const filteredEmbeds = filterEmbeds(env, tag.contentRange)
			if (filteredEmbeds && filteredEmbeds.length > 0) {
				message.embeds = filteredEmbeds
			}
			return message
		})
	)
	return conversation
}

const debouncedResetInsertState = debounce(
	(editorStatus: EditorStatus) => {
		editorStatus.isTextInserting = false
	},
	1000,
	true
)

const insertText = (editor: Editor, text: string, editorStatus: EditorStatus, lastEditPos: EditorPosition | null) => {
	editorStatus.isTextInserting = true
	let cursor = editor.getCursor('to')

	if (lastEditPos !== null && (lastEditPos.line !== cursor.line || lastEditPos.ch !== cursor.ch)) {
		// If there is a previous edit position, and it is different from the current cursor position, update the cursor to the last edit position
		cursor = lastEditPos
	}

	const lineAtCursor = editor.getLine(cursor.line)
	if (lineAtCursor.length > cursor.ch) {
		cursor = { line: cursor.line, ch: lineAtCursor.length }
		// DebugLogger.debug('Update cursor to end of line', cursor)
	}

	const lines = text.split('\n')
	const newEditPos = {
		line: cursor.line + lines.length - 1,
		ch: lines.length === 1 ? cursor.ch + text.length : lines[lines.length - 1].length
	}

	editor.replaceRange(text, cursor)
	editor.setCursor(newEditPos)
	debouncedResetInsertState(editorStatus)
	return newEditPos
}

export const extractConversationsTextOnly = async (env: RunEnv) => {
	const {
		tags,
		options: { newChatTags }
	} = env

	const conversationTags = tags.filter((t) => newChatTags.some((n) => t.tag.slice(1).toLowerCase() === n.toLowerCase()))

	const positionOffsets = conversationTags.flatMap((tag) => [
		tag.position.start.offset - 1,
		tag.position.end.offset + 1
	])
	const positions = [0, ...positionOffsets, Infinity]
	const ranges = positions
		.filter((_, index) => index % 2 === 0)
		.map((startOffset, index) => ({ startOffset, endOffset: positions[index * 2 + 1] }))

	DebugLogger.debug('ranges', ranges)

	const conversations = await Promise.all(
		ranges.map(async (r) => {
			const taggedBlocks = extractTaggedBlocks(env, r.startOffset, r.endOffset)
			const conversation = Promise.all(
				taggedBlocks.map(async (tag) => ({
					...tag,
					content: await extractTaggedBlockContent(env, tag)
				}))
			)
			return conversation
		})
	)

	return conversations.filter((arr) => arr.length > 0)
}

export const getMsgPositionByLine = (env: RunEnv, line: number) => {
	const {
		tags: tagsInMeta,
		sections,
		options: { systemTags, userTags, assistantTags }
	} = env
	const msgTags = [...systemTags, ...userTags, ...assistantTags]
	const msgTagsInMeta = tagsInMeta.filter((t) => msgTags.some((n) => t.tag.slice(1).toLowerCase() === n.toLowerCase()))
	DebugLogger.debug('msgTagsInMeta', msgTagsInMeta)
	const msgIndex = findLastIndex(msgTagsInMeta, (t) => t.position.start.line <= line)
	if (msgIndex < 0) return [-1, -1]

	DebugLogger.debug('msgTag', msgTagsInMeta[msgIndex])
	const startOffset = msgTagsInMeta[msgIndex].position.end.offset + 2
	const nextMsgIndex = msgIndex + 1
	const nextMsgStartOffset =
		nextMsgIndex < msgTagsInMeta.length ? msgTagsInMeta[nextMsgIndex].position.start.offset : Infinity
	DebugLogger.debug('nextTag', msgTagsInMeta[nextMsgIndex])
	const lastSection = findLast(
		sections,
		(section) =>
			section.position.end.offset <= nextMsgStartOffset &&
			section.position.start.line >= line
	)
	if (!lastSection) return [-1, -1]

	const endOffset = lastSection.position.end.offset
	DebugLogger.debug('startOff', startOffset, 'endOffset', endOffset)
	return [startOffset, endOffset]
}

const formatDuration = (d: number) => `${(d / 1000).toFixed(2)}s`

export interface RequestController {
	getController: () => AbortController
	cleanup: () => void
}

const createDecoratedSendRequest = async (env: RunEnv, vendor: Vendor, provider: ProviderSettings) => {
	if (env.options.enableStreamLog) {
		if (!(await env.vault.adapter.exists(normalizePath(APP_FOLDER)))) {
			await env.vault.createFolder(APP_FOLDER)
		}
		DebugLogger.debug('Using stream logging')
		return withStreamLogging(vendor.sendRequestFunc(provider.options), env.createPlainText)
	} else {
		return vendor.sendRequestFunc(provider.options)
	}
}

export const generate = async (
	env: RunEnv,
	editor: Editor,
	provider: ProviderSettings,
	endOffset: number,
	statusBarManager: StatusBarManager,
	editorStatus: EditorStatus,
	requestController: RequestController
) => {
	try {
		const vendor = availableVendors.find((v) => v.name === provider.vendor)
		if (!vendor) {
			throw new Error('No vendor found ' + provider.vendor)
		}

		const conversation = await extractConversation(env, 0, endOffset)
		const messages = conversation.map((c) =>
			c.embeds ? { role: c.role, content: c.content, embeds: c.embeds } : { role: c.role, content: c.content }
		)
		DebugLogger.logLlmMessages('Tars.generate', messages, { level: 'debug' })

		const lastMsg = messages.last()
		if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content.trim().length === 0) {
			throw new Error(t('Please add a user message first, or wait for the user message to be parsed.'))
		}

		if (messages[0]?.role !== 'system') {
			const assembler = new SystemPromptAssembler(env.app)
			const globalSystemPrompt = await assembler.buildGlobalSystemPrompt('tars_chat')
			if (globalSystemPrompt && globalSystemPrompt.trim().length > 0) {
				messages.unshift({
					role: 'system',
					content: globalSystemPrompt
				})
				DebugLogger.debug('Global system prompts added')
			}
		}

		const round = messages.filter((m) => m.role === 'assistant').length + 1

		const sendRequest = await createDecoratedSendRequest(env, vendor, provider)

		const startTime = new Date()
		statusBarManager.setGeneratingStatus(round)

		let llmResponse = ''
		const controller = requestController.getController()

		let lastEditPos: EditorPosition | null = null
		let startPos: EditorPosition | null = null
		for await (const text of sendRequest(messages, controller, env.resolveEmbed, env.saveAttachment)) {
			if (startPos == null) startPos = editor.getCursor('to')
			lastEditPos = insertText(editor, text, editorStatus, lastEditPos)
			llmResponse += text
			statusBarManager.updateGeneratingProgress(llmResponse.length)
		}

		const endTime = new Date()
		const duration = formatDuration(endTime.getTime() - startTime.getTime())

		// Create statistics and set success status
		const stats: GenerationStats = {
			round,
			characters: llmResponse.length,
			duration,
			model: provider.options.model,
			vendor: provider.vendor,
			startTime,
			endTime
		}

		statusBarManager.setSuccessStatus(stats)

		// 检查是否有有效内容（文本或图片）
		const hasValidContent = llmResponse.length > 0 ||
			/\!\[\[.*?\]\]/.test(llmResponse) || // 检查是否有图片附件标记
			/📷.*?图片/.test(llmResponse) || // 检查是否有图片生成标记
			/data:image/.test(llmResponse) || // 检查是否有 base64 图片数据
			/📷.*?生成的图片/.test(llmResponse) || // 检查是否有图片生成提示
			/📷.*?Base64格式/.test(llmResponse) || // 检查是否有Base64格式图片
			/http[s]?:\/\/.*\.(jpg|jpeg|png|gif|webp)/.test(llmResponse) // 检查是否有图片URL

		if (!hasValidContent) {
			throw new Error(t('No text generated'))
		}

		DebugLogger.logLlmResponsePreview('Tars.generate', llmResponse, { level: 'debug', previewChars: 100 })
		if (startPos) {
			const endPos = editor.getCursor('to')
			const insertedText = editor.getRange(startPos, endPos)
			const formattedText = formatTextWithLeadingBreaks(llmResponse)
			if (insertedText !== formattedText) {
				DebugLogger.debug('format text with leading breaks')
				editor.replaceRange(formattedText, startPos, endPos)
			}
		}

		if (controller.signal.aborted) {
			throw new DOMException('Operation was aborted', 'AbortError')
		}
		// 根据内容类型显示不同的成功消息
		const successMessage = /\!\[\[.*?\]\]/.test(llmResponse) || /📷.*?图片/.test(llmResponse)
			? '✅ 图片生成成功！'
			: t('Text generated successfully')
		new Notice(successMessage)
	} finally {
		requestController.cleanup()
	}
}

const formatTextWithLeadingBreaks = (text: string) => {
	const firstLine = text.split('\n')[0]
	if (firstLine.startsWith('#') || firstLine.startsWith('```')) {
		// Markdown header or code block
		return ' \n' + text
	}
	if (firstLine.startsWith('| ')) {
		// Markdown table
		return ' \n\n' + text
	}
	return text
}


