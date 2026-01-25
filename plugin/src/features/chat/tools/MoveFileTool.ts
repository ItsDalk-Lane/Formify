import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';
import { PathResolverService } from '../../../service/PathResolverService';

interface MoveFileArgs {
	// 新参数名（优先）
	source_file_name_or_path?: string;
	target_file_name_or_path?: string;
	// 兼容旧参数名
	from?: string;
	to?: string;
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
		description: `将文件从一个位置移动到另一个位置，或重命名文件。当用户想要「移动」「重命名」「转移」「归档」文件时使用此工具。

源路径支持模糊匹配：你可以只传入文件名（如 "001"），系统会自动定位。
目标路径需要是完整的新路径（含文件名）。

⛔ 负面约束：
- 如果只是想读取或修改文件内容，不要使用此工具。
- 此工具会自动创建目标文件夹，但如果目标文件已存在则会报错。
- 不支持移动文件夹，仅支持移动单个文件。`,
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'Move',
		parameters: {
			type: 'object',
			properties: {
				source_file_name_or_path: {
					type: 'string',
					description: '源文件名或路径。可传入完整路径或仅文件名（如 "001.md"），系统会自动定位。'
				},
				target_file_name_or_path: {
					type: 'string',
					description: '目标文件路径（需要是完整的新路径，含文件名）。'
				},
				// 兼容旧参数名
				from: {
					type: 'string',
					description: '（已弃用，请使用 source_file_name_or_path）源文件路径，相对于 vault 根目录。'
				},
				to: {
					type: 'string',
					description: '（已弃用，请使用 target_file_name_or_path）目标文件路径（包含新文件名），相对于 vault 根目录。'
				}
			},
			required: ['source_file_name_or_path', 'target_file_name_or_path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as MoveFileArgs;
			const from = normalizeVaultPath(
				args.source_file_name_or_path ?? args.from ?? ''
			);
			const to = normalizeVaultPath(
				args.target_file_name_or_path ?? args.to ?? ''
			);

			if (!from || !to) {
				throw new Error('source_file_name_or_path 和 target_file_name_or_path 不能为空。示例: source="notes/a.md", target="archive/a.md"');
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

			// 使用模糊路由解析源文件路径
			const resolver = new PathResolverService(app);
			const sourceResult = await resolver.resolvePath(from, {
				allowFuzzyMatch: true,
				requireFile: true
			});

			if (!sourceResult.success || !sourceResult.file) {
				throw new Error(sourceResult.error || `源文件未找到: ${from}`);
			}

			const source = sourceResult.file;
			if (source instanceof TFolder) {
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
