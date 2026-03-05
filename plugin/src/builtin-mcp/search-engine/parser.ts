/**
 * Obsidian 风格搜索引擎 — 查询语法解析器
 *
 * 递归下降解析器，将 Obsidian 搜索查询字符串转换为 AST。
 *
 * 支持的语法：
 * - 纯文本词（隐式 AND）
 * - "引号短语"
 * - /正则表达式/
 * - OR 操作符
 * - -word（NOT）
 * - (分组)
 * - 搜索操作符 file: path: folder: content: tag: line: block: section:
 *   task: task-todo: task-done: match-case: ignore-case:
 * - 属性语法 [property] [property:value] [property:>5]
 */

import {
	AndNode,
	NotNode,
	OperatorNode,
	OrNode,
	PropertyComparator,
	PropertyNode,
	RegexNode,
	SearchNode,
	SearchOperator,
	TextNode,
} from './types';

// ─── Token 类型 ───────────────────────────────────────────

enum TokenType {
	WORD = 'WORD',
	QUOTED = 'QUOTED',
	REGEX = 'REGEX',
	OR = 'OR',
	NOT = 'NOT',
	LPAREN = 'LPAREN',
	RPAREN = 'RPAREN',
	OPERATOR = 'OPERATOR',
	PROPERTY = 'PROPERTY',
}

interface WordToken {
	type: TokenType.WORD;
	value: string;
}

interface QuotedToken {
	type: TokenType.QUOTED;
	value: string;
}

interface RegexToken {
	type: TokenType.REGEX;
	pattern: string;
}

interface OrToken {
	type: TokenType.OR;
}

interface NotToken {
	type: TokenType.NOT;
}

interface LParenToken {
	type: TokenType.LPAREN;
}

interface RParenToken {
	type: TokenType.RPAREN;
}

interface OperatorToken {
	type: TokenType.OPERATOR;
	operator: SearchOperator;
}

interface PropertyToken {
	type: TokenType.PROPERTY;
	property: string;
	comparator: PropertyComparator | null;
}

type Token =
	| WordToken
	| QuotedToken
	| RegexToken
	| OrToken
	| NotToken
	| LParenToken
	| RParenToken
	| OperatorToken
	| PropertyToken;

// ─── 操作符关键字映射 ─────────────────────────────────────

const OPERATOR_KEYWORDS: Record<string, SearchOperator> = {
	'file:': SearchOperator.FILE,
	'path:': SearchOperator.PATH,
	'folder:': SearchOperator.FOLDER,
	'content:': SearchOperator.CONTENT,
	'tag:': SearchOperator.TAG,
	'line:': SearchOperator.LINE,
	'block:': SearchOperator.BLOCK,
	'section:': SearchOperator.SECTION,
	'task:': SearchOperator.TASK,
	'task-todo:': SearchOperator.TASK_TODO,
	'task-done:': SearchOperator.TASK_DONE,
	'match-case:': SearchOperator.MATCH_CASE,
	'ignore-case:': SearchOperator.IGNORE_CASE,
};

// ─── 词法分析 ─────────────────────────────────────────────

/**
 * 将查询字符串分解为 token 序列
 */
