import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, moment } from 'obsidian';
import {
	BUILTIN_VAULT_CLIENT_NAME,
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
	BUILTIN_VAULT_SERVER_VERSION,
} from './constants';
import { AgentRegistry } from './runtime/agent-registry';
import { PlanState } from './runtime/plan-state';
import { ScriptRuntime } from './runtime/script-runtime';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { registerFileTools } from './tools/file-tools';
import { registerNavTools } from './tools/nav-tools';
import { registerQueryTools } from './tools/query-tools';
import { registerScriptTools } from './tools/script-tools';
import { registerUtilTools } from './tools/util-tools';

const DEFAULT_DELEGATE_AGENT_ID = 'builtin.echo';

export interface BuiltinToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface VaultBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<BuiltinToolInfo[]>;
	close: () => Promise<void>;
	resetState: () => void;
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

export async function createVaultBuiltinRuntime(
	app: App
): Promise<VaultBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_VAULT_SERVER_NAME,
		version: BUILTIN_VAULT_SERVER_VERSION,
	});

	const registry = new BuiltinToolRegistry();
	const planState = new PlanState();
	const agentRegistry = new AgentRegistry();
	agentRegistry.register(DEFAULT_DELEGATE_AGENT_ID, async (task, context) => {
		return {
			id: context.id,
			task,
			status: 'ok',
		};
	});
	const scriptRuntime = new ScriptRuntime({
		callTool: async (toolName: string, args: Record<string, unknown>) => {
			return await registry.call(toolName, args);
		},
		momentFactory: (...args: unknown[]) => (moment as unknown as (...innerArgs: unknown[]) => unknown)(...args),
	});

	registerFileTools(server, app, registry);
	registerQueryTools(server, app, registry);
	registerNavTools(server, app, registry);
	registerScriptTools(server, app, registry, scriptRuntime);
	registerUtilTools(server, registry, planState, agentRegistry);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_VAULT_CLIENT_NAME,
		version: BUILTIN_VAULT_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const close = async (): Promise<void> => {
		scriptRuntime.reset();
		planState.reset();
		agentRegistry.clear();
		registry.clear();
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_VAULT_SERVER_ID,
		serverName: BUILTIN_VAULT_SERVER_NAME,
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
				serverId: BUILTIN_VAULT_SERVER_ID,
			}));
		},
		close,
		resetState: () => {
			scriptRuntime.reset();
			planState.reset();
		},
	};
}

export async function createVaultBuiltinClient(app: App): Promise<Client> {
	const runtime = await createVaultBuiltinRuntime(app);
	return runtime.client;
}
