import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface ListDirectoryArgs {
	// 新参数名（优先）
	folder_name_or_path?: string;
	// 兼容旧参数名
	path?: string;
}

interface DirectoryItem {
	name: string;
	type: 'File' | 'Folder';
	size?: string;
	mtime?: string;
}

interface ListDirectoryResult {
	path: string;
	items: DirectoryItem[];
	count: number;
	message: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

const formatMtime = (mtime?: number): string | undefined => {
	if (!mtime || Number.isNaN(mtime)) return undefined;
	const date = new Date(mtime);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatSize = (size?: number): string | undefined => {
	if (size === undefined || size === null || Number.isNaN(size)) return undefined;
	if (size < 1024) return `${size} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = size / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(2)} ${units[unitIndex]}`;
};

export const createListDirectoryTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'list_directory',
		name: 'list_directory',
		description: `列出指定目录下的所有文件和子文件夹。当用户想要「看看文件夹里有什么」「列出目录」「浏览文件结构」时使用此工具。

传入空字符串或 "/" 表示列出 vault 根目录。支持模糊目录名。

⛔ 负面约束：
- 如果用户想要搜索某个文件名，不要遍历多个目录，应使用 search_files。
- 如果用户想要搜索文件内容，不要用此工具逐个查看，应使用 search_content。
- 此工具只返回直接子项，不会递归列出所有层级。`,
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'FolderOpen',
		parameters: {
			type: 'object',
			properties: {
				folder_name_or_path: {
					type: 'string',
					description: '目录名或路径。可传入完整路径或仅目录名，空字符串或 "/" 表示根目录。'
				},
				// 兼容旧参数名
				path: {
					type: 'string',
					description: '（已弃用，请使用 folder_name_or_path）目录路径，相对于 vault 根目录。'
				}
			},
			required: ['folder_name_or_path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ListDirectoryArgs;
			const rawPath = String(args.folder_name_or_path ?? args.path ?? '').trim();
			const normalized = normalizeVaultPath(rawPath);

			const invalidChars = /[<>:"|?*]/;
			if (normalized && invalidChars.test(normalized)) {
				throw new Error('目录路径包含非法字符: < > : " | ? *');
			}

			const folder = normalized ? app.vault.getAbstractFileByPath(normalized) : app.vault.getRoot();
			if (!folder) {
				throw new Error(`目录未找到: ${normalized || '/'}`);
			}
			if (!(folder instanceof TFolder)) {
				throw new Error('路径指向文件，list_directory 仅支持目录');
			}

			// 1) 优先使用 Obsidian API
			try {
				const items: DirectoryItem[] = await Promise.all(
					folder.children.map(async (child) => {
						if (child instanceof TFile) {
							const stat = await app.vault.adapter.stat(child.path);
							return {
								name: child.name,
								type: 'File',
								size: formatSize(stat?.size),
								mtime: formatMtime(stat?.mtime)
							};
						}
						if (child instanceof TFolder) {
							const stat = await app.vault.adapter.stat(child.path);
							return {
								name: child.name,
								type: 'Folder',
								mtime: formatMtime(stat?.mtime)
							};
						}
						return {
							name: child.name,
							type: 'File'
						};
					})
				);

				const result: ListDirectoryResult = {
					path: normalized || '/',
					items,
					count: items.length,
					message: items.length === 0 ? 'Directory is empty' : 'Directory list successful'
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
					const absPath = normalized ? path.join(basePath, normalized) : basePath;
					if (!fs.existsSync(absPath)) {
						throw new Error(`目录未找到: ${normalized || '/'}`);
					}
					const stat = fs.statSync(absPath);
					if (!stat.isDirectory()) {
						throw new Error('路径指向文件，list_directory 仅支持目录');
					}
					const entries = fs.readdirSync(absPath, { withFileTypes: true });
					const items: DirectoryItem[] = entries.map((entry) => {
						const entryPath = path.join(absPath, entry.name);
						const entryStat = fs.statSync(entryPath);
						if (entry.isDirectory()) {
							return {
								name: entry.name,
								type: 'Folder',
								mtime: formatMtime(entryStat.mtimeMs)
							};
						}
						return {
							name: entry.name,
							type: 'File',
							size: formatSize(entryStat.size),
							mtime: formatMtime(entryStat.mtimeMs)
						};
					});
					const result: ListDirectoryResult = {
						path: normalized || '/',
						items,
						count: items.length,
						message: items.length === 0 ? 'Directory is empty' : 'Directory list successful'
					};
					return result;
				} catch (fallbackError) {
					const primary = error instanceof Error ? error.message : String(error);
					const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(`列出目录失败（Obsidian API）: ${primary}\n列出目录失败（Node 降级）: ${fallback}`);
				}
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
