import { Extension } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { App, TFile } from 'obsidian';
import type { ChatSettings } from '../types/chat';
import { getTriggerSource, isToolbarVisibleGlobally } from '../selection-toolbar/SelectionToolbarExtension';

/**
 * Chat 触发扩展的回调接口
 */
export interface ChatTriggerCallbacks {
	/** 触发快捷技能工具栏显示 */
	onShowToolbar: (view: EditorView, activeFile: TFile | null, symbolRange?: { from: number; to: number }) => void;
	/** 当符号触发后继续输入时隐藏工具栏 */
	onHideToolbar?: () => void;
}

function isWhitespaceOrBoundary(ch: string | null): boolean {
	if (ch === null) return true;
	return /\s/.test(ch);
}

function shouldTriggerBySymbol(view: EditorView, from: number, to: number): boolean {
	const doc = view.state.doc;
	const prev = from > 0 ? doc.sliceString(from - 1, from) : null;
	const next = to < doc.length ? doc.sliceString(to, to + 1) : null;
	return isWhitespaceOrBoundary(prev) && isWhitespaceOrBoundary(next);
}

/**
 * 创建 Chat 触发 CodeMirror 6 扩展
 *
 * @param app Obsidian App 实例
 * @param settings Chat 设置
 * @param callbacks 触发回调
 * @returns CodeMirror 6 扩展
 */
export function createChatTriggerExtension(
	app: App,
	settings: ChatSettings,
	callbacks: ChatTriggerCallbacks
): Extension {
	// 防抖控制
	let lastTriggerTime = 0;
	const DEBOUNCE_INTERVAL = 300; // 毫秒

	return EditorView.updateListener.of((update: ViewUpdate) => {
		// 只处理文档变化
		if (!update.docChanged) return;

		// 若工具栏已由“符号触发”显示，则用户继续输入任意内容时应立刻隐藏，避免干扰正常输入
		if (isToolbarVisibleGlobally() && getTriggerSource() === 'symbol') {
			callbacks.onHideToolbar?.();
			return;
		}

		// 使用全局设置，支持动态更新
		if (!globalSettings) return;

		// 检查是否启用触发功能
		if (!globalSettings.enableChatTrigger) return;

		// 兼容旧数据：确保 triggerSymbols 始终是数组
		let triggerSymbols = globalSettings.chatTriggerSymbol || ['@'];
		if (typeof triggerSymbols === 'string') {
			triggerSymbols = [triggerSymbols];
		}

		// 遍历所有变化事务
		update.transactions.forEach((tr) => {
			if (!tr.docChanged) return;

			tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				const insertedText = inserted.toString();

				// 检查是否刚刚输入了触发符号
				if (triggerSymbols.includes(insertedText)) {
					// 仅当触发符号前后相邻位置为空白/边界时才触发
					if (!shouldTriggerBySymbol(update.view, fromB, toB)) {
						return;
					}

					const now = Date.now();

					// 防抖检查
					if (now - lastTriggerTime < DEBOUNCE_INTERVAL) {
						return;
					}
					lastTriggerTime = now;

					// 获取当前活动文件
					const activeFile = app.workspace.getActiveFile();

					// 记录触发符号的位置，用于后续删除
					const symbolRange = { from: fromB, to: toB };

					// 不删除触发符号，直接显示工具栏
					// 符号会保留在编辑器中，直到用户执行技能或继续输入
					callbacks.onShowToolbar(update.view, activeFile, symbolRange);
				}
			});
		});
	});
}

/**
 * 全局 Chat 触发服务
 */
let globalChatTriggerEnabled = true;
let globalSettings: ChatSettings | null = null;

/**
 * 更新全局 Chat 触发设置
 */
export function updateChatTriggerSettings(settings: ChatSettings): void {
	globalSettings = settings;
	globalChatTriggerEnabled = settings.enableChatTrigger;
}

/**
 * 获取当前 Chat 触发是否启用
 */
export function isChatTriggerEnabled(): boolean {
	return globalChatTriggerEnabled;
}

/**
 * 获取当前 Chat 触发设置
 */
export function getChatTriggerSettings(): ChatSettings | null {
	return globalSettings;
}
