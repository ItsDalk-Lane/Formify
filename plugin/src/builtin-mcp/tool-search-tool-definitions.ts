import { z } from 'zod';
import {
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
} from './constants';
import type { ToolLibraryCatalogDefinition } from './tool-library-types';

export const findToolSchema = z.object({
	task: z
		.string()
		.min(1)
		.describe('任务描述。请写明目标、对象和你当前的不确定点。'),
	serverIds: z
		.array(z.string())
		.optional()
		.describe('可选：限定搜索的 MCP serverId 数组'),
	categories: z
		.array(z.string())
		.optional()
		.describe('可选：限定搜索的工具分类数组'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(20)
		.default(3)
		.optional()
		.describe('返回结果数量，默认 3'),
});

export const getToolInfoSchema = z.object({
	name: z
		.string()
		.min(1)
		.describe('工具名称，大小写不敏感，优先精确匹配'),
});

export const listToolsSchema = z.object({
	serverIds: z
		.array(z.string())
		.optional()
		.describe('可选：按 serverId 数组筛选'),
	categories: z
		.array(z.string())
		.optional()
		.describe('可选：按分类数组筛选'),
});

const findToolInputSchema = {
	type: 'object',
	properties: {
		task: {
			type: 'string',
			description: '任务描述。请写明目标、对象和你当前的不确定点。',
		},
		serverIds: {
			type: 'array',
			description: '可选：限定搜索的 MCP serverId 数组',
			items: { type: 'string' },
		},
		categories: {
			type: 'array',
			description: '可选：限定搜索的工具分类数组',
			items: { type: 'string' },
		},
		limit: {
			type: 'integer',
			description: '返回结果数量，默认 3',
			minimum: 1,
			maximum: 20,
		},
	},
	required: ['task'],
};

const getToolInfoInputSchema = {
	type: 'object',
	properties: {
		name: {
			type: 'string',
			description: '工具名称，大小写不敏感，优先精确匹配',
		},
	},
	required: ['name'],
};

const listToolsInputSchema = {
	type: 'object',
	properties: {
		serverIds: {
			type: 'array',
			description: '可选：按 serverId 数组筛选',
			items: { type: 'string' },
		},
		categories: {
			type: 'array',
			description: '可选：按分类数组筛选',
			items: { type: 'string' },
		},
	},
};

export const TOOL_SEARCH_TOOL_CATALOG: ToolLibraryCatalogDefinition[] = [
	{
		name: 'find_tool',
		description:
			'当不确定该调用哪个 MCP 工具时先调用它。根据任务描述返回最匹配的工具、决策指南、参数说明和示例。',
		inputSchema: findToolInputSchema,
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
		serverName: BUILTIN_TOOL_SEARCH_SERVER_NAME,
	},
	{
		name: 'get_tool_info',
		description:
			'当已经锁定工具名但需要完整用法时调用它。返回单个工具的完整使用指南。',
		inputSchema: getToolInfoInputSchema,
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
		serverName: BUILTIN_TOOL_SEARCH_SERVER_NAME,
	},
	{
		name: 'list_tools',
		description:
			'当需要浏览某个 server 或 category 的工具全集时调用它。支持按服务器或分类筛选。',
		inputSchema: listToolsInputSchema,
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
		serverName: BUILTIN_TOOL_SEARCH_SERVER_NAME,
	},
];
