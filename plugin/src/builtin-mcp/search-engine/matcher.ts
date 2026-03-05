/**
 * Obsidian 风格搜索引擎 — AST 匹配器
 *
 * 针对单个文件评估搜索 AST，判断文件是否匹配并收集匹配详情。
 */

import { extractLines, parseBlocks, parseSections } from './markdown-structure';
import {
	FileContext,
	MarkdownBlock,
	MarkdownSection,
	PropertyComparator,
	SearchMatchDetail,
	SearchNode,
	SearchOperator,
	TaskItem,
} from './types';

// ─── 匹配结果 ─────────────────────────────────────────────

export interface MatchResult {
	matched: boolean;
	details: SearchMatchDetail[];
}

const MATCH_TRUE: MatchResult = { matched: true, details: [] };
const MATCH_FALSE: MatchResult = { matched: false, details: [] };

// ─── 文本匹配工具 ─────────────────────────────────────────

function buildTextMatcher(
	value: string,
	exact: boolean,
	caseSensitive: boolean
): (text: string) => boolean {
	if (!value) return () => true;
	if (caseSensitive) {
		return exact
			? (text: string) => text.includes(value)
			: (text: string) => text.includes(value);
	}
	const lower = value.toLowerCase();
	return (text: string) => text.toLowerCase().includes(lower);
}

function buildRegexMatcher(
	pattern: string,
	caseSensitive: boolean
): ((text: string) => boolean) | null {
	try {
		const flags = caseSensitive ? '' : 'i';
		const regex = new RegExp(pattern, flags);
		return (text: string) => regex.test(text);
	} catch {
		return null;
	}
}

/**
 * 从 SearchNode 提取纯文本匹配函数
 * 用于 line:/block:/section: 等需要在指定范围内匹配的操作符
 */
function nodeToTextMatcher(
	node: SearchNode,
	caseSensitive: boolean
): (text: string) => boolean {
	switch (node.type) {
	case 'text':
		return buildTextMatcher(node.value, node.exact, caseSensitive);

	case 'regex': {
		const matcher = buildRegexMatcher(node.pattern, caseSensitive);
		return matcher ?? (() => false);
	}

	case 'and':
		return (text: string) =>
			node.children.every((c) => nodeToTextMatcher(c, caseSensitive)(text));

	case 'or':
		return (text: string) =>
			node.children.some((c) => nodeToTextMatcher(c, caseSensitive)(text));

	case 'not':
		return (text: string) =>
			!nodeToTextMatcher(node.child, caseSensitive)(text);

	default:
		return () => true;
	}
}

// ─── 解析任务列表 ─────────────────────────────────────────

const TASK_PATTERN = /^(\s*[-*]\s+)\[( |x|X)\]\s+(.*)$/;

function parseTasksFromContent(content: string): TaskItem[] {
	const lines = content.split(/\r?\n/);
	const tasks: TaskItem[] = [];

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(TASK_PATTERN);
		if (match) {
			tasks.push({
				line: i + 1,
				text: match[3],
				completed: match[2].toLowerCase() === 'x',
			});
		}
	}

	return tasks;
}

// ─── 上下文行提取 ─────────────────────────────────────────

function buildMatchDetail(
	lines: string[],
	lineIndex: number,
	matchText: string,
	contextLines: number
): SearchMatchDetail {
	const start = Math.max(0, lineIndex - contextLines);
	const end = Math.min(lines.length - 1, lineIndex + contextLines);

	return {
		line: lineIndex + 1,
		lineText: lines[lineIndex],
		matchText,
		contextBefore: lines.slice(start, lineIndex),
		contextAfter: lines.slice(lineIndex + 1, end + 1),
	};
}

// ─── 主评估函数 ───────────────────────────────────────────

export interface MatcherOptions {
	caseSensitive: boolean;
	contextLines: number;
}

/**
 * 评估 AST 节点对文件的匹配
 */
