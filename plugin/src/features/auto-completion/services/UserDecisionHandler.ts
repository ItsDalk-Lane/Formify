/**
 * 用户决策处理器
 * 负责监听用户的接受或拒绝操作
 */

import { Editor, EditorPosition } from 'obsidian';
import type { PreviewRenderer } from './PreviewRenderer';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 决策类型
 */
export type DecisionType = 'accept' | 'reject' | 'none';

/**
 * 决策结果
 */
export interface DecisionResult {
	/** 决策类型 */
	type: DecisionType;
	/** 是否插入了文本 */
	inserted: boolean;
	/** 插入的文本(如果有) */
	text?: string;
}

/**
 * 用户决策处理器类
 */
export class UserDecisionHandler {
	private previewRenderer: PreviewRenderer;
	private isActive: boolean = false;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(previewRenderer: PreviewRenderer) {
		this.previewRenderer = previewRenderer;
	}

	/**
	 * 激活决策监听
	 * @param editor 编辑器实例
	 * @param onDecision 决策回调
	 */
	activate(editor: Editor, onDecision: (result: DecisionResult) => void): void {
		if (this.isActive) {
			DebugLogger.warn('[UserDecisionHandler] 决策监听已激活,先停用');
			this.deactivate();
		}

		this.isActive = true;

		// 创建键盘事件处理器
		this.keydownHandler = (event: KeyboardEvent) => {
			if (!this.isActive) return;

			const key = event.key;

			DebugLogger.debug('[UserDecisionHandler] 按键事件', key);

			// Enter键 - 接受补全
			if (key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				
				const result = this.previewRenderer.accept(editor);
				this.deactivate();
				
				onDecision({
					type: 'accept',
					inserted: result.inserted,
					text: result.text
				});
				
				DebugLogger.info('[UserDecisionHandler] 用户接受了补全');
				return;
			}

			// Tab键 - 也可以接受补全
			if (key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				
				const result = this.previewRenderer.accept(editor);
				this.deactivate();
				
				onDecision({
					type: 'accept',
					inserted: result.inserted,
					text: result.text
				});
				
				DebugLogger.info('[UserDecisionHandler] 用户通过Tab接受了补全');
				return;
			}

			// Escape键 - 拒绝补全
			if (key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				
				this.previewRenderer.reject(editor);
				this.deactivate();
				
				onDecision({
					type: 'reject',
					inserted: false
				});
				
				DebugLogger.info('[UserDecisionHandler] 用户拒绝了补全');
				return;
			}

			// 其他可打印字符 - 拒绝补全并继续输入
			if (this.isPrintableKey(key)) {
				this.previewRenderer.reject(editor);
				this.deactivate();
				
				onDecision({
					type: 'reject',
					inserted: false
				});
				
				DebugLogger.info('[UserDecisionHandler] 用户输入了其他字符,拒绝补全');
				// 不阻止事件,让字符正常输入
				return;
			}

			// 方向键、退格等 - 拒绝补全
			if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Delete'].includes(key)) {
				this.previewRenderer.reject(editor);
				this.deactivate();
				
				onDecision({
					type: 'reject',
					inserted: false
				});
				
				DebugLogger.info('[UserDecisionHandler] 用户使用了导航键,拒绝补全');
				return;
			}
		};

		// 注册事件监听器
		const editorElement = (editor as any).cm?.dom;
		if (editorElement) {
			editorElement.addEventListener('keydown', this.keydownHandler, true);
			DebugLogger.debug('[UserDecisionHandler] 已注册键盘事件监听');
		} else {
			DebugLogger.warn('[UserDecisionHandler] 无法获取编辑器DOM元素');
		}
	}

	/**
	 * 停用决策监听
	 */
	deactivate(): void {
		if (!this.isActive) return;

		this.isActive = false;

		// 移除事件监听器
		if (this.keydownHandler) {
			// 尝试从所有可能的编辑器元素上移除监听器
			const editorElements = document.querySelectorAll('.cm-editor');
			editorElements.forEach(el => {
				el.removeEventListener('keydown', this.keydownHandler as any, true);
			});

			this.keydownHandler = null;
			DebugLogger.debug('[UserDecisionHandler] 已移除键盘事件监听');
		}
	}

	/**
	 * 判断是否为可打印字符
	 */
	private isPrintableKey(key: string): boolean {
		// 单个字符且不是特殊键
		return key.length === 1 && !key.match(/[\x00-\x1F\x7F]/);
	}

	/**
	 * 检查是否激活
	 */
	isActivated(): boolean {
		return this.isActive;
	}

	/**
	 * 销毁
	 */
	dispose(): void {
		this.deactivate();
		DebugLogger.debug('[UserDecisionHandler] 已销毁');
	}
}
