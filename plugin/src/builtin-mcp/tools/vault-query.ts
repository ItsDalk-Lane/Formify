import { App, TFile } from 'obsidian';
import { localInstance } from 'src/i18n/locals';
import { DEFAULT_QUERY_MAX_ROWS } from '../constants';
import { resolveRegex } from './helpers';

type VaultQueryDataSource = 'file' | 'property' | 'tag' | 'task';

interface QueryMethodCall {
	name: string;
	args: string;
}

interface QueryPlan {
	select: QuerySelectItem[];
	from: VaultQueryDataSource;
	where?: ConditionNode;
	andGroups: ConditionNode[];
	orGroups: ConditionNode[];
	groupBy?: string;
	orderBy?: {
		field: string;
		direction: 'asc' | 'desc';
	};
	limit?: number;
	offset?: number;
}

type QuerySelectItem = QueryFieldSelectItem | QueryAggregateSelectItem;

interface QueryFieldSelectItem {
	kind: 'field';
	field: string;
	alias: string;
}

interface QueryAggregateSelectItem {
	kind: 'aggregate';
	func: 'count' | 'sum' | 'avg';
	field?: string;
	alias: string;
}

type ConditionNode =
	| ConditionIdentifierNode
	| ConditionLiteralNode
	| ConditionArrayNode
	| ConditionUnaryNode
	| ConditionBinaryNode;

interface ConditionIdentifierNode {
	type: 'identifier';
	name: string;
}

interface ConditionLiteralNode {
	type: 'literal';
	value: string | number | boolean | null;
}

interface ConditionArrayNode {
	type: 'array';
	items: ConditionLiteralNode[];
}

interface ConditionUnaryNode {
	type: 'unary';
	operator: '!';
	operand: ConditionNode;
}

interface ConditionBinaryNode {
	type: 'binary';
	operator:
		| '&&'
		| '||'
		| '=='
		| '!='
		| '>'
		| '>='
		| '<'
		| '<='
		| 'contains'
		| 'in'
		| 'matches';
	left: ConditionNode;
	right: ConditionNode;
}

interface ConditionToken {
	type:
		| 'identifier'
		| 'string'
		| 'number'
		| 'boolean'
		| 'null'
		| 'operator'
		| 'lparen'
		| 'rparen'
		| 'lbracket'
		| 'rbracket'
		| 'comma';
	value?: string | number | boolean | null;
}

interface VaultQueryDataset {
	rows: Array<Record<string, unknown>>;
	fields: string[];
}

interface PropertyInfoLike {
	name?: string;
	type?: string;
	widget?: string;
}

const DATA_SOURCE_FIELDS: Record<VaultQueryDataSource, string[]> = {
	file: ['path', 'name', 'basename', 'extension', 'size', 'created', 'modified', 'parent'],
	property: ['name', 'type', 'usageCount'],
	tag: ['tag', 'count', 'fileCount', 'firstSeen'],
	task: ['filePath', 'line', 'text', 'completed', 'status', 'parentLine', 'priority'],
};

const PRIORITY_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
	{ pattern: /⏫/, value: 'highest' },
	{ pattern: /🔺/, value: 'high' },
	{ pattern: /🔼/, value: 'medium' },
	{ pattern: /🔽/, value: 'low' },
	{ pattern: /⏬/, value: 'lowest' },
];

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const formatLocal = (template: string, ...values: Array<string | number>): string => {
	return values.reduce((text, value, index) => {
		return text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(value));
	}, template);
};

const createQueryError = (message: string): Error => {
	return new Error(message);
};

const wrapQueryError = (detail: string): Error => {
	return createQueryError(
		formatLocal(localInstance.mcp_fs_query_invalid_expression, detail)
	);
};

const stripWrappingQuotes = (input: string): string => {
	const trimmed = input.trim();
	if (trimmed.length < 2) return trimmed;
	const quote = trimmed[0];
	if ((quote === '"' || quote === '\'') && trimmed.endsWith(quote)) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
};