export async function evaluateNode(
	node: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	switch (node.type) {
	case 'text':
		return evaluateText(node.value, node.exact, ctx, options);

	case 'regex':
		return evaluateRegex(node.pattern, ctx, options);

	case 'and': {
		const allDetails: SearchMatchDetail[] = [];
		for (const child of node.children) {
			const result = await evaluateNode(child, ctx, options);
			if (!result.matched) return MATCH_FALSE;
			allDetails.push(...result.details);
		}
		return { matched: true, details: allDetails };
	}

	case 'or': {
		for (const child of node.children) {
			const result = await evaluateNode(child, ctx, options);
			if (result.matched) return result;
		}
		return MATCH_FALSE;
	}

	case 'not': {
		const result = await evaluateNode(node.child, ctx, options);
		return result.matched ? MATCH_FALSE : MATCH_TRUE;
	}

	case 'operator':
		return evaluateOperator(node.operator, node.child, ctx, options);

	case 'property':
		return evaluateProperty(node.property, node.comparator, ctx);
	}
}

// ─── 文本匹配 ─────────────────────────────────────────────

async function evaluateText(
	value: string,
	exact: boolean,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	if (!value) return MATCH_TRUE;

	const matcher = buildTextMatcher(value, exact, options.caseSensitive);

	// 先检查文件名
	if (matcher(ctx.name)) {
		return {
			matched: true,
			details: [{
				line: 0,
				lineText: ctx.name,
				matchText: value,
				contextBefore: [],
				contextAfter: [],
			}],
		};
	}

	// 检查文件内容
	const content = await ctx.getContent();
	const lines = content.split(/\r?\n/);
	const details: SearchMatchDetail[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (matcher(lines[i])) {
			details.push(buildMatchDetail(lines, i, value, options.contextLines));
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}

	return MATCH_FALSE;
}

// ─── 正则匹配 ─────────────────────────────────────────────

async function evaluateRegex(
	pattern: string,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	const matcher = buildRegexMatcher(pattern, options.caseSensitive);
	if (!matcher) return MATCH_FALSE;

	// 检查文件名
	if (matcher(ctx.name)) {
		return {
			matched: true,
			details: [{
				line: 0,
				lineText: ctx.name,
				matchText: pattern,
				contextBefore: [],
				contextAfter: [],
			}],
		};
	}

	// 检查文件内容
	const content = await ctx.getContent();
	const lines = content.split(/\r?\n/);
	const details: SearchMatchDetail[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (matcher(lines[i])) {
			details.push(buildMatchDetail(lines, i, pattern, options.contextLines));
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}

	return MATCH_FALSE;
}

// ─── 操作符匹配 ───────────────────────────────────────────

async function evaluateOperator(
	operator: SearchOperator,
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	switch (operator) {
	case SearchOperator.FILE:
		return evaluateFileOp(child, ctx, options);

	case SearchOperator.PATH:
		return evaluatePathOp(child, ctx, options);

	case SearchOperator.FOLDER:
		return evaluateFolderOp(child, ctx, options);

	case SearchOperator.CONTENT:
		return evaluateContentOp(child, ctx, options);

	case SearchOperator.TAG:
		return evaluateTagOp(child, ctx, options);

	case SearchOperator.LINE:
		return evaluateLineOp(child, ctx, options);

	case SearchOperator.BLOCK:
		return evaluateBlockOp(child, ctx, options);

	case SearchOperator.SECTION:
		return evaluateSectionOp(child, ctx, options);

	case SearchOperator.TASK:
		return evaluateTaskOp(child, ctx, options, 'all');

	case SearchOperator.TASK_TODO:
		return evaluateTaskOp(child, ctx, options, 'todo');

	case SearchOperator.TASK_DONE:
		return evaluateTaskOp(child, ctx, options, 'done');

	case SearchOperator.MATCH_CASE:
		return evaluateNode(child, ctx, { ...options, caseSensitive: true });

	case SearchOperator.IGNORE_CASE:
		return evaluateNode(child, ctx, { ...options, caseSensitive: false });
	}
}

// ── file: — 在文件名（basename）中匹配 ───────────────────

function evaluateFileOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): MatchResult {
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	if (matcher(ctx.basename) || matcher(ctx.name)) {
		return {
			matched: true,
			details: [{
				line: 0,
				lineText: ctx.name,
				matchText: ctx.name,
				contextBefore: [],
				contextAfter: [],
			}],
		};
	}
	return MATCH_FALSE;
}

// ── folder: — 按文件夹名称匹配 ────────────────────────────

function evaluateFolderOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): MatchResult {
	const matcher = nodeToTextMatcher(child, options.caseSensitive);

	// 文件夹上下文：直接匹配自身名称和路径
	if (ctx.isFolder) {
		if (matcher(ctx.name) || matcher(ctx.path)) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: ctx.path,
					matchText: ctx.name,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
		return MATCH_FALSE;
	}

	// 文件上下文：匹配路径中的文件夹名段
	const lastSlash = ctx.path.lastIndexOf('/');
	if (lastSlash < 0) return MATCH_FALSE;

	const dirPath = ctx.path.substring(0, lastSlash);
	const segments = dirPath.split('/');

	for (const seg of segments) {
		if (matcher(seg)) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: ctx.path,
					matchText: seg,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
	}

	// 也尝试匹配整个目录路径
	if (matcher(dirPath)) {
		return {
			matched: true,
			details: [{
				line: 0,
				lineText: ctx.path,
				matchText: dirPath,
				contextBefore: [],
				contextAfter: [],
			}],
		};
	}

	return MATCH_FALSE;
}

