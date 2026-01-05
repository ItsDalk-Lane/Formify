import { Extension, StateField, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { App, TFile } from 'obsidian';
import type { ChatSettings, Skill } from '../types/chat';

/**
 * 选区信息接口
 */
export interface SelectionInfo {
	text: string;
	from: number;
	to: number;
	coords: {
		top: number;
		left: number;
		right: number;
		bottom: number;
	};
}

/**
 * 选区工具栏回调接口
 */
export interface SelectionToolbarCallbacks {
	onShowToolbar: (info: SelectionInfo, view: EditorView, activeFile: TFile | null) => void;
	onHideToolbar: () => void;
}

/**
 * 全局设置引用
 */
let globalSelectionToolbarSettings: ChatSettings | null = null;

/**
 * 更新选区工具栏设置
 */
export function updateSelectionToolbarSettings(settings: ChatSettings): void {
	globalSelectionToolbarSettings = settings;
}

/**
 * 检查选区工具栏是否启用
 */
export function isSelectionToolbarEnabled(): boolean {
	return globalSelectionToolbarSettings?.enableSelectionToolbar ?? true;
}

/**
 * 获取选区工具栏设置
 */
export function getSelectionToolbarSettings(): ChatSettings | null {
	return globalSelectionToolbarSettings;
}

/**
 * 创建选区工具栏 CodeMirror 6 扩展
 * 
 * @param app Obsidian App 实例
 * @param settings Chat 设置
 * @param callbacks 工具栏回调
 * @returns CodeMirror 6 扩展
 */
export function createSelectionToolbarExtension(
	app: App,
	settings: ChatSettings,
	callbacks: SelectionToolbarCallbacks
): Extension {
	// 防抖控制
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_DELAY = 150; // 毫秒

	// 上一次选区状态
	let lastSelectionText = '';
	let isToolbarVisible = false;

	return ViewPlugin.fromClass(
		class {
			constructor(private view: EditorView) {}

			update(update: ViewUpdate) {
				// 检查是否启用选区工具栏
				if (!isSelectionToolbarEnabled()) {
					if (isToolbarVisible) {
						callbacks.onHideToolbar();
						isToolbarVisible = false;
					}
					return;
				}

				// 检查选区是否变化
				if (!update.selectionSet && !update.docChanged) {
					return;
				}

				// 获取主选区
				const selection = update.state.selection.main;
				const hasSelection = !selection.empty;
				const selectedText = hasSelection
					? update.state.sliceDoc(selection.from, selection.to)
					: '';

				// 如果没有选区或选区为空，隐藏工具栏
				if (!hasSelection || selectedText.trim().length === 0) {
					if (isToolbarVisible) {
						callbacks.onHideToolbar();
						isToolbarVisible = false;
						lastSelectionText = '';
					}
					return;
				}

				// 如果选区文本与上次相同，不重复处理
				if (selectedText === lastSelectionText && isToolbarVisible) {
					return;
				}

				lastSelectionText = selectedText;

				// 防抖处理
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}

				debounceTimer = setTimeout(() => {
					// 再次检查选区是否仍然有效
					const currentSelection = this.view.state.selection.main;
					if (currentSelection.empty) {
						if (isToolbarVisible) {
							callbacks.onHideToolbar();
							isToolbarVisible = false;
						}
						return;
					}

					// 计算选区坐标
					const coords = this.getSelectionCoords(currentSelection.from, currentSelection.to);
					if (!coords) {
						return;
					}

					// 获取当前活动文件
					const activeFile = app.workspace.getActiveFile();

					// 调用回调显示工具栏
					const selectionInfo: SelectionInfo = {
						text: selectedText,
						from: currentSelection.from,
						to: currentSelection.to,
						coords
					};

					callbacks.onShowToolbar(selectionInfo, this.view, activeFile);
					isToolbarVisible = true;
				}, DEBOUNCE_DELAY);
			}

			/**
			 * 获取选区的屏幕坐标
			 */
			private getSelectionCoords(from: number, to: number): SelectionInfo['coords'] | null {
				try {
					const fromCoords = this.view.coordsAtPos(from);
					const toCoords = this.view.coordsAtPos(to);

					if (!fromCoords || !toCoords) {
						return null;
					}

					return {
						top: Math.min(fromCoords.top, toCoords.top),
						left: Math.min(fromCoords.left, toCoords.left),
						right: Math.max(fromCoords.right, toCoords.right),
						bottom: Math.max(fromCoords.bottom, toCoords.bottom)
					};
				} catch (e) {
					console.error('[SelectionToolbarExtension] 获取选区坐标失败:', e);
					return null;
				}
			}

			destroy() {
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}
				if (isToolbarVisible) {
					callbacks.onHideToolbar();
					isToolbarVisible = false;
				}
			}
		}
	);
}
