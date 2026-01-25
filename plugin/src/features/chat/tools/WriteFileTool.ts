import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface WriteFileArgs {
	// 新参数名（优先）
	file_name_or_path?: string;
	content?: string;
	createFolders?: boolean;
	fileName?: string;
	folderPath?: string;
	fileTitle?: string;
	extension?: string;
	// 兼容旧参数名
	path?: string;
	file_path?: string;
	filePath?: string;
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
		description: `创建新文件或完全覆盖现有文件内容。当用户想要「新建」「创建」「写入」「保存」笔记时使用此工具。

你可以传入完整路径（如 "notes/新笔记.md"），也可以只传入文件名（如 "新笔记"），系统会自动处理。

⛔ 负面约束（重要）：
- 如果用户只是想在现有文件「末尾添加」「追加」内容，严禁使用此工具！使用此工具会完全覆盖原文。
- 对于追加操作，应该先用 read_file 读取原内容，然后将新内容拼接后再写入。
- 如果不确定文件是否存在、是否会误覆盖，请先用 read_file 确认。`,
		enabled: true,
			executionMode: 'auto',
		category: 'file',
		icon: 'FileText',
		parameters: {
			type: 'object',
			properties: {
				file_name_or_path: {
					type: 'string',
					description: '文件名或路径。可传入完整路径（如 "notes/新笔记.md"）或仅文件名（如 "新笔记"）。'
				},
				// 兼容旧参数名（保持别名兼容）
				path: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）文件路径，相对于 vault 根目录。'
				},
				filePath: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）文件路径，相对于 vault 根目录。'
				},
				file_path: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）文件路径，相对于 vault 根目录。'
				},
				fileName: {
					type: 'string',
					description: '文件名（可不含扩展名）。当未提供 file_name_or_path 时使用'
				},
				folderPath: {
					type: 'string',
					description: '父文件夹路径（相对 vault 根目录）。当未提供 file_name_or_path 时使用'
				},
				fileTitle: {
					type: 'string',
					description: '文件标题（将转换为文件名）。当未提供 file_name_or_path 时使用'
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
			required: []  // 移除必填要求，支持 fileName/folderPath 等组合方式
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as WriteFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(
					args.file_name_or_path,
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
					throw new Error('file_name_or_path 不能为空。示例: "notes/my-note.md" 或 "my-note.md"');
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
