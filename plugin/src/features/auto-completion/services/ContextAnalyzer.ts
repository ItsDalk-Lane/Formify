/**
 * 上下文分析器
 * 负责从编辑器中提取光标位置前的文本作为补全上下文
 */

import { Editor, TFile } from 'obsidian';
import type { AutoCompletionSettings } from '../settings';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 上下文提取结果
 */
export interface ContextResult {
	/** 上下文文本 */
	text: string;
	/** 光标位置 */
	cursorPosition: { line: number; ch: number };
	/** 当前文件 */
	file: TFile | null;
}

/**
 * 上下文分析器类
 */
export class ContextAnalyzer {
	private settings: AutoCompletionSettings;

	constructor(settings: AutoCompletionSettings) {
		this.settings = settings;
	}

	/**
	 * 从编辑器中提取上下文
	 * @param editor 编辑器实例
	 * @param file 当前文件
	 * @returns 上下文结果或null(如果不应触发)
	 */
	extract(editor: Editor, file: TFile | null): ContextResult | null {
		// 检查文件类型排除列表
		if (file && this.isFileExcluded(file)) {
			DebugLogger.debug('[ContextAnalyzer] 文件类型或路径被排除', file.path);
			return null;
		}

		// 获取光标位置
		const cursor = editor.getCursor();
		
		// 提取光标前的所有文本
		const fullText = this.getTextBeforeCursor(editor, cursor);
		
		if (!fullText || fullText.trim().length === 0) {
			DebugLogger.debug('[ContextAnalyzer] 光标前无文本内容');
			return null;
		}

		// 根据配置截取上下文
		const contextText = this.truncateContext(fullText);

		DebugLogger.debug('[ContextAnalyzer] 上下文提取完成', {
			length: contextText.length,
			position: cursor
		});

		return {
			text: contextText,
			cursorPosition: cursor,
			file
		};
	}

	/**
	 * 检查文件是否应该被排除
	 */
	private isFileExcluded(file: TFile): boolean {
		// 检查文件扩展名
		const fileExtension = file.extension;
		if (this.settings.excludeFileTypes.some(ext => 
			ext.toLowerCase() === fileExtension.toLowerCase()
		)) {
			return true;
		}

		// 检查文件夹路径
		const filePath = file.path;
		if (this.settings.excludeFolders.some(folder => 
			filePath.startsWith(folder + '/') || filePath.startsWith(folder + '\\')
		)) {
			return true;
		}

		return false;
	}

	/**
	 * 获取光标位置前的所有文本
	 */
	private getTextBeforeCursor(editor: Editor, cursor: { line: number; ch: number }): string {
		const lines: string[] = [];
		
		// 获取光标前的所有行
		for (let i = 0; i <= cursor.line; i++) {
			const lineText = editor.getLine(i);
			if (i === cursor.line) {
				// 最后一行只取到光标位置
				lines.push(lineText.substring(0, cursor.ch));
			} else {
				lines.push(lineText);
			}
		}

		return lines.join('\n');
	}

	/**
	 * 根据配置截取上下文
	 */
	private truncateContext(text: string): string {
		const maxLength = this.settings.maxContextLength;
		
		if (text.length <= maxLength) {
			return text;
		}

		// 保留最后的maxContextLength个字符
		const truncated = text.substring(text.length - maxLength);
		
		DebugLogger.debug('[ContextAnalyzer] 上下文被截断', {
			original: text.length,
			truncated: truncated.length
		});

		return truncated;
	}

	/**
	 * 更新设置
	 */
	updateSettings(settings: AutoCompletionSettings): void {
		this.settings = settings;
		DebugLogger.debug('[ContextAnalyzer] 设置已更新');
	}
}
