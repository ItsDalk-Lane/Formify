import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import {
	BUILTIN_TOOL_SEARCH_CLIENT_NAME,
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
	BUILTIN_TOOL_SEARCH_SERVER_VERSION,
} from './constants';
import { registerTextTool } from './runtime/register-tool';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { ToolLibraryManager } from './tool-library-manager';
import {
	findToolSchema,
	getToolInfoSchema,
	listToolsSchema,
} from './tool-search-tool-definitions';

export interface ToolSearchBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown>; serverId: string }>>;
	close: () => Promise<void>;
}

const extractTextResult = (result: {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}): string => {
	const text = (result.content ?? [])
		.filter((item) => item.type === 'text' && typeof item.text === 'string')
		.map((item) => item.text as string)
		.join('\n');
	if (result.isError) {
		return `[工具执行错误] ${text}`;
	}
	return text;
};

export async function createToolSearchBuiltinRuntime(
	_app: App,
	manager: ToolLibraryManager
): Promise<ToolSearchBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_TOOL_SEARCH_SERVER_NAME,
		version: BUILTIN_TOOL_SEARCH_SERVER_VERSION,
	});

	const registry = new BuiltinToolRegistry();

	registerTextTool(
		server,
		registry,
		'find_tool',
		'当不确定该调用哪个 MCP 工具时先调用它。根据任务描述返回最匹配的工具、决策指南、参数说明和示例。',
		findToolSchema,
		async ({ task, serverIds, categories, limit = 3 }) => {
			const results = await manager.searchTools({
				task,
				serverIds,
				categories,
				limit,
			});
			return manager.formatFindToolResults(results, task);
		}
	);

	registerTextTool(
		server,
		registry,
		'get_tool_info',
		'当已经锁定工具名但需要完整用法时调用它。返回单个工具的完整使用指南。',
		getToolInfoSchema,
		async ({ name }) => {
			const entry = await manager.getEntry(name);
			if (!entry) {
				return [
					'# Tool Search',
					`未找到工具：${name}`,
					'- 请确认工具名是否正确。',
					'- 如果你还不确定工具名，请先调用 `find_tool`。',
				].join('\n');
			}
			return manager.formatToolInfo(entry);
		}
	);

	registerTextTool(
		server,
		registry,
		'list_tools',
		'当需要浏览某个 server 或 category 的工具全集时调用它。支持按服务器或分类筛选。',
		listToolsSchema,
		async ({ serverIds, categories }) => {
			const entries = await manager.listEntries({
				serverIds,
				categories,
			});
			return manager.formatList(entries, {
				serverIds,
				categories,
			});
		}
	);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_TOOL_SEARCH_CLIENT_NAME,
		version: BUILTIN_TOOL_SEARCH_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return {
		serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
		serverName: BUILTIN_TOOL_SEARCH_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return extractTextResult({
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				serverId: BUILTIN_TOOL_SEARCH_SERVER_ID,
			}));
		},
		close: async () => {
			registry.clear();
			await Promise.allSettled([client.close(), server.close()]);
		},
	};
}
