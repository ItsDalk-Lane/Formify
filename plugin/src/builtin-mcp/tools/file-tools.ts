import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import micromatch from 'micromatch';
import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { z } from 'zod';
import {
	DEFAULT_SEARCH_CONTENT_MAX_RESULTS,
	DEFAULT_SEARCH_FILES_MAX_RESULTS,
} from '../constants';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import {
	assertVaultPath,
	ensureParentFolderExists,
	getFileOrThrow,
	getFolderOrThrow,
	normalizeVaultPath,
	resolveRegex,
} from './helpers';

const readFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	offset: z.number().int().min(0).default(0).optional(),
	length: z.number().int().min(0).optional(),
});

const writeFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	content: z.string().describe('写入内容'),
	mode: z.enum(['write', 'append']).default('write').optional(),
});

const deleteFileSchema = z.object({
	path: z.string().min(1).describe('要删除的文件或文件夹路径'),
	force: z.boolean().default(true).optional(),
});

const moveFileSchema = z.object({
	source: z.string().min(1).describe('原路径'),
	destination: z.string().min(1).describe('目标路径'),
});

const listDirectorySchema = z.object({
	path: z.string().default('').optional().describe('目录路径，默认根目录'),
	regex: z.string().optional().describe('用于过滤名称的 JS 正则表达式'),
});

const searchFilesSchema = z.object({
	pattern: z.string().min(1).describe('glob 模式，如 **/*.md'),
	maxResults: z
		.number()
		.int()
		.min(1)
		.default(DEFAULT_SEARCH_FILES_MAX_RESULTS)
		.optional(),
});

const searchContentSchema = z.object({
	pattern: z.string().min(1).describe('正则表达式字符串'),
	path: z.string().optional().describe('限定搜索目录'),
	fileType: z.string().optional().describe('扩展名过滤，如 md 或 ts,tsx'),
	maxResults: z
		.number()
		.int()
		.min(1)
		.default(DEFAULT_SEARCH_CONTENT_MAX_RESULTS)
		.optional(),
	caseSensitive: z.boolean().default(false).optional(),
	contextLines: z.number().int().min(0).optional(),
});

const toStatInfo = (file: TFile): { size: number; mtime: number; ctime: number } => ({
	size: file.stat?.size ?? 0,
	mtime: file.stat?.mtime ?? 0,
	ctime: file.stat?.ctime ?? 0,
});

const matchesPathScope = (filePath: string, scope: string): boolean => {
	if (!scope) return true;
	return filePath === scope || filePath.startsWith(`${scope}/`);
};

const getTargetFilesForSearchContent = (
	app: App,
	scopePath: string
): TFile[] => {
	if (!scopePath) {
		return app.vault.getFiles();
	}

	const target = app.vault.getAbstractFileByPath(scopePath);
	if (!target) {
		throw new Error(`搜索路径不存在: ${scopePath}`);
	}
	if (target instanceof TFile) {
		return [target];
	}
	return app
		.vault
		.getFiles()
		.filter((file) => matchesPathScope(file.path, scopePath));
};

const parseFileTypeFilter = (fileType?: string): Set<string> => {
	const raw = String(fileType ?? '').trim();
	if (!raw) return new Set();
	return new Set(
		raw
			.split(',')
			.map((item) => item.trim().toLowerCase())
			.filter((item) => !!item)
			.map((item) => item.replace(/^\./, ''))
	);
};

const readFileWithRange = (
	content: string,
	offset: number,
	length?: number
): string => {
	const start = Math.max(0, Math.floor(offset));
	if (length === undefined) {
		return content.substring(start);
	}
	return content.substring(start, start + Math.max(0, Math.floor(length)));
};

const deleteFolder = async (
	app: App,
	folder: TFolder,
	force: boolean
): Promise<void> => {
	if (force) {
		await app.vault.delete(folder, true);
		return;
	}
	if (folder.children.length > 0) {
		throw new Error(`文件夹非空，且 force=false: ${folder.path}`);
	}
	await app.vault.delete(folder, false);
};