// ── path: — 在完整路径中匹配（含文件夹名） ────────────────

function evaluatePathOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): MatchResult {
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	if (matcher(ctx.path)) {
		return {
			matched: true,
			details: [{
				line: 0,
				lineText: ctx.path,
				matchText: ctx.path,
				contextBefore: [],
				contextAfter: [],
			}],
		};
	}
	return MATCH_FALSE;
}

// ── content: — 仅在文件内容中匹配 ────────────────────────

async function evaluateContentOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	const content = await ctx.getContent();
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	const lines = content.split(/\r?\n/);
	const details: SearchMatchDetail[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (matcher(lines[i])) {
			details.push(buildMatchDetail(lines, i, '', options.contextLines));
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}
	return MATCH_FALSE;
}

// ── tag: — 在标签列表中匹配 ──────────────────────────────

function evaluateTagOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): MatchResult {
	const tags = ctx.getTags();
	const matcher = nodeToTextMatcher(child, options.caseSensitive);

	for (const tag of tags) {
		if (matcher(tag)) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: tag,
					matchText: tag,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
	}
	return MATCH_FALSE;
}

// ── line: — 找到至少一行同时匹配所有子条件 ────────────────

async function evaluateLineOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	const content = await ctx.getContent();
	const lines = content.split(/\r?\n/);
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	const details: SearchMatchDetail[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (matcher(lines[i])) {
			details.push(buildMatchDetail(lines, i, '', options.contextLines));
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}
	return MATCH_FALSE;
}

// ── block: — 找到同一个块内匹配所有子条件 ────────────────

async function evaluateBlockOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	const content = await ctx.getContent();
	const lines = content.split(/\r?\n/);
	const blocks: MarkdownBlock[] = parseBlocks(content);
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	const details: SearchMatchDetail[] = [];

	for (const block of blocks) {
		const blockText = extractLines(lines, block.startLine, block.endLine);
		if (matcher(blockText)) {
			// 找到块内具体匹配行
			for (let i = block.startLine - 1; i < block.endLine && i < lines.length; i++) {
				if (nodeToLeafMatcher(child, options.caseSensitive)(lines[i])) {
					details.push(buildMatchDetail(lines, i, '', options.contextLines));
				}
			}
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}
	return MATCH_FALSE;
}

// ── section: — 找到同一章节内匹配所有子条件 ──────────────

