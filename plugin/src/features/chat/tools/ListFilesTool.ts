import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface ListFilesArgs {
	folderPath?: string;
	recursive?: boolean;
	includeFiles?: boolean;
	includeFolders?: boolean;
	extensions?: string[];
	maxItems?: number;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	if (!trimmed || trimmed === '/' || trimmed === '.') return '';
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

/**
 * 获取文件夹中的内容
 */
const getContents = (
	app: App,
	folder: TFolder,
	options: {
		recursive: boolean;
		includeFiles: boolean;
		includeFolders: boolean;
		extensions: string[] | null;
		maxItems: number;
		currentCount: { value: number };
	}
): string[] => {
	const results: string[] = [];

	for (const child of folder.children) {
		if (options.currentCount.value >= options.maxItems) break;

		if (child instanceof TFile && options.includeFiles) {
			// 检查扩展名过滤
			if (options.extensions && options.extensions.length > 0) {
				const ext = child.extension.toLowerCase();
				if (!options.extensions.includes(ext)) continue;
			}
			results.push(child.path);
			options.currentCount.value++;
		} else if (child instanceof TFolder) {
			if (options.includeFolders) {
				results.push(child.path + '/');
				options.currentCount.value++;
			}
			if (options.recursive && options.currentCount.value < options.maxItems) {
				results.push(...getContents(app, child, options));
			}
		}
	}

	return results;
};

/**
 * 列出文件工具
 */
export const createListFilesTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'list_files',
		name: 'list_files',
		description: '列出 vault 中指定文件夹的文件和子文件夹。可以选择递归列出、过滤文件类型等。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'FolderTree',
		parameters: {
			type: 'object',
			properties: {
				folderPath: {
					type: 'string',
					description: '文件夹路径，相对于 vault 根目录。留空表示根目录。例如: notes 或 projects/2024'
				},
				recursive: {
					type: 'boolean',
					description: '是否递归列出子文件夹中的内容。默认 false。'
				},
				includeFiles: {
					type: 'boolean',
					description: '是否包含文件。默认 true。'
				},
				includeFolders: {
					type: 'boolean',
					description: '是否包含文件夹。默认 true。'
				},
				extensions: {
					type: 'array',
					description: '只包含指定扩展名的文件。例如: ["md", "txt"]。留空表示所有文件。'
				},
				maxItems: {
					type: 'number',
					description: '最多返回的条目数。默认 100。'
				}
			},
			required: []
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ListFilesArgs;
			const folderPath = normalizeVaultPath(args.folderPath ?? '');
			const recursive = args.recursive ?? false;
			const includeFiles = args.includeFiles !== false;
			const includeFolders = args.includeFolders !== false;
			const extensions = args.extensions?.map(e => e.toLowerCase().replace(/^\./, '')) ?? null;
			const maxItems = Math.min(args.maxItems ?? 100, 500);

			// 获取目标文件夹
			let targetFolder: TFolder;

			if (!folderPath) {
				targetFolder = app.vault.getRoot();
			} else {
				const folder = app.vault.getAbstractFileByPath(folderPath);
				if (!folder) {
					throw new Error(`文件夹不存在: ${folderPath}`);
				}
				if (!(folder instanceof TFolder)) {
					throw new Error(`路径不是文件夹: ${folderPath}`);
				}
				targetFolder = folder;
			}

			const currentCount = { value: 0 };
			const contents = getContents(app, targetFolder, {
				recursive,
				includeFiles,
				includeFolders,
				extensions,
				maxItems,
				currentCount
			});

			if (contents.length === 0) {
				return `文件夹为空: ${folderPath || '(根目录)'}`;
			}

			let result = `共 ${contents.length} 个项目`;
			if (currentCount.value >= maxItems) {
				result += ` (已达最大限制 ${maxItems})`;
			}
			result += ':\n\n';
			result += contents.join('\n');

			return result;
		},
		createdAt: now,
		updatedAt: now
	};
};
