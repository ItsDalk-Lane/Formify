import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface SearchFilesArgs {
	query: string;
	scope?: string;
	limit?: number;
}

interface SearchFileItem {
	path: string;
	name: string;
	folder: string;
	size: number;
	mtime: string;
}

interface SearchFilesResult {
	query: string;
	scope: string;
	results: SearchFileItem[];
	totalCount: number;
	message: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

const formatMtime = (mtime?: number): string => {
	if (!mtime || Number.isNaN(mtime)) return '';
	return new Date(mtime).toISOString();
};

export const createSearchFilesTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'search_files',
		name: 'search_files',
		description: '根据文件名或路径模式搜索文件（不读取内容）。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'Search',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: '搜索关键词，匹配文件名或路径（大小写不敏感）'
				},
				scope: {
					type: 'string',
					description: '搜索范围，默认 vault（全库）或指定文件夹路径'
				},
				limit: {
					type: 'number',
					description: '返回结果数量上限，默认 100'
				}
			},
			required: ['query']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as SearchFilesArgs;
			const query = String(args.query ?? '').trim();
			const scopeRaw = String(args.scope ?? 'vault').trim();
			const limit = Number.isFinite(args.limit) ? Number(args.limit) : 100;

			if (!query) {
				throw new Error('query 不能为空。示例: "daily" 或 "notes/2024"');
			}

			const normalizedScope = scopeRaw === 'vault' ? '' : normalizeVaultPath(scopeRaw);
			if (normalizedScope) {
				const scopeFolder = app.vault.getAbstractFileByPath(normalizedScope);
				if (!scopeFolder || !(scopeFolder instanceof TFolder)) {
					throw new Error(`搜索范围目录未找到: ${normalizedScope}`);
				}
			}

			const queryLower = query.toLowerCase();
			const allFiles = app.vault.getFiles();
			const matched = allFiles.filter((file) => {
				if (normalizedScope && !file.path.startsWith(`${normalizedScope}/`) && file.path !== normalizedScope) {
					return false;
				}
				const name = file.name.toLowerCase();
				const path = file.path.toLowerCase();
				return name.includes(queryLower) || path.includes(queryLower);
			});

			const totalCount = matched.length;
			const sliced = matched.slice(0, Math.max(0, limit));

			const results: SearchFileItem[] = [];
			for (const file of sliced) {
				const stat = await app.vault.adapter.stat(file.path);
				results.push({
					path: file.path,
					name: file.name,
					folder: file.parent?.path ?? '',
					size: stat?.size ?? 0,
					mtime: formatMtime(stat?.mtime)
				});
			}

			const message = totalCount === 0
				? 'No matching files found'
				: totalCount > results.length
					? `Found ${totalCount} files, showing first ${results.length}`
					: `Found ${totalCount} files`;

			const result: SearchFilesResult = {
				query,
				scope: normalizedScope || 'vault',
				results,
				totalCount,
				message
			};
			return result;
		},
		createdAt: now,
		updatedAt: now
	};
};