const splitTopLevel = (input: string, delimiter = ','): string[] => {
	const parts: string[] = [];
	let current = '';
	let parenDepth = 0;
	let bracketDepth = 0;
	let quote: '"' | '\'' | null = null;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		if (quote) {
			current += char;
			if (char === '\\') {
				if (index + 1 < input.length) {
					current += input[index + 1];
					index += 1;
				}
				continue;
			}
			if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === '"' || char === '\'') {
			quote = char;
			current += char;
			continue;
		}

		if (char === '(') {
			parenDepth += 1;
			current += char;
			continue;
		}
		if (char === ')') {
			parenDepth = Math.max(0, parenDepth - 1);
			current += char;
			continue;
		}
		if (char === '[') {
			bracketDepth += 1;
			current += char;
			continue;
		}
		if (char === ']') {
			bracketDepth = Math.max(0, bracketDepth - 1);
			current += char;
			continue;
		}

		if (char === delimiter && parenDepth === 0 && bracketDepth === 0) {
			if (current.trim()) {
				parts.push(current.trim());
			}
			current = '';
			continue;
		}

		current += char;
	}

	if (current.trim()) {
		parts.push(current.trim());
	}

	return parts;
};

const readBalancedSegment = (
	input: string,
	startIndex: number
): { content: string; nextIndex: number } => {
	let depth = 1;
	let quote: '"' | '\'' | null = null;

	for (let index = startIndex + 1; index < input.length; index += 1) {
		const char = input[index];
		if (quote) {
			if (char === '\\') {
				index += 1;
				continue;
			}
			if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === '"' || char === '\'') {
			quote = char;
			continue;
		}

		if (char === '(') {
			depth += 1;
			continue;
		}
		if (char === ')') {
			depth -= 1;
			if (depth === 0) {
				return {
					content: input.slice(startIndex + 1, index),
					nextIndex: index + 1,
				};
			}
		}
	}

	throw wrapQueryError('括号未正确闭合');
};

const parseMethodChain = (expression: string): QueryMethodCall[] => {
	const trimmed = String(expression ?? '').trim();
	if (!trimmed) {
		throw wrapQueryError('查询表达式不能为空');
	}

	const calls: QueryMethodCall[] = [];
	let index = 0;

	while (index < trimmed.length) {
		while (/\s/.test(trimmed[index] ?? '')) {
			index += 1;
		}

		const identifierStart = index;
		while (/[A-Za-z]/.test(trimmed[index] ?? '')) {
			index += 1;
		}
		const name = trimmed.slice(identifierStart, index);
		if (!name) {
			throw wrapQueryError(`第 ${index + 1} 个字符附近缺少方法名`);
		}

		while (/\s/.test(trimmed[index] ?? '')) {
			index += 1;
		}
		if (trimmed[index] !== '(') {
			throw wrapQueryError(`方法 ${name} 缺少参数括号`);
		}

		const segment = readBalancedSegment(trimmed, index);
		calls.push({
			name,
			args: segment.content.trim(),
		});
		index = segment.nextIndex;

		while (/\s/.test(trimmed[index] ?? '')) {
			index += 1;
		}

		if (index >= trimmed.length) {
			break;
		}
		if (trimmed[index] !== '.') {
			throw wrapQueryError(`方法 ${name} 之后缺少链式分隔符 .`);
		}
		index += 1;
	}

	return calls;
};

const parseSelectItem = (input: string): QuerySelectItem => {
	const aggregateMatch = input.match(
		/^(count\(\)|sum\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|avg\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\))(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/i
	);
	if (aggregateMatch) {
		const func = aggregateMatch[1].slice(0, aggregateMatch[1].indexOf('(')).toLowerCase() as
			| 'count'
			| 'sum'
			| 'avg';
		const field = aggregateMatch[2] || aggregateMatch[3] || undefined;
		if ((func === 'sum' || func === 'avg') && !field) {
			throw createQueryError(
				formatLocal(localInstance.mcp_fs_query_invalid_aggregate, input)
			);
		}
		return {
			kind: 'aggregate',
			func,
			field,
			alias:
				aggregateMatch[4]
				|| (func === 'count' ? 'count' : `${func}_${field}`),
		};
	}

	const fieldAliasMatch = input.match(
		/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/i
	);
	if (!fieldAliasMatch) {
		throw createQueryError(
			formatLocal(localInstance.mcp_fs_query_invalid_select, input)
		);
	}

	return {
		kind: 'field',
		field: fieldAliasMatch[1],
		alias: fieldAliasMatch[2] || fieldAliasMatch[1],
	};
};

const parseLimitValue = (value: string, methodName: 'limit' | 'offset'): number => {
	const normalized = stripWrappingQuotes(value);
	if (!/^\d+$/.test(normalized)) {
		throw wrapQueryError(`${methodName} 只接受非负整数`);
	}
	return Number(normalized);
};

