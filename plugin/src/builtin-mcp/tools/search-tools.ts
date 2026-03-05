/**
 * Obsidian 风格搜索工具 — MCP 工具注册
 *
 * 注册 obsidian_search 工具，提供与 Obsidian 搜索核心插件兼容的搜索语法。
 */

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

const searchSchema = z.object({
	query: z.string().min(1).describe(
		'Obsidian 搜索语法查询字符串。支持的语法：\n'
		+ '- 纯文本词（多个词默认 AND）：meeting work\n'
		+ '- OR 操作符：meeting OR work\n'
		+ '- NOT（排除）：meeting -work\n'
		+ '- 括号分组：meeting (work OR meetup)\n'
		+ '- 引号精确短语："star wars"\n'
		+ '- 正则表达式：/\\d{4}-\\d{2}-\\d{2}/\n'
		+ '- 操作符：\n'
		+ '  file: 文件名匹配，如 file:readme\n'
		+ '  path: 路径匹配（含文件夹），如 path:"Daily notes/2024"\n'
		+ '  folder: 文件夹名匹配，直接返回文件夹路径，如 folder:日记\n'
		+ '  content: 仅在内容中匹配，如 content:"happy cat"\n'
		+ '  tag: 标签匹配，如 tag:#work\n'
		+ '  line: 同一行匹配所有条件，如 line:(mix flour)\n'
		+ '  block: 同一块匹配所有条件，如 block:(dog cat)\n'
		+ '  section: 同一章节匹配所有条件，如 section:(dog cat)\n'
		+ '  task: 任务文本匹配，如 task:call\n'
		+ '  task-todo: 未完成任务匹配，如 task-todo:call\n'
		+ '  task-done: 已完成任务匹配，如 task-done:call\n'
		+ '  match-case: 区分大小写，如 match-case:HappyCat\n'
		+ '  ignore-case: 忽略大小写，如 ignore-case:ikea\n'
		+ '- 属性搜索：\n'
		+ '  [property] 属性存在\n'
		+ '  [property:value] 属性值匹配\n'
		+ '  [property:>5] 数值比较（>, <, >=, <=）\n'
		+ '  [property:null] 属性值为空'
	),
	maxResults: z
		.number()
		.int()
		.min(1)
		.default(DEFAULT_SEARCH_MAX_RESULTS)
		.optional()
		.describe('最大返回文件数'),
	sortBy: z
		.enum(['path-asc', 'path-desc', 'mtime-new', 'mtime-old', 'ctime-new', 'ctime-old'])
		.default('mtime-new')
		.optional()
		.describe('排序方式：path-asc/path-desc/mtime-new/mtime-old/ctime-new/ctime-old'),
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
});

export function registerSearchTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerTextTool(
		server,
		registry,
		'obsidian_search',
		'使用与 Obsidian 搜索核心插件兼容的语法搜索 Vault。'
		+ '支持文本搜索、AND/OR/NOT 逻辑组合、引号精确匹配、正则表达式、'
		+ '以及 file:/path:/folder:/content:/tag:/line:/block:/section:/task:/task-todo:/task-done:/'
		+ 'match-case:/ignore-case: 操作符和 [property:value] 属性搜索。',
		searchSchema,
		async ({
			query,
			maxResults = DEFAULT_SEARCH_MAX_RESULTS,
			sortBy = 'mtime-new',
			contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
			explain = false,
		}) => {
			return await executeSearch(app, query, {
				maxResults,
				sortBy: sortBy as SortOrder,
				contextLines,
				explain,
			});
		}
	);
}
