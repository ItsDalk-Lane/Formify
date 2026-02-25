import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import { registerTextTool } from '../runtime/register-tool';
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
});

export function registerNavTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerTextTool(
		server,
		registry,
		'open_file',
		'在 Obsidian 中打开指定文件。',
		openFileSchema,
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

	registerTextTool(
		server,
		registry,
		'get_first_link_path',
		'解析 Wiki 链接到实际文件路径。',
		getFirstLinkPathSchema,
		async ({ internalLink }) => {
			const sourcePath = app.workspace.getActiveFile()?.path ?? '';
			const cleaned = internalLink
				.split('|')[0]
				.split('#')[0]
				.trim();
			const file = app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
			return file?.path ?? null;
		}
	);
}