const parseOrderBy = (
	value: string
): { field: string; direction: 'asc' | 'desc' } => {
	const normalized = stripWrappingQuotes(value);
	const parts = normalized.split(/\s+/).filter(Boolean);
	if (parts.length === 0 || parts.length > 2 || !IDENTIFIER_REGEX.test(parts[0])) {
		throw wrapQueryError(`orderBy 参数无效: ${value}`);
	}
	const direction =
		parts[1]?.toLowerCase() === 'desc'
			? 'desc'
			: 'asc';
	if (parts[1] && !['asc', 'desc'].includes(parts[1].toLowerCase())) {
		throw wrapQueryError(`orderBy 排序方向无效: ${parts[1]}`);
	}
	return {
		field: parts[0],
		direction,
	};
};

const parseQueryPlan = (expression: string): QueryPlan => {
	const calls = parseMethodChain(expression);
	const plan: QueryPlan = {
		select: [],
		from: 'file',
		andGroups: [],
		orGroups: [],
	};

	let hasSelect = false;
	let hasFrom = false;
	let hasWhere = false;
	let hasGroupBy = false;
	let hasOrderBy = false;
	let hasLimit = false;
	let hasOffset = false;

	for (const call of calls) {
		switch (call.name) {
			case 'select': {
				if (hasSelect) {
					throw wrapQueryError('select 只能出现一次');
				}
				const items = splitTopLevel(call.args).map(parseSelectItem);
				if (items.length === 0) {
					throw wrapQueryError('select 至少需要一个字段');
				}
				plan.select = items;
				hasSelect = true;
				break;
			}
			case 'from': {
				if (hasFrom) {
					throw wrapQueryError('from 只能出现一次');
				}
				const source = stripWrappingQuotes(call.args) as VaultQueryDataSource;
				if (!['file', 'property', 'tag', 'task'].includes(source)) {
					throw createQueryError(
						formatLocal(localInstance.mcp_fs_query_invalid_source, source)
					);
				}
				plan.from = source;
				hasFrom = true;
				break;
			}
			case 'where': {
				if (hasWhere) {
					throw wrapQueryError('where 只能出现一次');
				}
				plan.where = parseConditionExpression(stripWrappingQuotes(call.args));
				hasWhere = true;
				break;
			}
			case 'andGroup': {
				plan.andGroups.push(
					parseConditionExpression(stripWrappingQuotes(call.args))
				);
				break;
			}
			case 'orGroup': {
				plan.orGroups.push(
					parseConditionExpression(stripWrappingQuotes(call.args))
				);
				break;
			}
			case 'groupBy': {
				if (hasGroupBy) {
					throw wrapQueryError('groupBy 只能出现一次');
				}
				const field = stripWrappingQuotes(call.args);
				if (!IDENTIFIER_REGEX.test(field)) {
					throw wrapQueryError(`groupBy 字段无效: ${field}`);
				}
				plan.groupBy = field;
				hasGroupBy = true;
				break;
			}
			case 'orderBy': {
				if (hasOrderBy) {
					throw wrapQueryError('orderBy 只能出现一次');
				}
				plan.orderBy = parseOrderBy(call.args);
				hasOrderBy = true;
				break;
			}
			case 'limit': {
				if (hasLimit) {
					throw wrapQueryError('limit 只能出现一次');
				}
				plan.limit = parseLimitValue(call.args, 'limit');
				hasLimit = true;
				break;
			}
			case 'offset': {
				if (hasOffset) {
					throw wrapQueryError('offset 只能出现一次');
				}
				plan.offset = parseLimitValue(call.args, 'offset');
				hasOffset = true;
				break;
			}
			default:
				throw createQueryError(
					formatLocal(localInstance.mcp_fs_query_invalid_method, call.name)
				);
		}
	}

	if (!hasSelect) {
		throw createQueryError(localInstance.mcp_fs_query_missing_select);
	}
	if (!hasFrom) {
		throw createQueryError(localInstance.mcp_fs_query_missing_from);
	}

	const seenAliases = new Set<string>();
	for (const item of plan.select) {
		if (seenAliases.has(item.alias)) {
			throw createQueryError(
				formatLocal(localInstance.mcp_fs_query_duplicate_column, item.alias)
			);
		}
		seenAliases.add(item.alias);
	}

	return plan;
};

