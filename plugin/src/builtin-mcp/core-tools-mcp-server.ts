import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, moment } from 'obsidian';
import {
	BUILTIN_CORE_TOOLS_CLIENT_NAME,
	BUILTIN_CORE_TOOLS_SERVER_ID,
	BUILTIN_CORE_TOOLS_SERVER_NAME,
	BUILTIN_CORE_TOOLS_SERVER_VERSION,
} from './constants';
import {
	clonePlanSnapshot,
	type PlanSnapshot,
	type PlanStateListener,
	PlanState,
} from './runtime/plan-state';
import { ScriptRuntime } from './runtime/script-runtime';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { registerNavTools } from './tools/nav-tools';
import { registerPlanTools } from './tools/plan-tools';
import { registerScriptTools } from './tools/script-tools';

export interface BuiltinToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface CoreToolsBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<BuiltinToolInfo[]>;
	close: () => Promise<void>;
	resetState: () => void;
	getPlanSnapshot: () => PlanSnapshot | null;
	syncPlanSnapshot: (snapshot: PlanSnapshot | null) => PlanSnapshot | null;
	onPlanChange: (listener: PlanStateListener) => () => void;
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

export async function createCoreToolsBuiltinRuntime(
	app: App
): Promise<CoreToolsBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_CORE_TOOLS_SERVER_NAME,
		version: BUILTIN_CORE_TOOLS_SERVER_VERSION,
	});

	const registry = new BuiltinToolRegistry();
	const planState = new PlanState();
	const scriptRuntime = new ScriptRuntime({
		callTool: async (toolName: string, args: Record<string, unknown>) => {
			return await registry.call(toolName, args);
		},
		momentFactory: (...args: unknown[]) =>
			(moment as unknown as (...innerArgs: unknown[]) => unknown)(...args),
	});

	registerNavTools(server, app, registry);
	registerScriptTools(server, app, registry, scriptRuntime);
	registerPlanTools(server, registry, planState);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_CORE_TOOLS_CLIENT_NAME,
		version: BUILTIN_CORE_TOOLS_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const close = async (): Promise<void> => {
		scriptRuntime.reset();
		planState.reset();
		registry.clear();
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
		serverName: BUILTIN_CORE_TOOLS_SERVER_NAME,
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
				serverId: BUILTIN_CORE_TOOLS_SERVER_ID,
			}));
		},
		close,
		resetState: () => {
			scriptRuntime.reset();
			planState.reset();
		},
		getPlanSnapshot: () => clonePlanSnapshot(planState.get()),
		syncPlanSnapshot: (snapshot) => planState.restore(clonePlanSnapshot(snapshot)),
		onPlanChange: (listener) => planState.subscribe(listener),
	};
}

export async function createCoreToolsBuiltinClient(app: App): Promise<Client> {
	const runtime = await createCoreToolsBuiltinRuntime(app);
	return runtime.client;
}
