import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import { registerBuiltinTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import { assertVaultPath, getFileOrThrow, normalizeVaultPath } from './helpers';

const openFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	new_panel: z.boolean().default(false).optional(),
});

const getFirstLinkPathSchema = z.object({
	internalLink: z
		.string()
		.min(1)
		.describe('内部链接文本（不含 [[ ]]，不含别名）'),
	response_format: z
		.enum(['json', 'text'])
		.default('json')
		.describe("返回格式：json 为稳定对象，text 为紧凑文本"),
});

const openFileResultSchema = z.object({
	path: z.string(),
	new_panel: z.boolean(),
	opened: z.boolean(),
});

const getFirstLinkPathResultSchema = z.object({
	internalLink: z.string(),
	sourcePath: z.string(),
	resolvedPath: z.string().nullable(),
	found: z.boolean(),
});

export function registerNavTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerBuiltinTool(
		server,
		registry,
		'formify_open_file',
		{
			title: '在 Obsidian 中打开文件',
			description: '在 Obsidian 中打开指定文件。',
			inputSchema: openFileSchema,
			outputSchema: openFileResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ path, new_panel = false }) => {
			const normalizedPath = normalizeVaultPath(path);
			assertVaultPath(normalizedPath, 'path');
			const file = getFileOrThrow(app, normalizedPath);
			const leaf = app.workspace.getLeaf(new_panel);
			await leaf.openFile(file);
			return {
				path: normalizedPath,
				new_panel,
				opened: true,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_get_first_link_path',
		{
			title: '解析第一个 Wiki 链接路径',
			description: '解析内部 Wiki 链接到实际 Vault 文件路径。',
			inputSchema: getFirstLinkPathSchema,
			outputSchema: getFirstLinkPathResultSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ internalLink, response_format = 'json' }) => {
			const sourcePath = app.workspace.getActiveFile()?.path ?? '';
			const cleaned = internalLink
				.split('|')[0]
				.split('#')[0]
				.trim();
			const file = app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
			if (response_format === 'text') {
				return file?.path ?? '未找到匹配文件';
			}
			return {
				internalLink: cleaned,
				sourcePath,
				resolvedPath: file?.path ?? null,
				found: !!file,
			};
		}
	);
}
