import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import {
	BUILTIN_TIME_CLIENT_NAME,
	BUILTIN_TIME_SERVER_ID,
	BUILTIN_TIME_SERVER_NAME,
	BUILTIN_TIME_SERVER_VERSION,
} from './constants';
import { serializeMcpToolResult } from './runtime/tool-result';
import {
	buildCurrentTimeResult,
	buildTimeConversionResult,
} from './tools/time-utils';

export interface BuiltinToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface TimeBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<BuiltinToolInfo[]>;
	close: () => Promise<void>;
}

const getCurrentTimeSchema = z.object({
	timezone: z
		.string()
		.min(1)
		.describe("IANA 时区名称，例如 'America/New_York'、'Europe/London'"),
});

const convertTimeSchema = z.object({
	source_timezone: z
		.string()
		.min(1)
		.describe("源 IANA 时区名称，例如 'America/New_York'"),
	time: z
		.string()
		.min(1)
		.describe('要转换的时间，24 小时制 HH:MM'),
	target_timezone: z
		.string()
		.min(1)
		.describe("目标 IANA 时区名称，例如 'Asia/Tokyo'"),
});

export async function createTimeBuiltinRuntime(
	_app: App
): Promise<TimeBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_TIME_SERVER_NAME,
		version: BUILTIN_TIME_SERVER_VERSION,
	});

	server.registerTool(
		'get_current_time',
		{
			description: '获取指定时区的当前时间。',
			inputSchema: getCurrentTimeSchema,
		},
		async (args) => {
			try {
				const { timezone } = getCurrentTimeSchema.parse(args);
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(buildCurrentTimeResult(timezone), null, 2),
						},
					],
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: 'text' as const,
							text: error instanceof Error ? error.message : String(error),
						},
					],
				};
			}
		}
	);

	server.registerTool(
		'convert_time',
		{
			description: '在不同时区之间转换时间。',
			inputSchema: convertTimeSchema,
		},
		async (args) => {
			try {
				const { source_timezone, time, target_timezone } =
					convertTimeSchema.parse(args);
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								buildTimeConversionResult(
									source_timezone,
									time,
									target_timezone
								),
								null,
								2
							),
						},
					],
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: 'text' as const,
							text: error instanceof Error ? error.message : String(error),
						},
					],
				};
			}
		}
	);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_TIME_CLIENT_NAME,
		version: BUILTIN_TIME_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const close = async (): Promise<void> => {
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_TIME_SERVER_ID,
		serverName: BUILTIN_TIME_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return serializeMcpToolResult({
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
				serverId: BUILTIN_TIME_SERVER_ID,
			}));
		},
		close,
	};
}

export async function createTimeBuiltinClient(app: App): Promise<Client> {
	const runtime = await createTimeBuiltinRuntime(app);
	return runtime.client;
}