async function evaluateSectionOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions
): Promise<MatchResult> {
	const content = await ctx.getContent();
	const lines = content.split(/\r?\n/);
	const sections: MarkdownSection[] = parseSections(content);
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	const details: SearchMatchDetail[] = [];

	for (const section of sections) {
		const sectionText = extractLines(lines, section.startLine, section.endLine);
		if (matcher(sectionText)) {
			// 找到章节内具体匹配行
			for (let i = section.startLine - 1; i < section.endLine && i < lines.length; i++) {
				if (nodeToLeafMatcher(child, options.caseSensitive)(lines[i])) {
					details.push(buildMatchDetail(lines, i, '', options.contextLines));
				}
			}
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}
	return MATCH_FALSE;
}

// ── task: / task-todo: / task-done: — 任务匹配 ──────────

async function evaluateTaskOp(
	child: SearchNode,
	ctx: FileContext,
	options: MatcherOptions,
	filter: 'all' | 'todo' | 'done'
): Promise<MatchResult> {
	const content = await ctx.getContent();
	const tasks = parseTasksFromContent(content);
	const matcher = nodeToTextMatcher(child, options.caseSensitive);
	const lines = content.split(/\r?\n/);
	const details: SearchMatchDetail[] = [];

	for (const task of tasks) {
		if (filter === 'todo' && task.completed) continue;
		if (filter === 'done' && !task.completed) continue;

		if (matcher(task.text)) {
			const lineIndex = task.line - 1;
			if (lineIndex >= 0 && lineIndex < lines.length) {
				details.push(
					buildMatchDetail(lines, lineIndex, task.text, options.contextLines)
				);
			}
		}
	}

	if (details.length > 0) {
		return { matched: true, details };
	}
	return MATCH_FALSE;
}

// ─── 属性匹配 ─────────────────────────────────────────────

function evaluateProperty(
	property: string,
	comparator: PropertyComparator | null,
	ctx: FileContext
): MatchResult {
	const properties = ctx.getProperties();
	const propLower = property.toLowerCase();

	// 查找属性（不区分大小写）
	const matchedKey = Object.keys(properties).find(
		(key) => key.toLowerCase() === propLower
	);

	// [property] — 仅检查属性是否存在
	if (!comparator) {
		if (matchedKey !== undefined) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: `${matchedKey}: ${String(properties[matchedKey] ?? '')}`,
					matchText: property,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
		return MATCH_FALSE;
	}

	// 属性不存在
	if (matchedKey === undefined) return MATCH_FALSE;

	const value = properties[matchedKey];

	switch (comparator.kind) {
	case 'null':
		// [property:null] — 属性存在但值为空
		if (value === null || value === undefined || value === '') {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: `${matchedKey}: null`,
					matchText: property,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
		return MATCH_FALSE;

	case 'eq': {
		const matched = matchPropertyValue(value, comparator.value);
		if (matched) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: `${matchedKey}: ${String(value)}`,
					matchText: `${property}:${comparator.value}`,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
		return MATCH_FALSE;
	}

	case 'gt':
	case 'lt':
	case 'gte':
	case 'lte': {
		const numValue = Number(value);
		if (!Number.isFinite(numValue)) return MATCH_FALSE;
		const target = comparator.value;
		let result = false;
		if (comparator.kind === 'gt') result = numValue > target;
		else if (comparator.kind === 'lt') result = numValue < target;
		else if (comparator.kind === 'gte') result = numValue >= target;
		else if (comparator.kind === 'lte') result = numValue <= target;

		if (result) {
			return {
				matched: true,
				details: [{
					line: 0,
					lineText: `${matchedKey}: ${String(value)}`,
					matchText: `${property}:${comparator.kind}${target}`,
					contextBefore: [],
					contextAfter: [],
				}],
			};
		}
		return MATCH_FALSE;
	}
	}
}

/**
 * 匹配属性值：支持字符串值和数组值
 * 数组中任意元素匹配即为匹配
 */
function matchPropertyValue(actual: unknown, expected: string): boolean {
	if (Array.isArray(actual)) {
		return actual.some((item) =>
			String(item).toLowerCase().includes(expected.toLowerCase())
		);
	}
	return String(actual ?? '').toLowerCase().includes(expected.toLowerCase());
}

/**
 * 为 block:/section: 内部行级匹配提取叶子匹配器
 * 匹配 AND 的任一叶子节点（用于高亮具体行）
 */
function nodeToLeafMatcher(
	node: SearchNode,
	caseSensitive: boolean
): (text: string) => boolean {
	switch (node.type) {
	case 'text':
		return buildTextMatcher(node.value, node.exact, caseSensitive);
	case 'regex': {
		const m = buildRegexMatcher(node.pattern, caseSensitive);
		return m ?? (() => false);
	}
	case 'and':
		// block:/section: 内 AND 意味着所有子条件都要在同一范围出现
		// 但具体行高亮时，匹配任一子条件的行
		return (text: string) =>
			node.children.some((c) => nodeToLeafMatcher(c, caseSensitive)(text));
	case 'or':
		return (text: string) =>
			node.children.some((c) => nodeToLeafMatcher(c, caseSensitive)(text));
	case 'not':
		return () => false; // NOT 节点不产生正向匹配
	default:
		return () => false;
	}
}