function tokenize(query: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;

	const skipWhitespace = (): void => {
		while (pos < query.length && /\s/.test(query[pos])) {
			pos++;
		}
	};

	while (pos < query.length) {
		skipWhitespace();
		if (pos >= query.length) break;

		const ch = query[pos];

		// 引号短语 "..."
		if (ch === '"') {
			const value = readQuotedString(query, pos);
			pos += value.raw.length;
			tokens.push({ type: TokenType.QUOTED, value: value.content });
			continue;
		}

		// 正则表达式 /.../
		if (ch === '/') {
			const result = readRegex(query, pos);
			if (result) {
				pos += result.raw.length;
				tokens.push({ type: TokenType.REGEX, pattern: result.pattern });
				continue;
			}
		}

		// 括号
		if (ch === '(') {
			tokens.push({ type: TokenType.LPAREN });
			pos++;
			continue;
		}
		if (ch === ')') {
			tokens.push({ type: TokenType.RPAREN });
			pos++;
			continue;
		}

		// 属性语法 [property] 或 [property:value]
		if (ch === '[') {
			const result = readPropertyBracket(query, pos);
			if (result) {
				pos += result.raw.length;
				tokens.push({
					type: TokenType.PROPERTY,
					property: result.property,
					comparator: result.comparator,
				});
				continue;
			}
		}

		// NOT: - 前缀（必须紧跟非空白字符）
		if (ch === '-' && pos + 1 < query.length && !/\s/.test(query[pos + 1])) {
			tokens.push({ type: TokenType.NOT });
			pos++;
			continue;
		}

		// 读取一个词（到空格或特殊字符为止）
		const word = readWord(query, pos);
		pos += word.length;

		// OR 关键字（独立的大写 OR）
		if (word === 'OR') {
			tokens.push({ type: TokenType.OR });
			continue;
		}

		// 操作符关键字（如 file: path: 等）
		const operatorKey = Object.keys(OPERATOR_KEYWORDS).find(
			(key) => word.toLowerCase() === key.slice(0, -1) + ':'
				|| word.toLowerCase() + ':' === key
		);

		// 更精确的匹配：检查 word 最后是否为 ':'
		if (word.endsWith(':')) {
			const normalizedKey = word.toLowerCase();
			const op = OPERATOR_KEYWORDS[normalizedKey];
			if (op !== undefined) {
				tokens.push({ type: TokenType.OPERATOR, operator: op });
				continue;
			}
		}

		// 也可能 word 包含操作符前缀，如 "file:readme"
		const colonIndex = word.indexOf(':');
		if (colonIndex > 0) {
			const prefix = word.slice(0, colonIndex + 1).toLowerCase();
			const op = OPERATOR_KEYWORDS[prefix];
			if (op !== undefined) {
				const rest = word.slice(colonIndex + 1);
				tokens.push({ type: TokenType.OPERATOR, operator: op });
				if (rest.length > 0) {
					tokens.push({ type: TokenType.WORD, value: rest });
				}
				continue;
			}
		}

		if (word.length > 0) {
			tokens.push({ type: TokenType.WORD, value: word });
		}
	}

	return tokens;
}

function readQuotedString(
	query: string,
	startPos: number
): { content: string; raw: string } {
	let pos = startPos + 1; // 跳过开头的 "
	let content = '';

	while (pos < query.length) {
		const ch = query[pos];
		if (ch === '\\' && pos + 1 < query.length && query[pos + 1] === '"') {
			content += '"';
			pos += 2;
			continue;
		}
		if (ch === '"') {
			pos++;
			break;
		}
		content += ch;
		pos++;
	}

	return {
		content,
		raw: query.slice(startPos, pos),
	};
}

function readRegex(
	query: string,
	startPos: number
): { pattern: string; raw: string } | null {
	let pos = startPos + 1; // 跳过开头的 /
	let pattern = '';
	let escaped = false;

	while (pos < query.length) {
		const ch = query[pos];
		if (escaped) {
			pattern += ch;
			escaped = false;
			pos++;
			continue;
		}
		if (ch === '\\') {
			pattern += ch;
			escaped = true;
			pos++;
			continue;
		}
		if (ch === '/') {
			pos++;
			// 无效的空正则
			if (pattern.length === 0) return null;
			return {
				pattern,
				raw: query.slice(startPos, pos),
			};
		}
		pattern += ch;
		pos++;
	}

	// 没有闭合的 /，不视为正则
	return null;
}

function readPropertyBracket(
	query: string,
	startPos: number
): { property: string; comparator: PropertyComparator | null; raw: string } | null {
	let pos = startPos + 1; // 跳过 [
	let bracketContent = '';

	while (pos < query.length) {
		if (query[pos] === ']') {
			pos++;
			break;
		}
		bracketContent += query[pos];
		pos++;
	}

	if (bracketContent.length === 0) return null;

	// 解析 [property] 或 [property:value]
	const colonIdx = bracketContent.indexOf(':');
	if (colonIdx < 0) {
		return {
			property: bracketContent.trim(),
			comparator: null,
			raw: query.slice(startPos, pos),
		};
	}

	const property = bracketContent.slice(0, colonIdx).trim();
	const rawValue = bracketContent.slice(colonIdx + 1).trim();

	if (!property) return null;

	const comparator = parsePropertyComparator(rawValue);
	return {
		property,
		comparator,
		raw: query.slice(startPos, pos),
	};
}

