import { DEFAULT_QUERY_MAX_ROWS, DEFAULT_QUERY_TIMEOUT_MS } from '../constants';
import { createDslFunctions, QueryBuilder } from './query-builder';
import { QuerySources } from './types';

const blockedPatterns: RegExp[] = [
	/\brequire\s*\(/i,
	/\bimport\s+/i,
	/\bprocess\b/i,
	/\bglobalThis\b/i,
	/\bwindow\b/i,
	/\bdocument\b/i,
	/\bFunction\s*\(/i,
	/\beval\s*\(/i,
	/\bXMLHttpRequest\b/i,
	/\bfetch\s*\(/i,
	/\bWebSocket\b/i,
];

const validateExpression = (expression: string): void => {
	const source = String(expression ?? '').trim();
	if (!source) {
		throw new Error('expression 不能为空');
	}
	for (const pattern of blockedPatterns) {
		if (pattern.test(source)) {
			throw new Error(`expression 包含不允许的语法: ${pattern}`);
		}
	}
};

const executeExpression = (
	expression: string,
	contextValues: unknown[]
): unknown => {
	const contextNames = [
		'query',
		'from',
		'select',
		'where',
		'groupBy',
		'orderBy',
		'limit',
		'offset',
		'count',
		'sum',
	];

	try {
		const fn = new Function(
			...contextNames,
			`"use strict"; return (${expression});`
		) as (...args: unknown[]) => unknown;
		return fn(...contextValues);
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			throw error;
		}
		const fn = new Function(
			...contextNames,
			`"use strict"; ${expression}`
		) as (...args: unknown[]) => unknown;
		return fn(...contextValues);
	}
};

export interface QuerySandboxOptions {
	timeoutMs?: number;
	maxRows?: number;
}

export async function runQueryInSandbox(
	expression: string,
	sources: QuerySources,
	options?: QuerySandboxOptions
): Promise<unknown> {
	validateExpression(expression);

	const timeoutMs = Number.isFinite(options?.timeoutMs)
		? Math.max(1, Number(options?.timeoutMs))
		: DEFAULT_QUERY_TIMEOUT_MS;
	const maxRows = Number.isFinite(options?.maxRows)
		? Math.max(1, Number(options?.maxRows))
		: DEFAULT_QUERY_MAX_ROWS;

	const dsl = createDslFunctions(sources, { maxRows });
	const contextValues = [
		dsl.query,
		dsl.from,
		dsl.select,
		dsl.where,
		dsl.groupBy,
		dsl.orderBy,
		dsl.limit,
		dsl.offset,
		dsl.count,
		dsl.sum,
	];

	const execution = Promise.resolve(
		executeExpression(expression, contextValues)
	).then((result) => {
		if (result instanceof QueryBuilder) {
			return result.execute();
		}
		return result;
	});

	const timeout = new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(new Error(`query_vault 执行超时 (${timeoutMs}ms)`));
		}, timeoutMs);
	});

	return await Promise.race([execution, timeout]);
}