export function registerFileTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry
): void {
	registerTextTool(
		server,
		registry,
		'read_file',
		'读取 Vault 文件内容，支持 offset/length 截取。',
		readFileSchema,
		async ({ path, offset = 0, length }) => {
			const normalizedPath = normalizeVaultPath(path);
			assertVaultPath(normalizedPath, 'path');
			const file = getFileOrThrow(app, normalizedPath);
			const content = await app.vault.cachedRead(file);
			return readFileWithRange(content, offset, length);
		}
	);

	registerTextTool(
		server,
		registry,
		'write_file',
		'写入或创建 Vault 文件。mode=write 覆盖写，mode=append 追加写。',
		writeFileSchema,
		async ({ path, content, mode = 'write' }) => {
			const normalizedPath = normalizeVaultPath(path);
			assertVaultPath(normalizedPath, 'path');
			await ensureParentFolderExists(app, normalizedPath);

			const existing = app.vault.getAbstractFileByPath(normalizedPath);
			if (existing && !(existing instanceof TFile)) {
				throw new Error(`目标路径是文件夹: ${normalizedPath}`);
			}

			if (!existing) {
				await app.vault.create(normalizedPath, content);
				return {
					path: normalizedPath,
					mode,
					created: true,
					bytes: content.length,
				};
			}

			if (mode === 'append') {
				const prev = await app.vault.cachedRead(existing);
				const next = `${prev}${content}`;
				await app.vault.modify(existing, next);
				return {
					path: normalizedPath,
					mode,
					created: false,
					bytes: content.length,
				};
			}

			await app.vault.modify(existing, content);
			return {
				path: normalizedPath,
				mode,
				created: false,
				bytes: content.length,
			};
		}
	);

	registerTextTool(
		server,
		registry,
		'delete_file',
		'删除 Vault 文件或文件夹。文件夹可通过 force 控制是否递归删除。',
		deleteFileSchema,
		async ({ path, force = true }) => {
			const normalizedPath = normalizeVaultPath(path);
			assertVaultPath(normalizedPath, 'path');
			const target = app.vault.getAbstractFileByPath(normalizedPath);
			if (!target) {
				throw new Error(`路径不存在: ${normalizedPath}`);
			}

			if (target instanceof TFile) {
				await app.vault.delete(target);
				return {
					path: normalizedPath,
					type: 'file',
					deleted: true,
				};
			}

			await deleteFolder(app, target, force);
			return {
				path: normalizedPath,
				type: 'folder',
				deleted: true,
				force,
			};
		}
	);

	registerTextTool(
		server,
		registry,
		'move_file',
		'移动或重命名 Vault 文件/文件夹。',
		moveFileSchema,
		async ({ source, destination }) => {
			const normalizedSource = normalizeVaultPath(source);
			const normalizedDestination = normalizeVaultPath(destination);
			assertVaultPath(normalizedSource, 'source');
			assertVaultPath(normalizedDestination, 'destination');

			const target = app.vault.getAbstractFileByPath(normalizedSource);
			if (!target) {
				throw new Error(`源路径不存在: ${normalizedSource}`);
			}

			const existsDestination = app.vault.getAbstractFileByPath(normalizedDestination);
			if (existsDestination) {
				throw new Error(`目标路径已存在: ${normalizedDestination}`);
			}

			await ensureParentFolderExists(app, normalizedDestination);
			await app.vault.rename(target, normalizedDestination);
			return {
				source: normalizedSource,
				destination: normalizedDestination,
				moved: true,
			};
		}
	);

	registerTextTool(
		server,
		registry,
		'list_directory',
		'列出目录下的直接子项，可用 regex 过滤名称。',
		listDirectorySchema,
		async ({ path = '', regex }) => {
			const normalizedPath = normalizeVaultPath(path);
			if (normalizedPath) {
				assertVaultPath(normalizedPath, 'path');
			}
			const folder = getFolderOrThrow(app, normalizedPath);
			const filter = resolveRegex(regex);

			const items = folder.children
				.filter((item) => !filter || filter.test(item.name))
				.map((item) => {
					if (item instanceof TFile) {
						return {
							name: item.name,
							path: item.path,
							type: 'file' as const,
							size: item.stat?.size ?? 0,
							mtime: item.stat?.mtime ?? 0,
							ctime: item.stat?.ctime ?? 0,
						};
					}

					return {
						name: item.name,
						path: item.path,
						type: 'folder' as const,
						size: 0,
						mtime: 0,
						ctime: 0,
					};
				});

			return {
				path: normalizedPath || '',
				items,
				count: items.length,
			};
		}
	);

	registerTextTool(
		server,
		registry,
		'search_files',
		'按 glob 模式搜索文件路径。',
		searchFilesSchema,
		async ({ pattern, maxResults = DEFAULT_SEARCH_FILES_MAX_RESULTS }) => {
			const limit = Math.max(1, Math.floor(maxResults));
			const results: Array<{
				path: string;
				name: string;
				extension: string;
				size: number;
				mtime: number;
				ctime: number;
			}> = [];

			for (const file of app.vault.getFiles()) {
				if (!micromatch.isMatch(file.path, pattern, { dot: true })) {
					continue;
				}
				const stat = toStatInfo(file);
				results.push({
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: stat.size,
					mtime: stat.mtime,
					ctime: stat.ctime,
				});
				if (results.length >= limit) {
					break;
				}
			}

			return {
				pattern,
				maxResults: limit,
				results,
				count: results.length,
			};
		}
	);

	registerTextTool(
		server,
		registry,
		'search_content',
		'在 Vault 文件内容中按正则搜索，支持目录/扩展名过滤和上下文行。',
		searchContentSchema,
		async ({
			pattern,
			path,
			fileType,
			maxResults = DEFAULT_SEARCH_CONTENT_MAX_RESULTS,
			caseSensitive = false,
			contextLines,
		}) => {
			const scopePath = normalizeVaultPath(path ?? '');
			if (scopePath) {
				assertVaultPath(scopePath, 'path');
			}

			const flags = caseSensitive ? '' : 'i';
			let regex: RegExp;
			try {
				regex = new RegExp(pattern, flags);
			} catch (error) {
				throw new Error(
					`非法 pattern 正则: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			const extFilter = parseFileTypeFilter(fileType);
			const limit = Math.max(1, Math.floor(maxResults));
			const files = getTargetFilesForSearchContent(app, scopePath);
			const results: Array<{
				path: string;
				line: number;
				match: string;
				context: {
					before: string[];
					after: string[];
				};
			}> = [];

			const ctx = Number.isFinite(contextLines)
				? Math.max(0, Number(contextLines))
				: 0;

			for (const file of files) {
				if (extFilter.size > 0 && !extFilter.has(file.extension.toLowerCase())) {
					continue;
				}

				const content = await app.vault.cachedRead(file);
				const lines = content.split(/\r?\n/);
				for (let index = 0; index < lines.length; index += 1) {
					const lineText = lines[index];
					regex.lastIndex = 0;
					if (!regex.test(lineText)) {
						continue;
					}

					results.push({
						path: file.path,
						line: index + 1,
						match: lineText,
						context: {
							before:
								ctx > 0
									? lines.slice(Math.max(0, index - ctx), index)
									: [],
							after:
								ctx > 0
									? lines.slice(index + 1, Math.min(lines.length, index + 1 + ctx))
									: [],
						},
					});

					if (results.length >= limit) {
						return {
							pattern,
							path: scopePath || '',
							fileType: fileType ?? '',
							maxResults: limit,
							caseSensitive,
							contextLines: ctx,
							results,
							count: results.length,
							truncated: true,
						};
					}
				}
			}

			return {
				pattern,
				path: scopePath || '',
				fileType: fileType ?? '',
				maxResults: limit,
				caseSensitive,
				contextLines: ctx,
				results,
				count: results.length,
				truncated: false,
			};
		}
	);
}
