import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import { registerBuiltinTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import { assertVaultPath, getFileOrThrow, normalizeVaultPath } from './helpers';

const openFileSchema = z.object({
	file_path: z
		.string()
		.min(1)
		.describe('已知文件路径；相对于 Vault 根目录。仅在已经知道准确文件路径时使用'),
	open_in_new_panel: z
		.boolean()
		.default(false)
		.optional()
		.describe('是否在新的编辑面板中打开文件，默认 false'),
}).strict();

const openFileResultSchema = z.object({
	file_path: z.string(),
	open_in_new_panel: z.boolean(),
	opened: z.boolean(),
});

export function registerNavTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerBuiltinTool(
		server,
		registry,
		'open_file',
		{
			title: '在 Obsidian 中打开文件',
			description:
				'做什么：在 Obsidian 中打开一个已知 file_path 的文件。\n什么时候用：你已经知道准确文件路径，并且需要把它展示给用户或切换到该文件。\n不要在什么场景用：不要用于查找未知路径；如果只知道名称，请先使用 find_paths。不要用于读取文件内容。\n返回什么：file_path、open_in_new_panel、opened。\n失败后下一步怎么做：如果报路径不存在，先调用 find_paths 定位路径。',
			inputSchema: openFileSchema,
			outputSchema: openFileResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ file_path, open_in_new_panel = false }) => {
			const normalizedPath = normalizeVaultPath(file_path);
			assertVaultPath(normalizedPath, 'file_path');
			const file = getFileOrThrow(app, normalizedPath);
			const leaf = app.workspace.getLeaf(open_in_new_panel);
			await leaf.openFile(file);
			return {
				file_path: normalizedPath,
				open_in_new_panel,
				opened: true,
			};
		}
	);
}
