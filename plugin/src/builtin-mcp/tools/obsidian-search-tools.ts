import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import {
	DEFAULT_SEARCH_CONTEXT_LINES,
	DEFAULT_SEARCH_MAX_RESULTS,
} from '../constants';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import { executeSearch } from '../search-engine/search-engine';
import { SortOrder } from '../search-engine/types';

const sortBySchema = z
	.enum(['path-asc', 'path-desc', 'mtime-new', 'mtime-old', 'ctime-new', 'ctime-old'])
	.default('mtime-new')
	.optional()
	.describe('排序方式：path-asc/path-desc/mtime-new/mtime-old/ctime-new/ctime-old');

const commonSearchSchemaShape = {
	maxResults: z
		.number()
		.int()
		.min(1)
		.default(DEFAULT_SEARCH_MAX_RESULTS)
		.optional()
		.describe('最大返回文件数'),
	sortBy: sortBySchema,
	contextLines: z
		.number()
		.int()
		.min(0)
		.default(DEFAULT_SEARCH_CONTEXT_LINES)
		.optional()
		.describe('匹配行的上下文行数'),
	explain: z
		.boolean()
		.default(false)
		.optional()
		.describe('是否返回查询的自然语言解释'),
} as const;

const querySchema = (description: string) =>
	z.string().min(1).describe(description);

const operatorQuerySchema = (description: string) =>
	querySchema(`${description}。支持单词、短语、正则、括号分组和高级搜索子语法。`);

const commonQuerySearchSchema = (description: string) =>
	z.object({
		query: querySchema(description),
		...commonSearchSchemaShape,
	});

const commonOperatorSearchSchema = (description: string) =>
	z.object({
		query: operatorQuerySchema(description),
		...commonSearchSchemaShape,
	});

const searchTasksSchema = z.object({
	query: operatorQuerySchema('任务搜索关键词或子查询'),
	taskStatus: z
		.enum(['all', 'todo', 'done'])
		.default('all')
		.optional()
		.describe('任务状态：all=所有任务，todo=未完成任务，done=已完成任务'),
	...commonSearchSchemaShape,
});

const searchPropertiesSchema = z.object({
	property: z.string().min(1).describe('属性名称'),
	value: z
		.string()
		.optional()
		.describe('属性值。省略时表示仅检查属性是否存在'),
	comparator: z
		.enum(['=', '>', '>=', '<', '<=', 'null'])
		.optional()
		.describe('属性比较符。null 表示搜索空值'),
	...commonSearchSchemaShape,
});

type CommonSearchArgs = {
	maxResults?: number;
	sortBy?: SortOrder;
	contextLines?: number;
	explain?: boolean;
};

type QuerySearchArgs = CommonSearchArgs & {
	query: string;
};

type SearchPropertiesArgs = CommonSearchArgs & {
	property: string;
	value?: string;
	comparator?: '=' | '>' | '>=' | '<' | '<=' | 'null';
};

const SEARCH_OPERATORS = [
	'file:',
	'path:',
	'folder:',
	'content:',
	'tag:',
	'line:',
	'block:',
	'section:',
	'task:',
	'task-todo:',
	'task-done:',
	'match-case:',
	'ignore-case:',
] as const;

const toSearchOptions = ({
	maxResults = DEFAULT_SEARCH_MAX_RESULTS,
	sortBy = 'mtime-new',
	contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
	explain = false,
}: CommonSearchArgs) => ({
	maxResults,
	sortBy,
	contextLines,
	explain,
});

const isWrappedGroup = (value: string): boolean => {
	if (!value.startsWith('(') || !value.endsWith(')')) {
		return false;
	}

	let depth = 0;
	for (let index = 0; index < value.length; index += 1) {
		const current = value[index];
		if (current === '(') depth += 1;
		if (current === ')') depth -= 1;
		if (depth === 0 && index < value.length - 1) {
			return false;
		}
		if (depth < 0) {
			return false;
		}
	}

	return depth === 0;
};

const isQuotedLiteral = (value: string): boolean =>
	value.length >= 2 && value.startsWith('"') && value.endsWith('"');

const isRegexLiteral = (value: string): boolean =>
	/^\/.+\/$/.test(value);

const isBareWord = (value: string): boolean =>
	/^[^\s()[\]"]+$/.test(value) && !SEARCH_OPERATORS.some((operator) => value.includes(operator));

const toOperatorChild = (query: string): string => {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error('query 不能为空');
	}

	if (
		isWrappedGroup(trimmed)
		|| isQuotedLiteral(trimmed)
		|| isRegexLiteral(trimmed)
		|| isBareWord(trimmed)
	) {
		return trimmed;
	}

	return `(${trimmed})`;
};

const buildOperatorQuery = (operator: string, query: string): string =>
	`${operator}:${toOperatorChild(query)}`;

const buildPropertyQuery = ({
	property,
	value,
	comparator,
}: SearchPropertiesArgs): string => {
	const normalizedProperty = property.trim();
	if (!normalizedProperty) {
		throw new Error('property 不能为空');
	}

	if (!comparator && typeof value === 'undefined') {
		return `[${normalizedProperty}]`;
	}

	if (comparator === 'null') {
		return `[${normalizedProperty}:null]`;
	}

	if (typeof value === 'undefined') {
		throw new Error('设置 comparator 时必须提供 value');
	}

	const normalizedValue = value.trim();
	if (!normalizedValue) {
		throw new Error('value 不能为空');
	}

	const operator = comparator ?? '=';
	if (operator === '=') {
		return `[${normalizedProperty}:${normalizedValue}]`;
	}

	return `[${normalizedProperty}:${operator}${normalizedValue}]`;
};

