import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface WriteFileArgs {
	filePath: string;
	content: string;
	createFolders?: boolean;
	fileName?: string;
	folderPath?: string;
	fileTitle?: string;
	extension?: string;
	path?: string;
	file_path?: string;
	filename?: string;
	name?: string;
	title?: string;
	text?: string;
	body?: string;
	data?: string;
	translation?: string;
	parent?: string;
	dir?: string;
	directory?: string;
	targetFolder?: string;
	template?: string;
	variables?: Record<string, any>;
	conflictStrategy?: 'error' | 'overwrite' | 'rename' | 'skip';
}

interface WriteFileResult {
	writeType: 'create' | 'overwrite' | 'skipped';
	path: string;
	characterCount: number;
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

const ensureExtension = (fileName: string, extension?: string): string => {
	const trimmed = String(fileName ?? '').trim();
	if (!trimmed) return '';
	if (trimmed.includes('.')) return trimmed;
	const ext = String(extension ?? '').trim();
	if (ext) {
		return ext.startsWith('.') ? `${trimmed}${ext}` : `${trimmed}.${ext}`;
	}
	return `${trimmed}.md`;
};

const buildFallbackPath = (args: WriteFileArgs): string => {
	const folder = coalesceString(args.folderPath, args.targetFolder, args.parent, args.dir, args.directory);
	const name = coalesceString(args.fileName, args.filename, args.fileTitle, args.title, args.name);
	const ensuredName = ensureExtension(name || '翻译结果', args.extension);
	if (!ensuredName) return '';
	const combined = folder ? `${folder}/${ensuredName}` : ensuredName;
	return normalizeVaultPath(combined);
};

export const createWriteFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'write_file',
		name: 'write_file',
		description: '向文件写入内容。如果文件不存在则创建新文件，存在则覆盖。支持 Markdown 和纯文本文件。',
		enabled: true,
			executionMode: 'auto',
		category: 'file',
		icon: 'FileText',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: '文件路径，相对于 vault 根目录。例如: notes/我的笔记.md'
				},
				filePath: {
					type: 'string',
					description: '文件路径（兼容字段），相对于 vault 根目录。例如: notes/我的笔记.md'
				},
				fileName: {
					type: 'string',
					description: '文件名（可不含扩展名）。当未提供 filePath 时使用'
				},
				folderPath: {
					type: 'string',
					description: '父文件夹路径（相对 vault 根目录）。当未提供 filePath 时使用'
				},
				fileTitle: {
					type: 'string',
					description: '文件标题（将转换为文件名）。当未提供 filePath 时使用'
				},
				extension: {
					type: 'string',
					description: '文件扩展名，例如 md 或 txt。未提供时默认 md'
				},
				content: {
					type: 'string',
					description: '要写入的内容'
				},
				template: {
					type: 'string',
					description: '（可选）模板文件路径，如果指定则从模板创建'
				},
				variables: {
					type: 'object',
					description: '（可选）变量替换，用于模板中的变量替换'
				},
				conflictStrategy: {
					type: 'string',
					description: '冲突解决策略，可选：overwrite、rename、skip、error。默认 overwrite'
				},
				createFolders: {
					type: 'boolean',
					description: '如果父文件夹不存在，是否自动创建。默认 true。'
				}
			},
			required: ['path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as WriteFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(
					args.path,
					args.filePath,
					args.file_path
				)
			);
			const content = coalesceString(args.content, args.text, args.body, args.data, args.translation);
			const createFolders = args.createFolders !== false;
			const template = coalesceString(args.template);
			const variables = args.variables ?? {};
			const conflictStrategy = args.conflictStrategy ?? 'overwrite';

			let resolvedPath = filePath;
			if (!resolvedPath) {
				const fallback = buildFallbackPath(args);
				if (!fallback) {
					throw new Error('path 不能为空。示例: "notes/my-note.md"');
				}
				resolvedPath = fallback;
			}

			// 非法字符检测
			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(resolvedPath)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			const isEmpty = !content || content.trim().length === 0;
			const service = new FileOperationService(app);
			const result = await service.writeFile({
				path: resolvedPath,
				content,
				template,
				variables,
				createFolders,
				conflictStrategy,
				silent: true
			});
			if (!result.success) {
				throw new Error(result.error || '写入失败');
			}
			const finalPath = result.actualPath || result.path;
			const writeType = result.action === 'skipped' ? 'skipped' : result.action;
			return {
				writeType,
				path: finalPath,
				characterCount: result.bytesWritten ?? content.length,
				message: isEmpty ? 'Content write successful (empty file)' : 'Content write successful'
			};
		},
		createdAt: now,
		updatedAt: now
	};
};