const tokenizeCondition = (input: string): ConditionToken[] => {
	const tokens: ConditionToken[] = [];
	let index = 0;

	while (index < input.length) {
		const char = input[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}

		const twoChars = input.slice(index, index + 2);
		if (['&&', '||', '==', '!=', '>=', '<='].includes(twoChars)) {
			tokens.push({ type: 'operator', value: twoChars });
			index += 2;
			continue;
		}

		if (char === '>' || char === '<' || char === '!') {
			tokens.push({ type: 'operator', value: char });
			index += 1;
			continue;
		}

		if (char === '(') {
			tokens.push({ type: 'lparen' });
			index += 1;
			continue;
		}
		if (char === ')') {
			tokens.push({ type: 'rparen' });
			index += 1;
			continue;
		}
		if (char === '[') {
			tokens.push({ type: 'lbracket' });
			index += 1;
			continue;
		}
		if (char === ']') {
			tokens.push({ type: 'rbracket' });
			index += 1;
			continue;
		}
		if (char === ',') {
			tokens.push({ type: 'comma' });
			index += 1;
			continue;
		}

		if (char === '"' || char === '\'') {
			let value = '';
			const quote = char;
			let closed = false;
			index += 1;
			while (index < input.length) {
				const inner = input[index];
				if (inner === '\\') {
					if (index + 1 >= input.length) {
						throw wrapQueryError('字符串转义不完整');
					}
					value += input[index + 1];
					index += 2;
					continue;
				}
				if (inner === quote) {
					index += 1;
					closed = true;
					break;
				}
				value += inner;
				index += 1;
			}
			if (!closed) {
				throw wrapQueryError('字符串字面量未正确闭合');
			}
			tokens.push({ type: 'string', value });
			continue;
		}

		const numberMatch = input.slice(index).match(/^-?\d+(?:\.\d+)?/);
		if (numberMatch) {
			tokens.push({ type: 'number', value: Number(numberMatch[0]) });
			index += numberMatch[0].length;
			continue;
		}

		const identifierMatch = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
		if (identifierMatch) {
			const word = identifierMatch[0];
			if (word === 'true' || word === 'false') {
				tokens.push({ type: 'boolean', value: word === 'true' });
			} else if (word === 'null') {
				tokens.push({ type: 'null', value: null });
			} else if (['contains', 'in', 'matches'].includes(word)) {
				tokens.push({ type: 'operator', value: word });
			} else {
				tokens.push({ type: 'identifier', value: word });
			}
			index += word.length;
			continue;
		}

		throw wrapQueryError(`无法解析条件表达式中的字符: ${char}`);
	}

	return tokens;
};

class ConditionTokenStream {
	private index = 0;

	constructor(private readonly tokens: ConditionToken[]) {}

	peek(): ConditionToken | undefined {
		return this.tokens[this.index];
	}

	consume(): ConditionToken {
		const token = this.tokens[this.index];
		if (!token) {
			throw wrapQueryError('条件表达式意外结束');
		}
		this.index += 1;
		return token;
	}

	match(type: ConditionToken['type'], value?: ConditionToken['value']): boolean {
		const token = this.peek();
		if (!token || token.type !== type) {
			return false;
		}
		if (typeof value !== 'undefined' && token.value !== value) {
			return false;
		}
		this.index += 1;
		return true;
	}

	expect(type: ConditionToken['type'], value?: ConditionToken['value']): ConditionToken {
		const token = this.consume();
		if (token.type !== type || (typeof value !== 'undefined' && token.value !== value)) {
			throw wrapQueryError(`条件表达式中缺少 ${String(value ?? type)}`);
		}
		return token;
	}

	get hasRemaining(): boolean {
		return this.index < this.tokens.length;
	}
}

const parseConditionExpression = (input: string): ConditionNode => {
	const trimmed = input.trim();
	if (!trimmed) {
		throw wrapQueryError('条件表达式不能为空');
	}
	const stream = new ConditionTokenStream(tokenizeCondition(trimmed));
	const node = parseOrExpression(stream);
	if (stream.hasRemaining) {
		throw wrapQueryError('条件表达式包含无法识别的尾部内容');
	}
	return node;
};

