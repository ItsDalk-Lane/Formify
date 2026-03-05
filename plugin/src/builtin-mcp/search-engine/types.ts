/**
 * Obsidian 风格搜索引擎 — 类型定义
 *
 * 定义搜索查询 AST、匹配结果、搜索选项等核心类型。
 */

// ─── 搜索操作符枚举 ───────────────────────────────────────

export enum SearchOperator {
	FILE = 'file',
	PATH = 'path',
	FOLDER = 'folder',
	CONTENT = 'content',
	TAG = 'tag',
	LINE = 'line',
	BLOCK = 'block',
	SECTION = 'section',
	TASK = 'task',
	TASK_TODO = 'task-todo',
	TASK_DONE = 'task-done',
	MATCH_CASE = 'match-case',
	IGNORE_CASE = 'ignore-case',
}

// ─── AST 节点类型 ─────────────────────────────────────────

export interface AndNode {
	type: 'and';
	children: SearchNode[];
}

export interface OrNode {
	type: 'or';
	children: SearchNode[];
}

export interface NotNode {
	type: 'not';
	child: SearchNode;
}

/** 纯文本词 */
export interface TextNode {
	type: 'text';
	value: string;
	/** 是否为引号包裹的精确短语 */
	exact: boolean;
}

/** 正则表达式 /pattern/ */
export interface RegexNode {
	type: 'regex';
	pattern: string;
}

/**
 * 操作符节点，如 file:xxx、line:(foo bar)
 * child 是操作符应用的子查询
 */
export interface OperatorNode {
	type: 'operator';
	operator: SearchOperator;
	child: SearchNode;
}

/**
 * 属性匹配节点
 * - [property] — 文件包含该属性
 * - [property:value] — 属性值匹配
 * - [property:>5] — 数值比较
 */
export interface PropertyNode {
	type: 'property';
	property: string;
	comparator: PropertyComparator | null;
}

export type PropertyComparator =
	| { kind: 'eq'; value: string }
	| { kind: 'gt'; value: number }
	| { kind: 'lt'; value: number }
	| { kind: 'gte'; value: number }
	| { kind: 'lte'; value: number }
	| { kind: 'null' };

export type SearchNode =
	| AndNode
	| OrNode
	| NotNode
	| TextNode
	| RegexNode
	| OperatorNode
	| PropertyNode;

// ─── 匹配结果 ─────────────────────────────────────────────

export interface SearchMatchDetail {
	/** 匹配位置行号（1-based），若不适用则为 0 */
	line: number;
	/** 匹配所在行文本 */
	lineText: string;
	/** 匹配的具体文本片段 */
	matchText: string;
	/** 上下文（匹配行前后的行） */
	contextBefore: string[];
	contextAfter: string[];
}

export interface FileSearchResult {
	path: string;
	name: string;
	size: number;
	mtime: number;
	ctime: number;
	matches: SearchMatchDetail[];
}

export interface SearchResult {
	query: string;
	results: FileSearchResult[];
	totalFiles: number;
	totalMatches: number;
	truncated: boolean;
	explain?: string;
}

// ─── 搜索选项 ─────────────────────────────────────────────

export type SortOrder =
	| 'path-asc'
	| 'path-desc'
	| 'mtime-new'
	| 'mtime-old'
	| 'ctime-new'
	| 'ctime-old';

export interface SearchOptions {
	maxResults: number;
	contextLines: number;
	sortBy: SortOrder;
	explain: boolean;
}

// ─── 文件上下文（供匹配器使用） ────────────────────────────

export interface FileContext {
	path: string;
	name: string;
	basename: string;
	extension: string;
	size: number;
	mtime: number;
	ctime: number;
	/** 是否为文件夹上下文 */
	isFolder?: boolean;
	/** 懒加载：文件纯文本内容 */
	getContent: () => Promise<string>;
	/** 懒加载：文件的标签列表（含 # 前缀） */
	getTags: () => string[];
	/** 懒加载：文件属性 (frontmatter) 键值对 */
	getProperties: () => Record<string, unknown>;
}

// ─── Markdown 结构类型 ────────────────────────────────────

export interface MarkdownSection {
	heading: string;
	level: number;
	/** 起始行号（1-based，含 heading 行） */
	startLine: number;
	/** 结束行号（1-based，含） */
	endLine: number;
}

export interface MarkdownBlock {
	/** 起始行号（1-based） */
	startLine: number;
	/** 结束行号（1-based） */
	endLine: number;
}

export interface TaskItem {
	line: number;
	text: string;
	completed: boolean;
}