function parsePropertyComparator(rawValue: string): PropertyComparator {
	if (rawValue.toLowerCase() === 'null') {
		return { kind: 'null' };
	}
	if (rawValue.startsWith('>=')) {
		const num = Number(rawValue.slice(2).trim());
		if (Number.isFinite(num)) return { kind: 'gte', value: num };
	}
	if (rawValue.startsWith('<=')) {
		const num = Number(rawValue.slice(2).trim());
		if (Number.isFinite(num)) return { kind: 'lte', value: num };
	}
	if (rawValue.startsWith('>')) {
		const num = Number(rawValue.slice(1).trim());
		if (Number.isFinite(num)) return { kind: 'gt', value: num };
	}
	if (rawValue.startsWith('<')) {
		const num = Number(rawValue.slice(1).trim());
		if (Number.isFinite(num)) return { kind: 'lt', value: num };
	}
	return { kind: 'eq', value: rawValue };
}

function readWord(query: string, startPos: number): string {
	let pos = startPos;
	while (pos < query.length) {
		const ch = query[pos];
		if (/\s/.test(ch) || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
			break;
		}
		pos++;
	}
	return query.slice(startPos, pos);
}

// ─── 语法分析（递归下降） ─────────────────────────────────

/**
 * 解析查询字符串为 AST
 *
 * 语法优先级（低→高）：OR → AND（隐式） → NOT → 原子
 */
export function parseSearchQuery(query: string): SearchNode {
	const trimmed = query.trim();
	if (!trimmed) {
		return { type: 'text', value: '', exact: false };
	}

	const tokens = tokenize(trimmed);
	if (tokens.length === 0) {
		return { type: 'text', value: '', exact: false };
	}

	const state = { tokens, pos: 0 };
	const node = parseOr(state);
	return node;
}

interface ParserState {
	tokens: Token[];
	pos: number;
}

function peek(state: ParserState): Token | null {
	return state.pos < state.tokens.length ? state.tokens[state.pos] : null;
}

function advance(state: ParserState): Token | null {
	if (state.pos < state.tokens.length) {
		return state.tokens[state.pos++];
	}
	return null;
}

/**
 * 解析 OR 表达式：and_expr (OR and_expr)*
 */
function parseOr(state: ParserState): SearchNode {
	const left = parseAnd(state);
	const children: SearchNode[] = [left];

	while (peek(state)?.type === TokenType.OR) {
		advance(state); // 消费 OR
		children.push(parseAnd(state));
	}

	if (children.length === 1) return children[0];
	return { type: 'or', children } as OrNode;
}

/**
 * 解析 AND 表达式（隐式 AND）：not_expr not_expr ...
 * 多个词紧邻 = AND 关系
 */
function parseAnd(state: ParserState): SearchNode {
	const children: SearchNode[] = [];

	while (true) {
		const token = peek(state);
		// 碰到 OR、右括号、或结束则停止
		if (!token || token.type === TokenType.OR || token.type === TokenType.RPAREN) {
			break;
		}
		children.push(parseNot(state));
	}

	if (children.length === 0) {
		return { type: 'text', value: '', exact: false };
	}
	if (children.length === 1) return children[0];
	return { type: 'and', children } as AndNode;
}

/**
 * 解析 NOT 表达式：- atom
 */
function parseNot(state: ParserState): SearchNode {
	if (peek(state)?.type === TokenType.NOT) {
		advance(state); // 消费 -
		const child = parseAtom(state);
		return { type: 'not', child } as NotNode;
	}
	return parseAtom(state);
}

/**
 * 解析原子表达式：括号组、操作符、属性、引号、正则、普通词
 */
function parseAtom(state: ParserState): SearchNode {
	const token = peek(state);
	if (!token) {
		return { type: 'text', value: '', exact: false };
	}

	// 括号分组
	if (token.type === TokenType.LPAREN) {
		advance(state); // 消费 (
		const node = parseOr(state);
		if (peek(state)?.type === TokenType.RPAREN) {
			advance(state); // 消费 )
		}
		return node;
	}

	// 操作符 file: path: 等
	if (token.type === TokenType.OPERATOR) {
		advance(state);
		const child = parseOperatorChild(state);
		return {
			type: 'operator',
			operator: token.operator,
			child,
		} as OperatorNode;
	}

	// 属性 [property:value]
	if (token.type === TokenType.PROPERTY) {
		advance(state);
		return {
			type: 'property',
			property: token.property,
			comparator: token.comparator,
		} as PropertyNode;
	}

	// 引号短语
	if (token.type === TokenType.QUOTED) {
		advance(state);
		return { type: 'text', value: token.value, exact: true } as TextNode;
	}

	// 正则
	if (token.type === TokenType.REGEX) {
		advance(state);
		return { type: 'regex', pattern: token.pattern } as RegexNode;
	}

	// 普通词
	if (token.type === TokenType.WORD) {
		advance(state);
		return { type: 'text', value: token.value, exact: false } as TextNode;
	}

	// 其他情况，跳过
	advance(state);
	return { type: 'text', value: '', exact: false };
}