const parseOrExpression = (stream: ConditionTokenStream): ConditionNode => {
	let node = parseAndExpression(stream);
	while (stream.match('operator', '||')) {
		node = {
			type: 'binary',
			operator: '||',
			left: node,
			right: parseAndExpression(stream),
		};
	}
	return node;
};

const parseAndExpression = (stream: ConditionTokenStream): ConditionNode => {
	let node = parseUnaryExpression(stream);
	while (stream.match('operator', '&&')) {
		node = {
			type: 'binary',
			operator: '&&',
			left: node,
			right: parseUnaryExpression(stream),
		};
	}
	return node;
};

const parseUnaryExpression = (stream: ConditionTokenStream): ConditionNode => {
	if (stream.match('operator', '!')) {
		return {
			type: 'unary',
			operator: '!',
			operand: parseUnaryExpression(stream),
		};
	}
	return parseComparisonExpression(stream);
};

const parseComparisonExpression = (stream: ConditionTokenStream): ConditionNode => {
	let node = parsePrimaryExpression(stream);
	const operator = stream.peek();
	if (
		operator?.type === 'operator'
		&& ['==', '!=', '>', '>=', '<', '<=', 'contains', 'in', 'matches'].includes(
			String(operator.value)
		)
	) {
		stream.consume();
		node = {
			type: 'binary',
			operator: operator.value as ConditionBinaryNode['operator'],
			left: node,
			right: parsePrimaryExpression(stream),
		};
	}
	return node;
};

const parsePrimaryExpression = (stream: ConditionTokenStream): ConditionNode => {
	const token = stream.peek();
	if (!token) {
		throw wrapQueryError('条件表达式意外结束');
	}

	if (stream.match('lparen')) {
		const node = parseOrExpression(stream);
		stream.expect('rparen');
		return node;
	}

	if (stream.match('lbracket')) {
		const items: ConditionLiteralNode[] = [];
		if (!stream.match('rbracket')) {
			do {
				const item = parsePrimaryExpression(stream);
				if (item.type !== 'literal') {
					throw wrapQueryError('数组字面量只支持字符串、数字、布尔值或 null');
				}
				items.push(item);
			} while (stream.match('comma'));
			stream.expect('rbracket');
		}
		return {
			type: 'array',
			items,
		};
	}

	if (token.type === 'identifier') {
		stream.consume();
		return {
			type: 'identifier',
			name: String(token.value),
		};
	}
	if (token.type === 'string' || token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
		stream.consume();
		return {
			type: 'literal',
			value: token.value as string | number | boolean | null,
		};
	}

	throw wrapQueryError(`无法识别的条件值: ${String(token.value ?? token.type)}`);
};

const collectConditionIdentifiers = (node: ConditionNode, identifiers: Set<string>): void => {
	if (node.type === 'identifier') {
		identifiers.add(node.name);
		return;
	}
	if (node.type === 'unary') {
		collectConditionIdentifiers(node.operand, identifiers);
		return;
	}
	if (node.type === 'binary') {
		collectConditionIdentifiers(node.left, identifiers);
		collectConditionIdentifiers(node.right, identifiers);
	}
};

const validateFieldName = (field: string, allowedFields: Set<string>): void => {
	if (!allowedFields.has(field)) {
		throw createQueryError(
			formatLocal(localInstance.mcp_fs_query_unknown_field, field)
		);
	}
};

const validatePlanFields = (
	plan: QueryPlan,
	allowedFields: Set<string>
): void => {
	if (plan.groupBy) {
		validateFieldName(plan.groupBy, allowedFields);
	}

	for (const item of plan.select) {
		if (item.kind === 'field') {
			validateFieldName(item.field, allowedFields);
			continue;
		}
		if (item.field) {
			validateFieldName(item.field, allowedFields);
		}
	}

	const identifiers = new Set<string>();
	if (plan.where) {
		collectConditionIdentifiers(plan.where, identifiers);
	}
	for (const condition of plan.andGroups) {
		collectConditionIdentifiers(condition, identifiers);
	}
	for (const condition of plan.orGroups) {
		collectConditionIdentifiers(condition, identifiers);
	}
	for (const identifier of identifiers) {
		validateFieldName(identifier, allowedFields);
	}
};

const toComparableNumber = (value: unknown): number => {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) {
			return numeric;
		}
	}
	return NaN;
};

