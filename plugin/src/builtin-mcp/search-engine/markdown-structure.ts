/**
 * Obsidian 风格搜索引擎 — Markdown 结构解析器
 *
 * 为 section: 和 block: 操作符提供 Markdown 文档的结构信息。
 * - section: 按 heading 切分章节
 * - block: 按空行切分块
 */

import { MarkdownBlock, MarkdownSection } from './types';

/**
 * 按 heading 将 Markdown 内容切分为章节。
 * 每个章节从 heading 行开始，到下一个同级或更高级 heading 前结束。
 * 文档开头到第一个 heading 之前的内容作为一个无标题章节。
 */
export function parseSections(content: string): MarkdownSection[] {
	const lines = content.split(/\r?\n/);
	const sections: MarkdownSection[] = [];
	const headingPattern = /^(#{1,6})\s+(.*)$/;

	// 收集所有 heading 位置
	const headings: Array<{ level: number; heading: string; line: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(headingPattern);
		if (match) {
			headings.push({
				level: match[1].length,
				heading: match[2].trim(),
				line: i + 1, // 1-based
			});
		}
	}

	// 文档开头到第一个 heading 之前
	if (headings.length === 0) {
		sections.push({
			heading: '',
			level: 0,
			startLine: 1,
			endLine: lines.length,
		});
		return sections;
	}

	if (headings[0].line > 1) {
		sections.push({
			heading: '',
			level: 0,
			startLine: 1,
			endLine: headings[0].line - 1,
		});
	}

	// 每个 heading 对应一个章节
	for (let i = 0; i < headings.length; i++) {
		const current = headings[i];
		const nextLine = i + 1 < headings.length
			? headings[i + 1].line - 1
			: lines.length;

		sections.push({
			heading: current.heading,
			level: current.level,
			startLine: current.line,
			endLine: nextLine,
		});
	}

	return sections;
}

/**
 * 按空行将 Markdown 内容切分为块（block）。
 * Obsidian 中一个 "块" 是由空行分隔的连续文本段落。
 */
export function parseBlocks(content: string): MarkdownBlock[] {
	const lines = content.split(/\r?\n/);
	const blocks: MarkdownBlock[] = [];
	let blockStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const isEmpty = lines[i].trim().length === 0;

		if (!isEmpty && blockStart < 0) {
			// 新块开始
			blockStart = i;
		} else if (isEmpty && blockStart >= 0) {
			// 块结束
			blocks.push({
				startLine: blockStart + 1, // 1-based
				endLine: i, // 1-based（指向最后一个非空行的下一行）
			});
			blockStart = -1;
		}
	}

	// 文档末尾未闭合的块
	if (blockStart >= 0) {
		blocks.push({
			startLine: blockStart + 1,
			endLine: lines.length,
		});
	}

	return blocks;
}

/**
 * 根据行范围提取行文本
 */
export function extractLines(
	lines: string[],
	startLine: number,
	endLine: number
): string {
	const start = Math.max(0, startLine - 1);
	const end = Math.min(lines.length, endLine);
	return lines.slice(start, end).join('\n');
}
