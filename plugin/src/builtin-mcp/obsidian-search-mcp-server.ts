import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import {
	BUILTIN_OBSIDIAN_SEARCH_CLIENT_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_VERSION,
} from './constants';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { registerObsidianSearchTools } from './tools/obsidian-search-tools';

export interface ObsidianSearchBuiltinRuntime {
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

export async function createObsidianSearchBuiltinRuntime(
	app: App
): Promise<ObsidianSearchBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
		version: BUILTIN_OBSIDIAN_SEARCH_SERVER_VERSION,
	});

	const registry = new BuiltinToolRegistry();
	registerObsidianSearchTools(server, app, registry);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_OBSIDIAN_SEARCH_CLIENT_NAME,
		version: BUILTIN_OBSIDIAN_SEARCH_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return {
		serverId: BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
		serverName: BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
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
				serverId: BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
			}));
		},
		close: async () => {
			registry.clear();
			await Promise.allSettled([client.close(), server.close()]);
		},
	};
}