async function runSearch(
	app: App,
	query: string,
	args: CommonSearchArgs
) {
	return await executeSearch(app, query, toSearchOptions(args));
}

function registerQueryTool(
	server: McpServer,
	registry: BuiltinToolRegistry,
	app: App,
	name: string,
	description: string,
	queryDescription: string,
	buildQuery: (args: QuerySearchArgs) => string,
	operatorScoped = false
): void {
	const schema = operatorScoped
		? commonOperatorSearchSchema(queryDescription)
		: commonQuerySearchSchema(queryDescription);

	registerTextTool(
		server,
		registry,
		name,
		description,
		schema,
		async (args) => {
			return await runSearch(app, buildQuery(args), args);
		}
	);
}

export function registerObsidianSearchTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerQueryTool(
		server,
		registry,
		app,
		'search_files',
		'在文件名中搜索。面向 file: 操作符，适合按文档名称查找文件。',
		'文件名搜索关键词或子查询',
		({ query }) => buildOperatorQuery('file', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_path',
		'在完整路径中搜索。面向 path: 操作符，适合按路径或目录层级查找文件。',
		'路径搜索关键词或子查询',
		({ query }) => buildOperatorQuery('path', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_folder',
		'搜索文件夹名称。面向 folder: 操作符，可返回匹配的文件夹或位于该文件夹下的文件。',
		'文件夹搜索关键词或子查询',
		({ query }) => buildOperatorQuery('folder', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_content',
		'在文件内容中搜索。面向 content: 操作符，不匹配文件名和路径。',
		'内容搜索关键词或子查询',
		({ query }) => buildOperatorQuery('content', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_tags',
		'搜索文件标签。面向 tag: 操作符，支持 #tag 和普通关键词。',
		'标签搜索关键词或子查询',
		({ query }) => buildOperatorQuery('tag', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_line',
		'搜索同一行内满足条件的内容。面向 line: 操作符，适合行级组合匹配。',
		'同一行搜索关键词或子查询',
		({ query }) => buildOperatorQuery('line', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_block',
		'搜索同一个 Markdown 块内满足条件的内容。面向 block: 操作符。',
		'同一块搜索关键词或子查询',
		({ query }) => buildOperatorQuery('block', query),
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'search_section',
		'搜索同一个 Markdown 章节内满足条件的内容。面向 section: 操作符。',
		'同一章节搜索关键词或子查询',
		({ query }) => buildOperatorQuery('section', query),
		true
	);

	registerTextTool(
		server,
		registry,
		'search_tasks',
		'搜索任务文本。支持全部任务、未完成任务和已完成任务三种模式，分别对应 task:/task-todo:/task-done:。',
		searchTasksSchema,
		async ({ query, taskStatus = 'all', ...args }) => {
			const operator = taskStatus === 'todo'
				? 'task-todo'
				: taskStatus === 'done'
					? 'task-done'
					: 'task';
			return await runSearch(app, buildOperatorQuery(operator, query), args);
		}
	);

	registerTextTool(
		server,
		registry,
		'search_properties',
		'搜索文件属性。支持属性存在、值相等、数值比较以及 null 空值判断。',
		searchPropertiesSchema,
		async (args) => {
			return await runSearch(app, buildPropertyQuery(args), args);
		}
	);

	registerQueryTool(
		server,
		registry,
		app,
		'quick_search',
		'快速关键词搜索。支持纯文本 AND、OR、NOT、引号精确匹配和正则表达式。',
		'快速搜索查询，支持关键词、OR、NOT、引号精确匹配和正则表达式',
		({ query }) => query
	);

	registerQueryTool(
		server,
		registry,
		app,
		'advanced_search',
		'完整 Obsidian 搜索语法搜索。支持所有操作符、属性搜索以及复杂组合，等同于原 obsidian_search。',
		'完整 Obsidian 搜索语法查询',
		({ query }) => query
	);

	registerQueryTool(
		server,
		registry,
		app,
		'file_only_search',
		'仅搜索文件名、路径和文件夹，不搜索正文内容。',
		'文件定位关键词或子查询',
		({ query }) =>
			`(${[
				buildOperatorQuery('file', query),
				buildOperatorQuery('path', query),
				buildOperatorQuery('folder', query),
			].join(' OR ')})`,
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'content_only_search',
		'仅搜索正文内容相关范围：文件内容、行、块和章节，不搜索文件名与路径。',
		'内容搜索关键词或子查询',
		({ query }) =>
			`(${[
				buildOperatorQuery('content', query),
				buildOperatorQuery('line', query),
				buildOperatorQuery('block', query),
				buildOperatorQuery('section', query),
			].join(' OR ')})`,
		true
	);

	registerQueryTool(
		server,
		registry,
		app,
		'tag_search',
		'标签专用搜索。面向按标签组织内容的使用场景，功能与 search_tags 类似。',
		'标签搜索关键词或子查询',
		({ query }) => buildOperatorQuery('tag', query),
		true
	);
}
