import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { z } from 'zod';
import {
	BUILTIN_FILESYSTEM_CLIENT_NAME,
	BUILTIN_FILESYSTEM_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_NAME,
	BUILTIN_FILESYSTEM_SERVER_VERSION,
} from './constants';
import { registerTextTool } from './runtime/register-tool';
import { serializeMcpToolResult } from './runtime/tool-result';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { registerNavTools } from './tools/nav-tools';
import {
	assertVaultPath,
	assertVaultPathOrRoot,
	ensureFolderExists,
	ensureParentFolderExists,
	getAbstractFileOrThrow,
	getFileOrThrow,
	getFileStat,
	getFolderOrThrow,
	normalizeVaultPath,
} from './tools/helpers';

const { createTwoFilesPatch } = require('diff') as {
	createTwoFilesPatch: (
		oldFileName: string,
		newFileName: string,
		oldStr: string,
		newStr: string,
		oldHeader?: string,
		newHeader?: string
	) => string;
};
const { minimatch } = require('minimatch') as {
	minimatch: (
		input: string,
		pattern: string,
		options?: { dot?: boolean }
	) => boolean;
};

export interface BuiltinToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface FilesystemBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<BuiltinToolInfo[]>;
	close: () => Promise<void>;
}

interface FilesystemEntry {
	name: string;
	type: 'file' | 'directory';
	children?: FilesystemEntry[];
}

interface EditOperation {
	oldText: string;
	newText: string;
}

const readTextFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	head: z.number().int().positive().optional().describe('仅读取前 N 行'),
	tail: z.number().int().positive().optional().describe('仅读取后 N 行'),
});

const readMediaFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的媒体文件路径'),
});

const readMultipleFilesSchema = z.object({
	paths: z.array(z.string().min(1)).min(1).describe('要读取的文件路径数组'),
});

const writeFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	content: z.string().describe('写入文件的完整文本内容'),
});

const editFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	edits: z
		.array(
			z.object({
				oldText: z.string().describe('待替换的原文本'),
				newText: z.string().describe('替换后的新文本'),
			})
		)
		.min(1)
		.describe('编辑操作列表'),
	dryRun: z.boolean().default(false).describe('是否仅预览 diff'),
});

const directoryPathSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的目录路径；根目录可传 /'),
});

const listDirectoryWithSizesSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的目录路径；根目录可传 /'),
	sortBy: z.enum(['name', 'size']).optional().default('name'),
});

const moveFileSchema = z.object({
	source: z.string().min(1).describe('源文件或文件夹路径'),
	destination: z.string().min(1).describe('目标文件或文件夹路径'),
});

const searchFilesSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的起始目录路径；根目录可传 /'),
	pattern: z.string().min(1).describe('glob 风格搜索模式'),
	excludePatterns: z.array(z.string()).optional().default([]),
});

const directoryTreeSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的起始目录路径；根目录可传 /'),
	excludePatterns: z.array(z.string()).optional().default([]),
});

const getFileInfoSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的文件或目录路径；根目录可传 /'),
});

const listAllowedDirectoriesSchema = z.object({});

const mimeTypes: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
};

const normalizeDirectoryPath = (input: string, fieldName = 'path'): string => {
	const normalized = normalizeVaultPath(input);
	assertVaultPathOrRoot(normalized, fieldName);
	return normalized;
};

const normalizeFilePath = (input: string, fieldName = 'path'): string => {
	const normalized = normalizeVaultPath(input);
	assertVaultPath(normalized, fieldName);
	return normalized;
};

const toRelativeChildPath = (basePath: string, childPath: string): string => {
	if (!basePath) return childPath;
	return childPath.startsWith(`${basePath}/`)
		? childPath.slice(basePath.length + 1)
		: childPath;
};

const formatSize = (bytes: number): string => {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const unitIndex = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1
	);
	if (unitIndex <= 0) {
		return `${bytes} B`;
	}
	return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
};

const normalizeLineEndings = (text: string): string => text.replace(/\r\n/g, '\n');