const toRegexFromValue = (value: unknown): RegExp => {
	if (typeof value !== 'string') {
		throw wrapQueryError('matches 右侧必须是字符串');
	}
	const match = value.match(/^\/(.+)\/([a-z]*)$/i);
	if (match) {
		try {
			return new RegExp(match[1], match[2]);
		} catch (error) {
			throw wrapQueryError(
				error instanceof Error ? error.message : String(error)
			);
		}
	}
	return resolveRegex(value) ?? /.^/;
};

const evaluateConditionNode = (
	node: ConditionNode,
	row: Record<string, unknown>
): unknown => {
	switch (node.type) {
		case 'identifier':
			return row[node.name];
		case 'literal':
			return node.value;
		case 'array':
			return node.items.map((item) => item.value);
		case 'unary':
			return !Boolean(evaluateConditionNode(node.operand, row));
		case 'binary': {
			if (node.operator === '&&') {
				return Boolean(evaluateConditionNode(node.left, row))
					&& Boolean(evaluateConditionNode(node.right, row));
			}
			if (node.operator === '||') {
				return Boolean(evaluateConditionNode(node.left, row))
					|| Boolean(evaluateConditionNode(node.right, row));
			}

			const left = evaluateConditionNode(node.left, row);
			const right = evaluateConditionNode(node.right, row);

			switch (node.operator) {
				case '==':
					return left === right;
				case '!=':
					return left !== right;
				case '>':
					return (left as any) > (right as any);
				case '>=':
					return (left as any) >= (right as any);
				case '<':
					return (left as any) < (right as any);
				case '<=':
					return (left as any) <= (right as any);
				case 'contains':
					if (Array.isArray(left)) {
						return left.includes(right);
					}
					return String(left ?? '').includes(String(right ?? ''));
				case 'in':
					if (Array.isArray(right)) {
						return right.includes(left);
					}
					return String(right ?? '').includes(String(left ?? ''));
				case 'matches':
					return toRegexFromValue(right).test(String(left ?? ''));
				default:
					return false;
			}
		}
		default:
			return null;
	}
};

const applyConditions = (
	rows: Array<Record<string, unknown>>,
	plan: QueryPlan
): Array<Record<string, unknown>> => {
	return rows.filter((row) => {
		let result = plan.where
			? Boolean(evaluateConditionNode(plan.where, row))
			: true;

		for (const condition of plan.andGroups) {
			result = result && Boolean(evaluateConditionNode(condition, row));
		}
		for (const condition of plan.orGroups) {
			result = result || Boolean(evaluateConditionNode(condition, row));
		}
		return result;
	});
};

const inferPropertyType = (value: unknown): string => {
	if (typeof value === 'boolean') {
		return 'checkbox';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (Array.isArray(value)) {
		return 'multitext';
	}
	if (typeof value === 'string') {
		if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
			return 'datetime';
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return 'date';
		}
		return 'text';
	}
	return 'text';
};

const mergePropertyTypes = (current: string | null, next: string): string => {
	if (!current) {
		return next;
	}
	return current === next ? current : 'mixed';
};

const buildFileDataset = (app: App): VaultQueryDataset => {
	const files = app.vault.getFiles();
	return {
		rows: files.map((file) => ({
			path: file.path,
			name: file.name,
			basename: file.basename,
			extension: file.extension,
			size: file.stat?.size ?? 0,
			created: file.stat?.ctime ?? 0,
			modified: file.stat?.mtime ?? 0,
			parent: file.parent?.path || '/',
		})),
		fields: DATA_SOURCE_FIELDS.file,
	};
};

const getMarkdownFiles = (app: App): TFile[] => {
	return app.vault.getFiles().filter((file) => file.extension === 'md');
};

const buildPropertyDataset = (app: App): VaultQueryDataset => {
	const markdownFiles = getMarkdownFiles(app);
	const stats = new Map<string, { type: string | null; usageCount: number }>();
	const metadataTypeManager = (app as any).metadataTypeManager as
		| { getAllProperties?: () => Record<string, PropertyInfoLike> }
		| undefined;
	const propertyDefinitions = metadataTypeManager?.getAllProperties?.() ?? {};

	for (const key of Object.keys(propertyDefinitions)) {
		const property = propertyDefinitions[key];
		const name = property?.name ?? key;
		const type = property?.widget ?? property?.type ?? null;
		stats.set(name, {
			type: type ? String(type) : null,
			usageCount: 0,
		});
	}

	for (const file of markdownFiles) {
		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) continue;
		for (const [name, value] of Object.entries(frontmatter)) {
			const current = stats.get(name) ?? { type: null, usageCount: 0 };
			current.type = mergePropertyTypes(current.type, inferPropertyType(value));
			current.usageCount += 1;
			stats.set(name, current);
		}
	}

	return {
		rows: Array.from(stats.entries()).map(([name, info]) => ({
			name,
			type: info.type ?? 'text',
			usageCount: info.usageCount,
		})),
		fields: DATA_SOURCE_FIELDS.property,
	};
};

