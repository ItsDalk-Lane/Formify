import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

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

export const createWriteFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'write_file',
		name: 'write_file',
		description: '向文件写入内容。如果文件不存在则创建新文件，存在则覆盖。支持 Markdown 和纯文本文件。',
		enabled: true,
		executionMode: 'manual',
		category: 'file',
		icon: 'FileText',
		parameters: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: '文件路径，相对于 vault 根目录。例如: notes/我的笔记.md'
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
				createFolders: {
					type: 'boolean',
					description: '如果父文件夹不存在，是否自动创建。默认 true。'
				}
			},
			required: ['content']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as WriteFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(
					args.filePath,
					args.path,
					args.file_path,
					args.filePath
				)
			) || buildFallbackPath(args);
			const content = coalesceString(args.content, args.text, args.body, args.data, args.translation);
			const createFolders = args.createFolders !== false;

			if (!filePath) {
				throw new Error('filePath 不能为空');
			}
			if (!content) {
				throw new Error('content 不能为空');
			}

			const parent = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';

			// 1) 优先使用 Obsidian API
			try {
				if (createFolders && parent) {
					await ensureFolderExists(app, parent);
				}

				const existing = app.vault.getAbstractFileByPath(filePath);
				if (existing instanceof TFile) {
					await app.vault.modify(existing, content);
					return `已覆盖写入: ${filePath}`;
				}

				await app.vault.create(filePath, content);
				return `已创建并写入: ${filePath}`;
			} catch (error) {
				// 2) 降级到 Node.js API
				try {
					const adapter: any = app.vault.adapter as any;
					const basePath: string | undefined = adapter?.basePath;
					if (!basePath) {
						throw new Error('无法获取 vault 物理路径（basePath）');
					}

					const absPath = path.join(basePath, filePath);
					if (createFolders) {
						fs.mkdirSync(path.dirname(absPath), { recursive: true });
					}
					fs.writeFileSync(absPath, content, { encoding: 'utf-8' });
					return `已写入（降级模式）: ${filePath}`;
				} catch (fallbackError) {
					const primary = error instanceof Error ? error.message : String(error);
					const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(`写入失败（Obsidian API）: ${primary}\n写入失败（Node 降级）: ${fallback}`);
				}
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