const applyEditsToText = (
	originalText: string,
	edits: EditOperation[],
	filePath: string,
	dryRun: boolean
): { diff: string; modifiedText: string } => {
	const normalizedOriginal = normalizeLineEndings(originalText);
	let modifiedText = normalizedOriginal;

	for (const edit of edits) {
		const normalizedOld = normalizeLineEndings(edit.oldText);
		const normalizedNew = normalizeLineEndings(edit.newText);

		if (modifiedText.includes(normalizedOld)) {
			modifiedText = modifiedText.replace(normalizedOld, normalizedNew);
			continue;
		}

		const oldLines = normalizedOld.split('\n');
		const contentLines = modifiedText.split('\n');
		let matched = false;

		for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
			const potentialMatch = contentLines.slice(i, i + oldLines.length);
			const isMatch = oldLines.every((oldLine, index) => {
				return oldLine.trim() === potentialMatch[index]?.trim();
			});

			if (!isMatch) continue;

			const originalIndent = contentLines[i]?.match(/^\s*/)?.[0] ?? '';
			const replacementLines = normalizedNew.split('\n').map((line, index) => {
				if (index === 0) {
					return originalIndent + line.trimStart();
				}
				const oldIndent = oldLines[index]?.match(/^\s*/)?.[0] ?? '';
				const newIndent = line.match(/^\s*/)?.[0] ?? '';
				if (oldIndent && newIndent) {
					const relativeIndent = Math.max(0, newIndent.length - oldIndent.length);
					return `${originalIndent}${' '.repeat(relativeIndent)}${line.trimStart()}`;
				}
				return line;
			});

			contentLines.splice(i, oldLines.length, ...replacementLines);
			modifiedText = contentLines.join('\n');
			matched = true;
			break;
		}

		if (!matched) {
			throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
		}
	}

	const diff = createTwoFilesPatch(
		filePath,
		filePath,
		normalizedOriginal,
		modifiedText,
		'original',
		'modified'
	);
	return {
		diff,
		modifiedText: dryRun ? normalizedOriginal : modifiedText,
	};
};

const sliceTextByLines = (
	text: string,
	options: { head?: number; tail?: number }
): string => {
	const normalized = normalizeLineEndings(text);
	const lines = normalized.split('\n');
	if (options.head && options.tail) {
		throw new Error('Cannot specify both head and tail parameters simultaneously');
	}
	if (options.head) {
		return lines.slice(0, options.head).join('\n');
	}
	if (options.tail) {
		return lines.slice(-options.tail).join('\n');
	}
	return normalized;
};

const toBase64 = (buffer: ArrayBuffer): string =>
	Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer).toString(
		'base64'
	);

const getMimeType = (path: string): string => {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return mimeTypes[extension] ?? 'application/octet-stream';
};

const isExcludedByPatterns = (
	relativePath: string,
	patterns: string[]
): boolean => {
	return patterns.some((pattern) => {
		if (minimatch(relativePath, pattern, { dot: true })) {
			return true;
		}
		return (
			minimatch(relativePath, `**/${pattern}`, { dot: true })
			|| minimatch(relativePath, `**/${pattern}/**`, { dot: true })
		);
	});
};

const collectDescendants = (folder: TFolder): TAbstractFile[] => {
	const collected: TAbstractFile[] = [];
	for (const child of folder.children) {
		collected.push(child);
		if (child instanceof TFolder) {
			collected.push(...collectDescendants(child));
		}
	}
	return collected;
};

const buildDirectoryTree = (
	folder: TFolder,
	rootPath: string,
	excludePatterns: string[]
): FilesystemEntry[] => {
	const result: FilesystemEntry[] = [];

	for (const child of folder.children) {
		const relativePath = toRelativeChildPath(rootPath, child.path);
		if (isExcludedByPatterns(relativePath, excludePatterns)) {
			continue;
		}

		if (child instanceof TFolder) {
			result.push({
				name: child.name,
				type: 'directory',
				children: buildDirectoryTree(child, rootPath, excludePatterns),
			});
			continue;
		}

		result.push({
			name: child.name,
			type: 'file',
		});
	}

	return result;
};

