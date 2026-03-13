import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpToolAnnotations } from 'src/features/tars/mcp/types';
import { z } from 'zod';
import { BuiltinToolRegistry } from './tool-registry';
import { normalizeStructuredToolResult } from './tool-result';

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

interface RegisterBuiltinToolOptions<TArgs> {
	title?: string;
	description: string;
	inputSchema: z.ZodType<TArgs>;
	outputSchema?: z.ZodTypeAny;
	annotations?: McpToolAnnotations;
}

export function registerBuiltinTool<TArgs>(
	server: McpServer,
	registry: BuiltinToolRegistry,
	name: string,
	options: RegisterBuiltinToolOptions<TArgs>,
	handler: (args: TArgs) => Promise<unknown> | unknown
): void {
	registry.register(name, options.inputSchema, handler);

	server.registerTool(
		name,
		{
			title: options.title,
			description: options.description,
			inputSchema: options.inputSchema,
			outputSchema: options.outputSchema,
			annotations: options.annotations,
		},
		async (args) => {
			try {
				const result = await handler(args as TArgs);
				return normalizeStructuredToolResult(result);
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
