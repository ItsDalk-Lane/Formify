import { Extension, StateField, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { App, TFile, MarkdownView } from 'obsidian';
import type { ChatSettings, Skill } from '../types/chat';

/**
 * 获取文件内容（不包括 frontmatter）
 */
export function getContentWithoutFrontmatter(app: App): string {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) {
		return '';
	}

	// 获取编辑器内容
	const content = activeView.editor.getValue();

	// 检查是否有 frontmatter
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
	const match = content.match(frontmatterRegex);

	if (match) {
		// 移除 frontmatter
		return content.slice(match[0].length);
	}

	return content;
}

/**
 * 选区信息接口
 */
export interface SelectionInfo {
	text: string;
	fullText?: string; // 完整文本（不包括 frontmatter），用于符号触发
	from: number;
	to: number;
	coords: {
		top: number;
		left: number;
		right: number;
		bottom: number;
	};
	triggerSource: 'selection' | 'symbol'; // 触发来源：选中文本 或 输入符号
	triggerSymbolRange?: { from: number; to: number }; // 触发符号的位置范围（用于符号触发后删除）
}

/**
 * 选区工具栏回调接口
 */
export interface SelectionToolbarCallbacks {
	onShowToolbar: (info: SelectionInfo, view: EditorView, activeFile: TFile | null) => void;
	onHideToolbar: () => void;
	/** 通过符号触发显示工具栏 */
	onShowToolbarBySymbol?: (view: EditorView, activeFile: TFile | null) => void;
}

/**
 * 全局设置引用
 */
let globalSelectionToolbarSettings: ChatSettings | null = null;
/**
 * 全局触发来源
 */
let globalTriggerSource: 'selection' | 'symbol' | null = null;
/**
 * 全局工具栏可见状态
 */
let globalIsToolbarVisible = false;

/**
 * 设置当前触发来源
 */
export function setTriggerSource(source: 'selection' | 'symbol' | null): void {
	globalTriggerSource = source;
}

/**
 * 获取当前触发来源
 */
export function getTriggerSource(): 'selection' | 'symbol' | null {
	return globalTriggerSource;
}

/**
 * 设置工具栏可见状态
 */
export function setToolbarVisible(visible: boolean): void {
	globalIsToolbarVisible = visible;
}

/**
 * 获取工具栏可见状态
 */
export function isToolbarVisibleGlobally(): boolean {
	return globalIsToolbarVisible;
}

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
					if (globalIsToolbarVisible) {
						callbacks.onHideToolbar();
						globalIsToolbarVisible = false;
						setTriggerSource(null); // 清除触发来源
					}
					return;
				}

				// 检查选区是否变化
				if (!update.selectionSet && !update.docChanged) {
					return;
				}

				// 如果是通过符号触发的，任何文档变化都应该隐藏工具栏
				if (globalTriggerSource === 'symbol' && update.docChanged) {
					if (globalIsToolbarVisible) {
						callbacks.onHideToolbar();
						globalIsToolbarVisible = false;
						isToolbarVisible = false; // 同步本地状态
						setTriggerSource(null); // 清除触发来源
						setToolbarVisible(false); // 清除全局状态
						lastSelectionText = '';
					}
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
					if (globalIsToolbarVisible) {
						callbacks.onHideToolbar();
						globalIsToolbarVisible = false;
						isToolbarVisible = false; // 同步本地状态
						setTriggerSource(null); // 清除触发来源
						setToolbarVisible(false); // 清除全局状态
						lastSelectionText = '';
					}
					return;
				}

				// 如果选区文本与上次相同，不重复处理
				if (selectedText === lastSelectionText && globalIsToolbarVisible) {
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
						if (globalIsToolbarVisible) {
							callbacks.onHideToolbar();
							globalIsToolbarVisible = false;
							isToolbarVisible = false; // 同步本地状态
							setTriggerSource(null); // 清除触发来源
							setToolbarVisible(false); // 清除全局状态
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
						coords,
						triggerSource: 'selection' // 通过选中文本触发
					};

					// 设置触发来源和全局状态
					setTriggerSource('selection');
					setToolbarVisible(true);

					callbacks.onShowToolbar(selectionInfo, this.view, activeFile);
					globalIsToolbarVisible = true;
					isToolbarVisible = true; // 同步本地状态
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
