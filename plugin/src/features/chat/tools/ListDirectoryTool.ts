import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface ListDirectoryArgs {
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
		description: '列出指定目录下的文件和子文件夹。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'FolderOpen',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: '目录路径，相对于 vault 根目录。空字符串或 "/" 表示根目录'
				}
			},
			required: ['path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ListDirectoryArgs;
			const rawPath = String(args.path ?? '').trim();
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
