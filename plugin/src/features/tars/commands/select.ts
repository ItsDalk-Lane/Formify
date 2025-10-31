import { App, Command, Editor, MarkdownView, Notice } from 'obsidian'
import { buildRunEnv, getMsgPositionByLine } from 'tars/editor'
import { t } from 'tars/lang/helper'
import { TarsSettings } from 'tars/settings'

export const selectMsgAtCursorCmd = (app: App, settings: TarsSettings): Command => ({
	id: 'select-message-at-cursor',
	name: t('Select message at cursor'),
	editorCallback: async (editor: Editor, _view: MarkdownView) => {
		const env = await buildRunEnv(app, settings)
		const currentLine = editor.getCursor('to').line
		const [startOffset, endOffset] = getMsgPositionByLine(env, currentLine)
		if (startOffset === -1 || endOffset === -1) {
			new Notice(t('No message found at cursor'))
			return
		}
		editor.setSelection(editor.offsetToPos(startOffset), editor.offsetToPos(endOffset))
	}
})


