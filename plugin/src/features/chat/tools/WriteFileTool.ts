import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface WriteFileArgs {
	filePath: string;
	content: string;
	createFolders?: boolean;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

const ensureFolderExists = async (app: App, folderPath: string) => {
	const normalized = normalizeVaultPath(folderPath);
	if (!normalized || normalized === '.') return;

	const parts = normalized.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.createFolder(current);
		}
	}
};

export const createWriteFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'write_file',
		name: 'write_file',
		description: '向文件写入内容。如果文件不存在则创建新文件，存在则覆盖。支持 Markdown 和纯文本文件。',
		enabled: true,
		executionMode: 'manual',
		category: 'file',
		icon: 'FileText',
		parameters: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: '文件路径，相对于 vault 根目录。例如: notes/我的笔记.md'
				},
				content: {
					type: 'string',
					description: '要写入的内容'
				},
				createFolders: {
					type: 'boolean',
					description: '如果父文件夹不存在，是否自动创建。默认 true。'
				}
			},
			required: ['filePath', 'content']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as WriteFileArgs;
			const filePath = normalizeVaultPath(args.filePath);
			const content = String(args.content ?? '');
			const createFolders = args.createFolders !== false;

			if (!filePath) {
				throw new Error('filePath 不能为空');
			}

			const parent = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';

			// 1) 优先使用 Obsidian API
			try {
				if (createFolders && parent) {
					await ensureFolderExists(app, parent);
				}

				const existing = app.vault.getAbstractFileByPath(filePath);
				if (existing instanceof TFile) {
					await app.vault.modify(existing, content);
					return `已覆盖写入: ${filePath}`;
				}

				await app.vault.create(filePath, content);
				return `已创建并写入: ${filePath}`;
			} catch (error) {
				// 2) 降级到 Node.js API
				try {
					const adapter: any = app.vault.adapter as any;
					const basePath: string | undefined = adapter?.basePath;
					if (!basePath) {
						throw new Error('无法获取 vault 物理路径（basePath）');
					}

					const absPath = path.join(basePath, filePath);
					if (createFolders) {
						fs.mkdirSync(path.dirname(absPath), { recursive: true });
					}
					fs.writeFileSync(absPath, content, { encoding: 'utf-8' });
					return `已写入（降级模式）: ${filePath}`;
				} catch (fallbackError) {
					const primary = error instanceof Error ? error.message : String(error);
					const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(`写入失败（Obsidian API）: ${primary}\n写入失败（Node 降级）: ${fallback}`);
				}
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
