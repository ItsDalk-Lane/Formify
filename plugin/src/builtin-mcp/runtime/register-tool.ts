import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BuiltinToolRegistry } from './tool-registry';

const MAX_TOOL_RESULT_TEXT_LENGTH = 2 * 1024 * 1024;

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const toText = (value: unknown): string => {
	const text =
		typeof value === 'string'
			? value
			: JSON.stringify(value, null, 2);
	if (text.length <= MAX_TOOL_RESULT_TEXT_LENGTH) {
		return text;
	}
	return `${text.slice(0, MAX_TOOL_RESULT_TEXT_LENGTH)}\n\n[结果已截断]`;
};

export function registerTextTool<TArgs>(
	server: McpServer,
	registry: BuiltinToolRegistry,
	name: string,
	description: string,
	inputSchema: z.ZodType<TArgs>,
	handler: (args: TArgs) => Promise<unknown> | unknown
): void {
	registry.register(name, inputSchema, handler);

	server.registerTool(
		name,
		{
			description,
			inputSchema,
		},
		async (args) => {
			try {
				const result = await handler(args as TArgs);
				return {
					content: [
						{
							type: 'text' as const,
							text: toText(result),
						},
					],
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: 'text' as const,
							text: toErrorMessage(error),
						},
					],
				};
			}
		}
	);
}
