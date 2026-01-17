import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface MoveFileArgs {
	from: string;
	to: string;
}

interface MoveFileResult {
	from: string;
	to: string;
	message: string;
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

export const createMoveFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'move_file',
		name: 'move_file',
		description: '将文件从一个位置移动到另一个位置（支持重命名）。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'Move',
		parameters: {
			type: 'object',
			properties: {
				from: {
					type: 'string',
					description: '源文件路径，相对于 vault 根目录'
				},
				to: {
					type: 'string',
					description: '目标文件路径（包含新文件名），相对于 vault 根目录'
				}
			},
			required: ['from', 'to']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as MoveFileArgs;
			const from = normalizeVaultPath(args.from);
			const to = normalizeVaultPath(args.to);

			if (!from || !to) {
				throw new Error('from 和 to 不能为空。示例: from="notes/a.md", to="archive/a.md"');
			}

			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(from) || invalidChars.test(to)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			if (from === to) {
				const result: MoveFileResult = {
					from,
					to,
					message: 'Source and target are the same, no move needed'
				};
				return result;
			}

			const source = app.vault.getAbstractFileByPath(from);
			if (!source) {
				throw new Error(`源文件未找到: ${from}`);
			}
			if (source instanceof TFolder || !(source instanceof TFile)) {
				throw new Error('源路径指向文件夹，move_file 仅支持移动文件');
			}

			const targetExists = app.vault.getAbstractFileByPath(to);
			if (targetExists) {
				throw new Error(`目标文件已存在: ${to}`);
			}

			const parent = to.includes('/') ? to.split('/').slice(0, -1).join('/') : '';

			// 1) 优先使用 Obsidian API
			try {
				if (parent) {
					await ensureFolderExists(app, parent);
				}
				await app.vault.rename(source, to);
				const result: MoveFileResult = {
					from,
					to,
					message: 'File moved successfully'
				};
				return result;
			} catch (error) {
				// 2) 降级到 Node.js API
				try {
					const adapter: any = app.vault.adapter as any;
					const basePath: string | undefined = adapter?.basePath;
					if (!basePath) {
						throw new Error('无法获取 vault 物理路径（basePath）');
					}
					const absFrom = path.join(basePath, from);
					const absTo = path.join(basePath, to);
					if (!fs.existsSync(absFrom)) {
						throw new Error(`源文件未找到: ${from}`);
					}
					if (fs.existsSync(absTo)) {
						throw new Error(`目标文件已存在: ${to}`);
					}
					const stat = fs.statSync(absFrom);
					if (stat.isDirectory()) {
						throw new Error('源路径指向文件夹，move_file 仅支持移动文件');
					}
					if (parent) {
						fs.mkdirSync(path.dirname(absTo), { recursive: true });
					}
					fs.renameSync(absFrom, absTo);
					const result: MoveFileResult = {
						from,
						to,
						message: 'File moved successfully'
					};
					return result;
				} catch (fallbackError) {
					const primary = error instanceof Error ? error.message : String(error);
					const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(`移动失败（Obsidian API）: ${primary}\n移动失败（Node 降级）: ${fallback}`);
				}
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
