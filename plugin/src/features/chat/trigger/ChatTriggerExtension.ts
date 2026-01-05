import { Extension } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { App, TFile } from 'obsidian';
import type { ChatSettings } from '../types/chat';

/**
 * Chat 触发扩展的回调接口
 */
export interface ChatTriggerCallbacks {
	onTrigger: (activeFile: TFile | null) => void;
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

		// 检查是否启用触发功能
		if (!settings.enableChatTrigger) return;

		const triggerSymbol = settings.chatTriggerSymbol || '@';

		// 遍历所有变化事务
		update.transactions.forEach((tr) => {
			if (!tr.docChanged) return;

			tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				const insertedText = inserted.toString();

				// 检查是否刚刚输入了触发符号
				if (insertedText === triggerSymbol) {
					const now = Date.now();

					// 防抖检查
					if (now - lastTriggerTime < DEBOUNCE_INTERVAL) {
						return;
					}
					lastTriggerTime = now;

					// 获取当前活动文件
					const activeFile = app.workspace.getActiveFile();

					// 删除刚刚输入的触发符号
					const view = update.view;
					const deleteFrom = fromB;
					const deleteTo = toB;

					// 使用 requestAnimationFrame 确保在 DOM 更新后执行删除
					requestAnimationFrame(() => {
						view.dispatch({
							changes: {
								from: deleteFrom,
								to: deleteTo,
								insert: ''
							}
						});

						// 触发回调打开 Chat 模态框
						callbacks.onTrigger(activeFile);
					});
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