/**
 * 解析操作符后的子表达式
 * 可以是括号分组 file:(foo bar)、引号 file:"readme"、正则 file:/pat/、或单词 file:readme
 */
function parseOperatorChild(state: ParserState): SearchNode {
	const token = peek(state);
	if (!token) {
		return { type: 'text', value: '', exact: false };
	}

	// 括号分组 operator:(sub-query)
	if (token.type === TokenType.LPAREN) {
		advance(state); // 消费 (
		const node = parseOr(state);
		if (peek(state)?.type === TokenType.RPAREN) {
			advance(state); // 消费 )
		}
		return node;
	}

	// 引号
	if (token.type === TokenType.QUOTED) {
		advance(state);
		return { type: 'text', value: token.value, exact: true } as TextNode;
	}

	// 正则
	if (token.type === TokenType.REGEX) {
		advance(state);
		return { type: 'regex', pattern: token.pattern } as RegexNode;
	}

	// 单词
	if (token.type === TokenType.WORD) {
		advance(state);
		return { type: 'text', value: token.value, exact: false } as TextNode;
	}

	return { type: 'text', value: '', exact: false };
}

// ─── 查询解释（可选） ─────────────────────────────────────

/**
 * 将 AST 转换为人类可读的自然语言解释
 */
export function explainQuery(node: SearchNode): string {
	switch (node.type) {
	case 'text':
		if (!node.value) return '(空)';
		return node.exact ? `精确匹配 "${node.value}"` : `包含 "${node.value}"`;

	case 'regex':
		return `正则匹配 /${node.pattern}/`;

	case 'and':
		return node.children.map((c) => explainQuery(c)).join(' 并且 ');

	case 'or':
		return node.children.map((c) => explainQuery(c)).join(' 或者 ');

	case 'not':
		return `不包含 (${explainQuery(node.child)})`;

	case 'operator':
		return `${operatorLabel(node.operator)}(${explainQuery(node.child)})`;

	case 'property': {
		if (!node.comparator) {
			return `属性 [${node.property}] 存在`;
		}
		switch (node.comparator.kind) {
		case 'null':
			return `属性 [${node.property}] 为空`;
		case 'eq':
			return `属性 [${node.property}] = "${node.comparator.value}"`;
		case 'gt':
			return `属性 [${node.property}] > ${node.comparator.value}`;
		case 'lt':
			return `属性 [${node.property}] < ${node.comparator.value}`;
		case 'gte':
			return `属性 [${node.property}] >= ${node.comparator.value}`;
		case 'lte':
			return `属性 [${node.property}] <= ${node.comparator.value}`;
		}
	}
	}
}

function operatorLabel(op: SearchOperator): string {
	const labels: Record<SearchOperator, string> = {
		[SearchOperator.FILE]: '文件名匹配',
		[SearchOperator.PATH]: '路径匹配',
		[SearchOperator.FOLDER]: '文件夹名匹配',
		[SearchOperator.CONTENT]: '内容匹配',
		[SearchOperator.TAG]: '标签匹配',
		[SearchOperator.LINE]: '同一行匹配',
		[SearchOperator.BLOCK]: '同一块匹配',
		[SearchOperator.SECTION]: '同一章节匹配',
		[SearchOperator.TASK]: '任务匹配',
		[SearchOperator.TASK_TODO]: '未完成任务匹配',
		[SearchOperator.TASK_DONE]: '已完成任务匹配',
		[SearchOperator.MATCH_CASE]: '区分大小写匹配',
		[SearchOperator.IGNORE_CASE]: '忽略大小写匹配',
	};
	return labels[op];
}
