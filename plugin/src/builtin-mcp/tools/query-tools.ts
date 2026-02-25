import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import { DEFAULT_QUERY_MAX_ROWS, DEFAULT_QUERY_TIMEOUT_MS } from '../constants';
import { collectVaultQuerySources } from '../query-engine/data-sources';
import { runQueryInSandbox } from '../query-engine/sandbox';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';

const queryVaultInputSchema = z.object({
	expression: z
		.string()
		.min(1)
		.describe('JavaScript DSL 查询表达式'),
});

export function registerQueryTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerTextTool(
		server,
		registry,
		'query_vault',
		'在 Vault 元数据上执行 DSL 查询。支持 select/from/where/groupBy/orderBy/limit/offset/count/sum。',
		queryVaultInputSchema,
		async ({ expression }) => {
			const sources = await collectVaultQuerySources(app);
			const result = await runQueryInSandbox(expression, sources, {
				timeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
				maxRows: DEFAULT_QUERY_MAX_ROWS,
			});
			return result;
		}
	);
}
