/**
 * 预览渲染器
 * 负责在编辑器中渲染补全内容的预览效果
 */

import { Editor, EditorPosition } from 'obsidian';
import type { AutoCompletionSettings } from '../settings';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 预览装饰信息
 */
export interface PreviewDecoration {
	/** 补全文本 */
	text: string;
	/** 起始位置 */
	from: EditorPosition;
	/** 结束位置 */
	to: EditorPosition;
	/** 标记ID */
	markerId: string;
}

/**
 * 预览渲染器类
 */
export class PreviewRenderer {
	private settings: AutoCompletionSettings;
	private currentDecoration: PreviewDecoration | null = null;
	private decorationElement: HTMLElement | null = null;

	constructor(settings: AutoCompletionSettings) {
		this.settings = settings;
	}

	/**
	 * 渲染预览
	 * @param editor 编辑器实例
	 * @param text 补全文本
	 * @param position 插入位置
	 */
	render(editor: Editor, text: string, position: EditorPosition): PreviewDecoration {
		// 清除之前的预览
		this.clear(editor);

		// 创建临时文本标记以获取位置信息
		const endPos = { ...position };
		
		// 创建装饰元素
		const widget = this.createWidget(text);
		
		// 在光标位置插入装饰
		// 注意: Obsidian的Editor API在这里我们使用一个临时方案
		// 实际应该使用EditorView的装饰API,但为了简化,我们直接在光标位置显示
		const markerId = `ac-preview-${Date.now()}`;
		
		// 保存装饰信息
		this.currentDecoration = {
			text,
			from: position,
			to: endPos,
			markerId
		};

		// 将widget元素添加到编辑器
		this.attachWidget(editor, widget, position);

		DebugLogger.debug('[PreviewRenderer] 预览已渲染', {
			textLength: text.length,
			position
		});

		return this.currentDecoration;
	}

	/**
	 * 创建装饰widget元素
	 */
	private createWidget(text: string): HTMLElement {
		const container = document.createElement('span');
		container.className = 'auto-completion-preview';
		
		// 应用样式
		this.applyStyles(container, text);

		// 添加AI图标(仅半透明样式)
		if (this.settings.displayStyle === 'transparent') {
			const icon = this.createAIIcon();
			container.appendChild(icon);
		}

		// 添加文本
		const textSpan = document.createElement('span');
		textSpan.className = 'auto-completion-text';
		textSpan.textContent = text;
		container.appendChild(textSpan);

		this.decorationElement = container;
		return container;
	}

	/**
	 * 应用样式
	 */
	private applyStyles(element: HTMLElement, text: string): void {
		const style = element.style;

		switch (this.settings.displayStyle) {
			case 'transparent':
				style.color = this.settings.textColor;
				style.backgroundColor = this.settings.backgroundColor;
				style.opacity = this.settings.textOpacity.toString();
				style.borderLeft = '2px solid #4A90E2';
				style.paddingLeft = '4px';
				break;

			case 'underline':
				style.color = 'inherit';
				style.textDecoration = 'underline';
				style.textDecorationStyle = 'dashed';
				style.textDecorationColor = this.settings.textColor;
				style.textDecorationThickness = '2px';
				break;

			case 'highlight':
				style.color = 'inherit';
				style.backgroundColor = this.settings.backgroundColor;
				style.opacity = this.settings.textOpacity.toString();
				break;
		}

		// 通用样式
		style.display = 'inline';
		style.transition = 'opacity 0.2s ease';
		style.pointerEvents = 'none';
		style.userSelect = 'none';
	}

	/**
	 * 创建AI图标
	 */
	private createAIIcon(): HTMLElement {
		const icon = document.createElement('span');
		icon.className = 'auto-completion-icon';
		icon.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A90E2" stroke-width="2">
				<path d="M12 2L2 7l10 5 10-5-10-5z"></path>
				<path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
			</svg>
		`;
		icon.style.marginRight = '4px';
		icon.style.verticalAlign = 'middle';
		return icon;
	}

	/**
	 * 将widget附加到编辑器
	 * 由于Obsidian API限制,这里使用临时方案:在光标位置后插入一个临时文本
	 */
	private attachWidget(editor: Editor, widget: HTMLElement, position: EditorPosition): void {
		// 获取编辑器容器
		const editorContainer = (editor as any).cm?.dom;
		if (!editorContainer) {
			DebugLogger.warn('[PreviewRenderer] 无法获取编辑器容器');
			return;
		}

		// 获取光标对应的DOM位置
		// 这里我们使用一个简化方案:在当前行末尾添加widget
		const lineEl = editorContainer.querySelector(`.cm-line:nth-child(${position.line + 1})`);
		if (lineEl) {
			lineEl.appendChild(widget);
		}
	}

	/**
	 * 清除预览
	 */
	clear(editor: Editor): void {
		if (this.decorationElement && this.decorationElement.parentElement) {
			this.decorationElement.parentElement.removeChild(this.decorationElement);
		}

		this.decorationElement = null;
		this.currentDecoration = null;

		DebugLogger.debug('[PreviewRenderer] 预览已清除');
	}

	/**
	 * 接受预览(将预览内容转为正式文本)
	 */
	accept(editor: Editor): { inserted: boolean; text: string } {
		if (!this.currentDecoration) {
			DebugLogger.warn('[PreviewRenderer] 没有可接受的预览');
			return { inserted: false, text: '' };
		}

		const text = this.currentDecoration.text;
		const position = this.currentDecoration.from;

		// 在光标位置插入文本
		editor.replaceRange(text, position);

		// 根据设置移动光标
		if (this.settings.cursorPositionAfter === 'end') {
			// 移动到插入文本的末尾
			const newPos = {
				line: position.line,
				ch: position.ch + text.length
			};
			editor.setCursor(newPos);
		}
		// 如果是'stay',则保持光标在原位置(不需要额外操作)

		// 清除预览
		this.clear(editor);

		DebugLogger.debug('[PreviewRenderer] 预览已接受并插入', {
			textLength: text.length,
			cursorPosition: this.settings.cursorPositionAfter
		});

		return { inserted: true, text };
	}

	/**
	 * 拒绝预览
	 */
	reject(editor: Editor): void {
		this.clear(editor);
		DebugLogger.debug('[PreviewRenderer] 预览已拒绝');
	}

	/**
	 * 获取当前预览
	 */
	getCurrentPreview(): PreviewDecoration | null {
		return this.currentDecoration;
	}

	/**
	 * 更新设置
	 */
	updateSettings(settings: AutoCompletionSettings): void {
		this.settings = settings;
		DebugLogger.debug('[PreviewRenderer] 设置已更新');
	}

	/**
	 * 销毁
	 */
	dispose(editor: Editor): void {
		this.clear(editor);
		DebugLogger.debug('[PreviewRenderer] 已销毁');
	}
}