export async function createFilesystemBuiltinRuntime(
	app: App
): Promise<FilesystemBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_FILESYSTEM_SERVER_NAME,
		version: BUILTIN_FILESYSTEM_SERVER_VERSION,
	});
	const registry = new BuiltinToolRegistry();

	registerTextTool(
		server,
		registry,
		'read_text_file',
		'读取单个文本文件完整内容，可选仅返回前 N 行或后 N 行。',
		readTextFileSchema,
		async ({ path, head, tail }) => {
			const normalizedPath = normalizeFilePath(path);
			const file = getFileOrThrow(app, normalizedPath);
			const content = await app.vault.cachedRead(file);
			return sliceTextByLines(content, { head, tail });
		}
	);

	server.registerTool(
		'read_media_file',
		{
			description: '读取图片或音频文件，返回 base64 数据和 MIME 类型。',
			inputSchema: readMediaFileSchema,
		},
		async (args) => {
			try {
				const { path } = readMediaFileSchema.parse(args);
				const normalizedPath = normalizeFilePath(path);
				const file = getFileOrThrow(app, normalizedPath);
				const binary = await app.vault.readBinary(file);
				const mimeType = getMimeType(normalizedPath);
				return {
					content: [
						{
							type: mimeType.startsWith('image/')
								? 'image'
								: mimeType.startsWith('audio/')
									? 'audio'
									: 'blob',
							data: toBase64(binary),
							mimeType,
						},
					],
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: 'text' as const,
							text: error instanceof Error ? error.message : String(error),
						},
					],
				};
			}
		}
	);

	registerTextTool(
		server,
		registry,
		'read_multiple_files',
		'批量读取多个文本文件，单个文件失败不会影响其他文件。',
		readMultipleFilesSchema,
		async ({ paths }) => {
			const results = await Promise.all(
				paths.map(async (filePath) => {
					try {
						const normalizedPath = normalizeFilePath(filePath);
						const file = getFileOrThrow(app, normalizedPath);
						const content = await app.vault.cachedRead(file);
						return `${normalizedPath}:\n${content}`;
					} catch (error) {
						return `${filePath}: Error - ${error instanceof Error ? error.message : String(error)}`;
					}
				})
			);
			return results.join('\n---\n');
		}
	);

	registerTextTool(
		server,
		registry,
		'write_file',
		'创建或覆盖文本文件内容。',
		writeFileSchema,
		async ({ path, content }) => {
			const normalizedPath = normalizeFilePath(path);
			await ensureParentFolderExists(app, normalizedPath);
			const existing = app.vault.getAbstractFileByPath(normalizedPath);
			if (!existing) {
				await app.vault.create(normalizedPath, content);
			} else if (existing instanceof TFile) {
				await app.vault.modify(existing, content);
			} else {
				throw new Error(`目标不是文件: ${normalizedPath}`);
			}
			return `Successfully wrote to ${normalizedPath}`;
		}
	);

	registerTextTool(
		server,
		registry,
		'edit_file',
		'按文本片段精确或宽松匹配编辑文件内容，支持 dryRun 预览 diff。',
		editFileSchema,
		async ({ path, edits, dryRun = false }) => {
			const normalizedPath = normalizeFilePath(path);
			const file = getFileOrThrow(app, normalizedPath);
			const originalText = await app.vault.cachedRead(file);
			const { diff, modifiedText } = applyEditsToText(
				originalText,
				edits,
				normalizedPath,
				dryRun
			);
			if (!dryRun) {
				await app.vault.modify(file, modifiedText);
			}
			return diff;
		}
	);

	registerTextTool(
		server,
		registry,
		'create_directory',
		'创建目录，目录已存在时静默成功。',
		directoryPathSchema,
		async ({ path }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			await ensureFolderExists(app, normalizedPath);
			return `Successfully created directory ${normalizedPath || '/'}`;
		}
	);

	registerTextTool(
		server,
		registry,
		'list_directory',
		'列出目录内容，使用 [FILE] / [DIR] 前缀。',
		directoryPathSchema,
		async ({ path }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			return folder.children
				.map((child) => `${child instanceof TFolder ? '[DIR]' : '[FILE]'} ${child.name}`)
				.join('\n');
		}
	);

	registerTextTool(
		server,
		registry,
		'list_directory_with_sizes',
		'列出目录内容及大小统计。',
		listDirectoryWithSizesSchema,
		async ({ path, sortBy = 'name' }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			const entries = folder.children.map((child) => ({
				name: child.name,
				isDirectory: child instanceof TFolder,
				size: child instanceof TFile ? getFileStat(child).size : 0,
			}));

			const sortedEntries = [...entries].sort((a, b) => {
				if (sortBy === 'size') {
					return b.size - a.size;
				}
				return a.name.localeCompare(b.name);
			});

			const totalFiles = entries.filter((entry) => !entry.isDirectory).length;
			const totalDirs = entries.filter((entry) => entry.isDirectory).length;
			const totalSize = entries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);

			return [
				...sortedEntries.map((entry) =>
					`${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${
						entry.isDirectory ? '' : formatSize(entry.size).padStart(10)
					}`.trimEnd()
				),
				'',
				`Total: ${totalFiles} files, ${totalDirs} directories`,
				`Combined size: ${formatSize(totalSize)}`,
			].join('\n');
		}
	);

	registerTextTool(
		server,
		registry,
		'directory_tree',
		'以 JSON 树结构递归返回目录内容。',
		directoryTreeSchema,
		async ({ path, excludePatterns = [] }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			return JSON.stringify(
				buildDirectoryTree(folder, normalizedPath, excludePatterns),
				null,
				2
			);
		}
	);

	registerTextTool(
		server,
		registry,
		'move_file',
		'移动或重命名文件/目录；目标已存在时失败。',
		moveFileSchema,
		async ({ source, destination }) => {
			const normalizedSource = normalizeFilePath(source, 'source');
			const normalizedDestination = normalizeFilePath(destination, 'destination');
			const from = getAbstractFileOrThrow(app, normalizedSource);
			if (app.vault.getAbstractFileByPath(normalizedDestination)) {
				throw new Error(`目标路径已存在: ${normalizedDestination}`);
			}
			const destinationParent = normalizedDestination.includes('/')
				? normalizedDestination.slice(0, normalizedDestination.lastIndexOf('/'))
				: '';
			await ensureFolderExists(app, destinationParent);
			await app.vault.rename(from, normalizedDestination);
			return `Successfully moved ${normalizedSource} to ${normalizedDestination}`;
		}
	);

	registerTextTool(
		server,
		registry,
		'search_files',
		'递归搜索匹配 glob 模式的文件和目录，返回 Vault 相对路径。',
		searchFilesSchema,
		async ({ path, pattern, excludePatterns = [] }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			const matches = collectDescendants(folder)
				.filter((child) => {
					const relativePath = toRelativeChildPath(normalizedPath, child.path);
					if (isExcludedByPatterns(relativePath, excludePatterns)) {
						return false;
					}
					if (minimatch(relativePath, pattern, { dot: true })) {
						return true;
					}
					return minimatch(child.name, pattern, { dot: true });
				})
				.map((child) => child.path);

			return matches.length > 0 ? matches.join('\n') : 'No matches found';
		}
	);

	registerTextTool(
		server,
		registry,
		'get_file_info',
		'读取文件或目录的元数据信息。',
		getFileInfoSchema,
		async ({ path }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const target = normalizedPath
				? getAbstractFileOrThrow(app, normalizedPath)
				: app.vault.getRoot();
			const adapterStat = normalizedPath
				? await app.vault.adapter.stat(normalizedPath)
				: null;
			const fileStat = target instanceof TFile ? getFileStat(target) : null;
			return Object.entries({
				path: normalizedPath || '/',
				type: target instanceof TFolder ? 'directory' : 'file',
				size: fileStat?.size ?? adapterStat?.size ?? 0,
				created: fileStat?.ctime ?? adapterStat?.ctime ?? null,
				modified: fileStat?.mtime ?? adapterStat?.mtime ?? null,
				accessed: null,
				permissions: 'N/A',
			})
				.map(([key, value]) => `${key}: ${value}`)
				.join('\n');
		}
	);

	registerTextTool(
		server,
		registry,
		'list_allowed_directories',
		'返回当前内置 Filesystem 工具允许访问的目录范围。',
		listAllowedDirectoriesSchema,
		async () => {
			return 'Allowed directories:\n/';
		}
	);

	registerNavTools(server, app, registry);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_FILESYSTEM_CLIENT_NAME,
		version: BUILTIN_FILESYSTEM_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const close = async (): Promise<void> => {
		registry.clear();
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_FILESYSTEM_SERVER_ID,
		serverName: BUILTIN_FILESYSTEM_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return serializeMcpToolResult({
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				serverId: BUILTIN_FILESYSTEM_SERVER_ID,
			}));
		},
		close,
	};
}

export async function createFilesystemBuiltinClient(app: App): Promise<Client> {
	const runtime = await createFilesystemBuiltinRuntime(app);
	return runtime.client;
}
