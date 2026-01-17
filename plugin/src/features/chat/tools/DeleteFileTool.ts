import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface DeleteFileArgs {
	path?: string;
	filePath?: string;
	file_path?: string;
}

interface DeleteFileResult {
	path: string;
	existed: boolean;
	message: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

const coalesceString = (...values: Array<unknown>): string => {
	for (const value of values) {
		const text = String(value ?? '').trim();
		if (text) return text;
	}
	return '';
};

export const createDeleteFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'delete_file',
		name: 'delete_file',
		description: '删除指定路径的文件或文件夹。如果删除文件夹，将递归删除其中的所有内容。',
		enabled: true,
		executionMode: 'manual',
		category: 'file',
		icon: 'Trash2',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: '要删除的文件或文件夹路径，相对于 vault 根目录'
				}
			},
			required: ['path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as DeleteFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(args.path, args.filePath, args.file_path)
			);

			if (!filePath) {
				throw new Error('path 不能为空。示例: "notes/my-note.md"');
			}

			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(filePath)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			const existing = app.vault.getAbstractFileByPath(filePath);
		if (!existing) {
			const result: DeleteFileResult = {
				path: filePath,
				existed: false,
				message: 'File/Folder not found, nothing to delete'
			};
			return result;
		}

		// 1) 优先使用 Obsidian API（支持文件和文件夹）
		try {
			await app.vault.delete(existing);
			const result: DeleteFileResult = {
				path: filePath,
				existed: true,
				message: existing instanceof TFolder ? 'Folder deleted successfully' : 'File deleted successfully'
			};
			return result;
		} catch (error) {
			// 2) 降级到 Node.js API（支持文件和文件夹）
			try {
				const adapter: any = app.vault.adapter as any;
				const basePath: string | undefined = adapter?.basePath;
				if (!basePath) {
					throw new Error('无法获取 vault 物理路径（basePath）');
				}
				const absPath = path.join(basePath, filePath);
				if (!fs.existsSync(absPath)) {
					const result: DeleteFileResult = {
						path: filePath,
						existed: false,
						message: 'File/Folder not found, nothing to delete'
					};
					return result;
				}
				const stat = fs.statSync(absPath);
				if (stat.isDirectory()) {
					// 递归删除文件夹
					fs.rmSync(absPath, { recursive: true, force: true });
				} else {
					// 删除文件
					fs.unlinkSync(absPath);
				}
				const result: DeleteFileResult = {
					path: filePath,
					existed: true,
					message: stat.isDirectory() ? 'Folder deleted successfully' : 'File deleted successfully'
				};
				return result;
			} catch (fallbackError) {
				const primary = error instanceof Error ? error.message : String(error);
				const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
				throw new Error(`删除失败（Obsidian API）: ${primary}\n删除失败（Node 降级）: ${fallback}`);
			}
		}
		},
		createdAt: now,
		updatedAt: now
	};
};
