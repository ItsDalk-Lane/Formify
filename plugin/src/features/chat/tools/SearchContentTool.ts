import { TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface SearchContentArgs {
	query: string;
	scope?: string;
	limit?: number;
}

interface ContentMatch {
	line: number;
	text: string;
}

interface ContentResult {
	path: string;
	name: string;
	matches: ContentMatch[];
}

interface SearchContentResult {
	query: string;
	scope: string;
	results: ContentResult[];
	totalCount: number;
	message: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

const binaryExtensions = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
	'pdf', 'zip', 'rar', '7z', 'tar', 'gz',
	'exe', 'dll', 'bin', 'dmg',
	'mp3', 'mp4', 'mov', 'avi', 'wav'
]);

const isBinaryExtension = (extension: string): boolean => {
	const ext = String(extension ?? '').trim().toLowerCase();
	return binaryExtensions.has(ext);
};

const buildSnippet = (line: string): string => {
	const trimmed = line.trim();
	if (trimmed.length <= 200) return trimmed;
	return `${trimmed.slice(0, 200)}...`;
};

export const createSearchContentTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'search_content',
		name: 'search_content',
		description: `在笔记内容中进行全文搜索，查找「包含指定关键词」的文件。当用户想要「搜索内容」「查找提到 xxx 的笔记」「哪个文件里写了 xxx」时使用此工具。

返回结果包含匹配行的上下文片段。

⛔ 负面约束：
- 当用户只是想按文件名查找时，不要使用此工具，应使用 search_files。
- 当用户已经知道要读取哪个文件时，不要使用此工具，应直接使用 read_file。
- 此工具会遍历大量文件，对于只需要定位单个已知文件的场景是浪费性能的。`,
		enabled: true,
		executionMode: 'auto',
		category: 'search',
		icon: 'Search',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: '搜索关键词或短语（大小写不敏感）'
				},
				scope: {
					type: 'string',
					description: '搜索范围，默认 vault（全库）或指定文件夹路径'
				},
				limit: {
					type: 'number',
					description: '返回结果数量上限，默认 10'
				}
			},
			required: ['query']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as SearchContentArgs;
			const query = String(args.query ?? '').trim();
			const scopeRaw = String(args.scope ?? 'vault').trim();
			const limit = Number.isFinite(args.limit) ? Number(args.limit) : 10;

			if (!query) {
				throw new Error('query 不能为空。示例: "项目计划"');
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
			const results: ContentResult[] = [];
			let totalCount = 0;

			for (const file of allFiles) {
				if (normalizedScope && !file.path.startsWith(`${normalizedScope}/`) && file.path !== normalizedScope) {
					continue;
				}
				if (isBinaryExtension(file.extension)) {
					continue;
				}
				const content = await app.vault.read(file);
				const lines = content.split(/\r?\n/);
				const matches: ContentMatch[] = [];
				for (let i = 0; i < lines.length; i += 1) {
					const line = lines[i];
					if (line.toLowerCase().includes(queryLower)) {
						matches.push({
							line: i + 1,
							text: buildSnippet(line)
						});
					}
				}
				if (matches.length > 0) {
					totalCount += 1;
					if (results.length < Math.max(0, limit)) {
						results.push({
							path: file.path,
							name: file.name,
							matches
						});
					}
				}
			}

			const message = totalCount === 0
				? 'No matching content found'
				: totalCount > results.length
					? `Found ${totalCount} files, showing first ${results.length}`
					: `Found ${totalCount} files`;

			const result: SearchContentResult = {
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