const buildTagDataset = (app: App): VaultQueryDataset => {
	const stats = new Map<
		string,
		{ count: number; fileSet: Set<string>; firstSeen: number | null }
	>();

	for (const file of getMarkdownFiles(app)) {
		const tags = app.metadataCache.getFileCache(file)?.tags ?? [];
		for (const tagEntry of tags) {
			const tag = tagEntry.tag;
			const current = stats.get(tag) ?? {
				count: 0,
				fileSet: new Set<string>(),
				firstSeen: null,
			};
			current.count += 1;
			current.fileSet.add(file.path);
			current.firstSeen =
				current.firstSeen === null
					? file.stat?.ctime ?? null
					: Math.min(current.firstSeen, file.stat?.ctime ?? current.firstSeen);
			stats.set(tag, current);
		}
	}

	return {
		rows: Array.from(stats.entries()).map(([tag, info]) => ({
			tag,
			count: info.count,
			fileCount: info.fileSet.size,
			firstSeen: info.firstSeen,
		})),
		fields: DATA_SOURCE_FIELDS.tag,
	};
};

const detectTaskPriority = (text: string): string | null => {
	for (const entry of PRIORITY_PATTERNS) {
		if (entry.pattern.test(text)) {
			return entry.value;
		}
	}
	return null;
};

const buildTaskDataset = async (app: App): Promise<VaultQueryDataset> => {
	const rows: Array<Record<string, unknown>> = [];

	for (const file of getMarkdownFiles(app)) {
		const cache = app.metadataCache.getFileCache(file);
		const listItems = cache?.listItems ?? [];
		const taskItems = listItems.filter((item) => typeof item.task !== 'undefined');
		if (taskItems.length === 0) {
			continue;
		}

		const lines = (await app.vault.cachedRead(file)).split(/\r?\n/);
		for (const item of taskItems) {
			const lineNumber = ((item as any).position?.start?.line ?? -1) as number;
			if (lineNumber < 0 || lineNumber >= lines.length) {
				continue;
			}
			const text = lines[lineNumber];
			rows.push({
				filePath: file.path,
				line: lineNumber + 1,
				text,
				completed: item.task !== ' ',
				status: item.task ?? null,
				parentLine: item.parent >= 0 ? item.parent + 1 : null,
				priority: detectTaskPriority(text),
			});
		}
	}

	return {
		rows,
		fields: DATA_SOURCE_FIELDS.task,
	};
};

const getDataset = async (
	app: App,
	source: VaultQueryDataSource
): Promise<VaultQueryDataset> => {
	switch (source) {
		case 'file':
			return buildFileDataset(app);
		case 'property':
			return buildPropertyDataset(app);
		case 'tag':
			return buildTagDataset(app);
		case 'task':
			return await buildTaskDataset(app);
		default:
			throw createQueryError(
				formatLocal(localInstance.mcp_fs_query_invalid_source, source)
			);
	}
};

const getAggregateValue = (
	func: QueryAggregateSelectItem['func'],
	field: string | undefined,
	rows: Array<Record<string, unknown>>
): number => {
	if (func === 'count') {
		return rows.length;
	}

	const numericValues = rows
		.map((row) => toComparableNumber(field ? row[field] : undefined))
		.filter((value) => Number.isFinite(value));

	if (numericValues.length === 0) {
		return 0;
	}

	if (func === 'sum') {
		return numericValues.reduce((sum, value) => sum + value, 0);
	}

	return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
};

const applySelection = (
	rows: Array<Record<string, unknown>>,
	plan: QueryPlan
): Array<Record<string, unknown>> => {
	const aggregateItems = plan.select.filter(
		(item): item is QueryAggregateSelectItem => item.kind === 'aggregate'
	);
	const fieldItems = plan.select.filter(
		(item): item is QueryFieldSelectItem => item.kind === 'field'
	);

	if (plan.groupBy) {
		const groups = new Map<string, Array<Record<string, unknown>>>();
		for (const row of rows) {
			const key = JSON.stringify(row[plan.groupBy]);
			const groupRows = groups.get(key) ?? [];
			groupRows.push(row);
			groups.set(key, groupRows);
		}

		return Array.from(groups.values()).map((groupRows) => {
			const firstRow = groupRows[0] ?? {};
			const output: Record<string, unknown> = {};
			for (const item of fieldItems) {
				if (item.field !== plan.groupBy) {
					throw createQueryError(
						formatLocal(
							localInstance.mcp_fs_query_group_field_required,
							item.field
						)
					);
				}
				output[item.alias] = firstRow[item.field];
			}
			for (const item of aggregateItems) {
				output[item.alias] = getAggregateValue(item.func, item.field, groupRows);
			}
			return output;
		});
	}

	if (aggregateItems.length > 0 && fieldItems.length > 0) {
		throw createQueryError(localInstance.mcp_fs_query_mixed_select_requires_group);
	}

	if (aggregateItems.length > 0) {
		const output: Record<string, unknown> = {};
		for (const item of aggregateItems) {
			output[item.alias] = getAggregateValue(item.func, item.field, rows);
		}
		return [output];
	}

	return rows.map((row) => {
		const output: Record<string, unknown> = {};
		for (const item of fieldItems) {
			output[item.alias] = row[item.field];
		}
		return output;
	});
};

const compareValues = (left: unknown, right: unknown): number => {
	if (left === right) return 0;
	if (left === null || typeof left === 'undefined') return 1;
	if (right === null || typeof right === 'undefined') return -1;

	const leftNumber = typeof left === 'boolean' ? Number(left) : toComparableNumber(left);
	const rightNumber = typeof right === 'boolean' ? Number(right) : toComparableNumber(right);
	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber < rightNumber ? -1 : 1;
	}

	return String(left).localeCompare(String(right));
};

const applyOrderBy = (
	rows: Array<Record<string, unknown>>,
	orderBy?: { field: string; direction: 'asc' | 'desc' }
): Array<Record<string, unknown>> => {
	if (!orderBy) {
		return rows;
	}

	return [...rows].sort((left, right) => {
		const comparison = compareValues(left[orderBy.field], right[orderBy.field]);
		return orderBy.direction === 'desc' ? -comparison : comparison;
	});
};

const validateOrderByField = (
	orderBy: QueryPlan['orderBy'],
	columns: string[],
	rows: Array<Record<string, unknown>>
): void => {
	if (!orderBy) {
		return;
	}
	const outputFields = new Set<string>(columns);
	if (rows[0]) {
		for (const key of Object.keys(rows[0])) {
			outputFields.add(key);
		}
	}
	if (!outputFields.has(orderBy.field)) {
		throw createQueryError(
			formatLocal(localInstance.mcp_fs_query_invalid_order_by, orderBy.field)
		);
	}
};

export async function executeVaultQuery(
	app: App,
	expression: string
): Promise<{
	columns: string[];
	rows: Array<Record<string, unknown>>;
	meta: {
		dataSource: VaultQueryDataSource;
		totalBeforeLimit: number;
		returned: number;
		limit: number;
		offset: number;
		truncated: boolean;
	};
}> {
	const plan = parseQueryPlan(expression);
	const dataset = await getDataset(app, plan.from);
	const allowedFields = new Set<string>(dataset.fields);
	validatePlanFields(plan, allowedFields);

	const filteredRows = applyConditions(dataset.rows, plan);
	const selectedRows = applySelection(filteredRows, plan);
	const columns = plan.select.map((item) => item.alias);
	validateOrderByField(plan.orderBy, columns, selectedRows);
	const orderedRows = applyOrderBy(selectedRows, plan.orderBy);

	const offset = plan.offset ?? 0;
	const limit = plan.limit ?? DEFAULT_QUERY_MAX_ROWS;
	const pagedRows = orderedRows.slice(offset, offset + limit);
	const totalBeforeLimit = orderedRows.length;

	return {
		columns,
		rows: pagedRows,
		meta: {
			dataSource: plan.from,
			totalBeforeLimit,
			returned: pagedRows.length,
			limit,
			offset,
			truncated: offset + pagedRows.length < totalBeforeLimit,
		},
	};
}
