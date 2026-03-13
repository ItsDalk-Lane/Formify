import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { localInstance } from 'src/i18n/locals';
import type { McpToolAnnotations } from 'src/features/tars/mcp/types';
import { z } from 'zod';
import {
	BUILTIN_FILESYSTEM_CLIENT_NAME,
	BUILTIN_FILESYSTEM_SERVER_ID,
	BUILTIN_FILESYSTEM_SERVER_NAME,
	BUILTIN_FILESYSTEM_SERVER_VERSION,
	DEFAULT_SEARCH_MAX_RESULTS,
	DEFAULT_TEXT_FILE_MAX_CHARS,
} from './constants';
import { registerBuiltinTool } from './runtime/register-tool';
import { serializeMcpToolResult, toCanonicalJsonText } from './runtime/tool-result';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import { registerNavTools } from './tools/nav-tools';
import { executeVaultQuery } from './tools/vault-query';
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
	resolveRegex,
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
	title?: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: McpToolAnnotations;
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

interface ContentSearchContextEntry {
	line: number;
	text: string;
}

interface ContentSearchMatch {
	path: string;
	line: number;
	text: string;
	before: ContentSearchContextEntry[];
	after: ContentSearchContextEntry[];
}

type BuiltinResponseFormat = 'json' | 'text';

const responseFormatSchema = z
	.enum(['json', 'text'])
	.default('json')
	.describe("返回格式：json 为稳定对象，text 为紧凑文本");

const structuredOutputSchema = z.object({}).passthrough();
const readOnlyToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;
const mutationToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
} as const;
const navigationToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const;

const readTextFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件路径'),
	head: z.number().int().positive().optional().describe('仅读取前 N 行'),
	tail: z.number().int().positive().optional().describe('仅读取后 N 行'),
	max_chars: z
		.number()
		.int()
		.positive()
		.max(DEFAULT_TEXT_FILE_MAX_CHARS)
		.default(DEFAULT_TEXT_FILE_MAX_CHARS)
		.describe(`最大返回字符数，默认 ${DEFAULT_TEXT_FILE_MAX_CHARS}`),
	response_format: responseFormatSchema,
});

const readMediaFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的媒体文件路径'),
});

const readMultipleFilesSchema = z.object({
	paths: z
		.array(z.string().min(1))
		.min(1)
		.max(20)
		.describe('要读取的文件路径数组，最多 20 个'),
	max_chars: z
		.number()
		.int()
		.positive()
		.max(DEFAULT_TEXT_FILE_MAX_CHARS)
		.default(DEFAULT_TEXT_FILE_MAX_CHARS)
		.describe(`单个文件的最大返回字符数，默认 ${DEFAULT_TEXT_FILE_MAX_CHARS}`),
	response_format: responseFormatSchema,
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

const listDirectorySchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的目录路径；根目录可传 /'),
	regex: z
		.string()
		.optional()
		.describe('可选的 JavaScript 正则表达式字符串，仅返回名称匹配的文件和文件夹'),
	limit: z.number().int().positive().max(500).default(100),
	offset: z.number().int().min(0).default(0),
	response_format: responseFormatSchema,
});

const listDirectoryWithSizesSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的目录路径；根目录可传 /'),
	sortBy: z.enum(['name', 'size']).optional().default('name'),
	limit: z.number().int().positive().max(500).default(100),
	offset: z.number().int().min(0).default(0),
	response_format: responseFormatSchema,
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
	maxResults: z
		.number()
		.int()
		.positive()
		.optional()
		.default(100)
		.describe('返回结果的最大数量，默认 100'),
	response_format: responseFormatSchema,
});

const directoryTreeSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的起始目录路径；根目录可传 /'),
	excludePatterns: z.array(z.string()).optional().default([]),
	max_depth: z.number().int().positive().max(20).default(5),
	max_nodes: z.number().int().positive().max(2_000).default(200),
	response_format: responseFormatSchema,
});

const getFileInfoSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe('相对于 Vault 根目录的文件或目录路径；根目录可传 /'),
	response_format: responseFormatSchema,
});

const deleteFileSchema = z.object({
	path: z.string().min(1).describe('相对于 Vault 根目录的文件或文件夹路径'),
	force: z
		.boolean()
		.optional()
		.default(true)
		.describe('删除文件夹时是否强制递归删除隐藏内容，默认 true'),
});

const searchContentSchema = z.object({
	pattern: z.string().min(1).describe('用于搜索文件内容的正则表达式'),
	path: z
		.string()
		.optional()
		.default('/')
		.describe('限制搜索范围的目录路径；默认为整个 Vault'),
	fileType: z
		.string()
		.optional()
		.describe('文件扩展名过滤，如 md 或 ts,tsx'),
	maxResults: z
		.number()
		.int()
		.positive()
		.optional()
		.default(DEFAULT_SEARCH_MAX_RESULTS)
		.describe('返回的最大匹配数量，默认 50'),
	caseSensitive: z
		.boolean()
		.optional()
		.default(false)
		.describe('是否区分大小写，默认 false'),
	contextLines: z
		.number()
		.int()
		.min(0)
		.optional()
		.default(0)
		.describe('返回匹配行前后的上下文行数，默认 0'),
	response_format: responseFormatSchema,
});

const queryVaultSchema = z.object({
	expression: z
		.string()
		.min(1)
		.describe('安全 DSL 查询表达式，例如 select(path).from(file).limit(10)'),
	response_format: responseFormatSchema,
});

const listAllowedDirectoriesSchema = z.object({
	response_format: responseFormatSchema,
});

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

const MAX_CONTENT_SEARCH_FILE_SIZE_BYTES = 2 * 1024 * 1024;

const binaryFileExtensions = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'bmp',
	'svg',
	'ico',
	'mp3',
	'wav',
	'ogg',
	'flac',
	'm4a',
	'mp4',
	'mov',
	'avi',
	'pdf',
	'zip',
	'gz',
	'tar',
	'7z',
	'rar',
	'exe',
	'dll',
	'so',
	'bin',
	'woff',
	'woff2',
	'ttf',
	'eot',
]);

const formatLocal = (template: string, ...values: Array<string | number>): string => {
	return values.reduce((text, value, index) => {
		return text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(value));
	}, template);
};

const parseFileTypeFilter = (fileType?: string): string[] | null => {
	const raw = String(fileType ?? '').trim();
	if (!raw) {
		return null;
	}
	const extensions = raw
		.split(',')
		.map((part) => part.trim().replace(/^\./, '').toLowerCase())
		.filter(Boolean);
	if (extensions.length === 0) {
		throw new Error(localInstance.mcp_fs_search_content_invalid_file_type);
	}
	return Array.from(new Set(extensions));
};

const createContentSearchRegex = (
	pattern: string,
	caseSensitive: boolean
): RegExp => {
	try {
		return new RegExp(pattern, caseSensitive ? '' : 'i');
	} catch (error) {
		throw new Error(
			`非法正则表达式: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};

const isPathUnderDirectory = (rootPath: string, targetPath: string): boolean => {
	if (!rootPath) {
		return true;
	}
	return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
};

const createContextEntries = (
	lines: string[],
	startLine: number,
	endLine: number
): ContentSearchContextEntry[] => {
	const entries: ContentSearchContextEntry[] = [];
	for (let index = startLine; index <= endLine; index += 1) {
		if (index < 0 || index >= lines.length) {
			continue;
		}
		entries.push({
			line: index + 1,
			text: lines[index],
		});
	}
	return entries;
};

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

const applyMaxChars = (
	text: string,
	maxChars: number
): { text: string; truncated: boolean } => {
	const normalized = normalizeLineEndings(text);
	if (normalized.length <= maxChars) {
		return {
			text: normalized,
			truncated: false,
		};
	}
	return {
		text: normalized.slice(0, maxChars),
		truncated: true,
	};
};

const asStructuredOrText = <T extends Record<string, unknown>>(
	responseFormat: BuiltinResponseFormat,
	value: T,
	textFactory?: (structured: T) => string
): T | string => {
	if (responseFormat === 'json') {
		return value;
	}
	return textFactory ? textFactory(value) : toCanonicalJsonText(value);
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
	excludePatterns: string[],
	maxDepth: number,
	maxNodes: number,
	state: { nodes: number; truncated: boolean },
	currentDepth = 1
): FilesystemEntry[] => {
	const result: FilesystemEntry[] = [];

	for (const child of folder.children) {
		if (state.nodes >= maxNodes) {
			state.truncated = true;
			break;
		}
		const relativePath = toRelativeChildPath(rootPath, child.path);
		if (isExcludedByPatterns(relativePath, excludePatterns)) {
			continue;
		}
		state.nodes += 1;

		if (child instanceof TFolder) {
			if (currentDepth >= maxDepth) {
				state.truncated = true;
				result.push({
					name: child.name,
					type: 'directory',
				});
				continue;
			}
			result.push({
				name: child.name,
				type: 'directory',
				children: buildDirectoryTree(
					child,
					rootPath,
					excludePatterns,
					maxDepth,
					maxNodes,
					state,
					currentDepth + 1
				),
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

const shouldSkipContentSearchFile = (
	file: TFile,
	allowedExtensions: string[] | null
): string | null => {
	const extension = file.extension?.toLowerCase() ?? '';
	if (allowedExtensions && allowedExtensions.length > 0) {
		if (!allowedExtensions.includes(extension)) {
			return 'filtered';
		}
	}
	if (binaryFileExtensions.has(extension)) {
		return localInstance.mcp_fs_search_content_skipped_binary;
	}
	if ((file.stat?.size ?? 0) > MAX_CONTENT_SEARCH_FILE_SIZE_BYTES) {
		return localInstance.mcp_fs_search_content_skipped_large;
	}
	return null;
};

export async function createFilesystemBuiltinRuntime(
	app: App
): Promise<FilesystemBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_FILESYSTEM_SERVER_NAME,
		version: BUILTIN_FILESYSTEM_SERVER_VERSION,
	});
	const registry = new BuiltinToolRegistry();

	registerBuiltinTool(
		server,
		registry,
		'formify_read_text_file',
		{
			title: '读取文本文件',
			description: '读取单个文本文件，可选仅返回前 N 行或后 N 行，并限制最大字符数。',
			inputSchema: readTextFileSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ path, head, tail, max_chars = DEFAULT_TEXT_FILE_MAX_CHARS, response_format = 'json' }) => {
			const normalizedPath = normalizeFilePath(path);
			const file = getFileOrThrow(app, normalizedPath);
			const content = await app.vault.cachedRead(file);
			const sliced = sliceTextByLines(content, { head, tail });
			const limited = applyMaxChars(sliced, max_chars);
			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath,
					content: limited.text,
					truncated: limited.truncated,
					max_chars,
					head: head ?? null,
					tail: tail ?? null,
				},
				(structured) => structured.content as string
			);
		}
	);

	server.registerTool(
		'formify_read_media_file',
		{
			title: '读取媒体文件',
			description: '读取图片或音频文件，返回 base64 数据和 MIME 类型。',
			inputSchema: readMediaFileSchema,
			annotations: readOnlyToolAnnotations,
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

	registerBuiltinTool(
		server,
		registry,
		'formify_read_multiple_files',
		{
			title: '批量读取文本文件',
			description: '批量读取多个文本文件，单个文件失败不会影响其他文件。',
			inputSchema: readMultipleFilesSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ paths, max_chars = DEFAULT_TEXT_FILE_MAX_CHARS, response_format = 'json' }) => {
			const files = await Promise.all(
				paths.map(async (filePath) => {
					try {
						const normalizedPath = normalizeFilePath(filePath);
						const file = getFileOrThrow(app, normalizedPath);
						const content = await app.vault.cachedRead(file);
						const limited = applyMaxChars(content, max_chars);
						return {
							path: normalizedPath,
							content: limited.text,
							truncated: limited.truncated,
							error: null,
						};
					} catch (error) {
						return {
							path: filePath,
							content: '',
							truncated: false,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				})
			);
			return asStructuredOrText(
				response_format,
				{
					files,
					meta: {
						returned: files.length,
						max_chars,
					},
				},
				(structured) =>
					(structured.files as Array<{
						path: string;
						content: string;
						error: string | null;
					}>)
						.map((file) =>
							file.error
								? `${file.path}: Error - ${file.error}`
								: `${file.path}:\n${file.content}`
						)
						.join('\n---\n')
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_write_file',
		{
			title: '写入文本文件',
			description: '创建或覆盖文本文件内容。',
			inputSchema: writeFileSchema,
			outputSchema: structuredOutputSchema,
			annotations: mutationToolAnnotations,
		},
		async ({ path, content }) => {
			const normalizedPath = normalizeFilePath(path);
			await ensureParentFolderExists(app, normalizedPath);
			const existing = app.vault.getAbstractFileByPath(normalizedPath);
			const existed = !!existing;
			if (!existing) {
				await app.vault.create(normalizedPath, content);
			} else if (existing instanceof TFile) {
				await app.vault.modify(existing, content);
			} else {
				throw new Error(`目标不是文件: ${normalizedPath}`);
			}
			return {
				path: normalizedPath,
				action: existed ? 'updated' : 'created',
				bytesWritten: content.length,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_edit_file',
		{
			title: '编辑文本文件',
			description: '按文本片段精确或宽松匹配编辑文件内容，支持 dryRun 预览 diff。',
			inputSchema: editFileSchema,
			outputSchema: structuredOutputSchema,
			annotations: mutationToolAnnotations,
		},
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
			return {
				path: normalizedPath,
				dryRun,
				appliedEdits: edits.length,
				updated: !dryRun,
				diff,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_create_directory',
		{
			title: '创建目录',
			description: '创建目录，目录已存在时静默成功。',
			inputSchema: directoryPathSchema,
			outputSchema: structuredOutputSchema,
			annotations: mutationToolAnnotations,
		},
		async ({ path }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const existed = !!app.vault.getAbstractFileByPath(normalizedPath);
			await ensureFolderExists(app, normalizedPath);
			return {
				path: normalizedPath || '/',
				created: !existed,
				existed,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_list_directory',
		{
			title: '列出目录内容',
			description: '列出目录内容，支持按名称正则过滤、分页和 JSON/text 两种返回格式。',
			inputSchema: listDirectorySchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ path, regex, limit = 100, offset = 0, response_format = 'json' }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			const pattern = resolveRegex(regex);
			const items = folder.children
				.filter((child) => !pattern || pattern.test(child.name))
				.map((child) => ({
					name: child.name,
					type: child instanceof TFolder ? 'directory' : 'file',
					path: child.path,
				}));
			const pagedItems = items.slice(offset, offset + limit);
			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath || '/',
					items: pagedItems,
					meta: {
						totalBeforeLimit: items.length,
						returned: pagedItems.length,
						offset,
						limit,
						truncated: offset + pagedItems.length < items.length,
					},
				},
				(structured) => {
					const textItems = structured.items as Array<{ name: string; type: string }>;
					const meta = structured.meta as { truncated: boolean };
					return [
						...textItems.map((item) =>
							`${item.type === 'directory' ? '[DIR]' : '[FILE]'} ${item.name}`
						),
						...(meta.truncated
							? ['[结果已截断，请增大 limit 或调整 offset]']
							: []),
					].join('\n');
				}
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_list_directory_with_sizes',
		{
			title: '列出目录内容及大小',
			description: '列出目录内容及大小统计，支持排序、分页和 JSON/text 两种返回格式。',
			inputSchema: listDirectoryWithSizesSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ path, sortBy = 'name', limit = 100, offset = 0, response_format = 'json' }) => {
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
			const pagedEntries = sortedEntries.slice(offset, offset + limit);

			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath || '/',
					items: pagedEntries.map((entry) => ({
						name: entry.name,
						type: entry.isDirectory ? 'directory' : 'file',
						size: entry.size,
						sizeText: entry.isDirectory ? null : formatSize(entry.size),
					})),
					meta: {
						totalBeforeLimit: sortedEntries.length,
						returned: pagedEntries.length,
						offset,
						limit,
						truncated: offset + pagedEntries.length < sortedEntries.length,
					},
					summary: {
						totalFiles,
						totalDirs,
						totalSize,
						totalSizeText: formatSize(totalSize),
					},
				},
				(structured) => {
					const items = structured.items as Array<{
						name: string;
						type: string;
						sizeText: string | null;
					}>;
					const summary = structured.summary as {
						totalFiles: number;
						totalDirs: number;
						totalSizeText: string;
					};
					const meta = structured.meta as { truncated: boolean };
					return [
						...items.map((entry) =>
							`${entry.type === 'directory' ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${
								entry.type === 'directory' ? '' : String(entry.sizeText ?? '').padStart(10)
							}`.trimEnd()
						),
						'',
						`Total: ${summary.totalFiles} files, ${summary.totalDirs} directories`,
						`Combined size: ${summary.totalSizeText}`,
						...(meta.truncated
							? ['[结果已截断，请增大 limit 或调整 offset]']
							: []),
					].join('\n');
				}
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_directory_tree',
		{
			title: '递归列出目录树',
			description: '递归返回目录树结构，支持排除模式、最大深度、最大节点数和 JSON/text 两种返回格式。',
			inputSchema: directoryTreeSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({
			path,
			excludePatterns = [],
			max_depth = 5,
			max_nodes = 200,
			response_format = 'json',
		}) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const folder = getFolderOrThrow(app, normalizedPath);
			const state = { nodes: 0, truncated: false };
			const tree = buildDirectoryTree(
				folder,
				normalizedPath,
				excludePatterns,
				max_depth,
				max_nodes,
				state
			);
			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath || '/',
					tree,
					meta: {
						maxDepth: max_depth,
						maxNodes: max_nodes,
						returnedNodes: state.nodes,
						truncated: state.truncated,
					},
				},
				(structured) => toCanonicalJsonText(structured)
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_move_file',
		{
			title: '移动或重命名路径',
			description: '移动或重命名文件/目录；目标已存在时失败。',
			inputSchema: moveFileSchema,
			outputSchema: structuredOutputSchema,
			annotations: mutationToolAnnotations,
		},
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
			return {
				source: normalizedSource,
				destination: normalizedDestination,
				moved: true,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_search_files',
		{
			title: '搜索路径',
			description: '递归搜索匹配 glob 模式的文件和目录，返回 Vault 相对路径。',
			inputSchema: searchFilesSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ path, pattern, excludePatterns = [], maxResults = 100, response_format = 'json' }) => {
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

			const limitedMatches = matches.slice(0, maxResults);
			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath || '/',
					pattern,
					excludePatterns,
					matches: limitedMatches,
					meta: {
						totalBeforeLimit: matches.length,
						returned: limitedMatches.length,
						maxResults,
						truncated: limitedMatches.length < matches.length,
					},
				},
				(structured) => {
					const textMatches = structured.matches as string[];
					const meta = structured.meta as { truncated: boolean; maxResults: number };
					if (textMatches.length === 0) {
						return 'No matches found';
					}
					return [
						...textMatches,
						...(meta.truncated
							? [formatLocal(localInstance.mcp_fs_search_files_truncated, meta.maxResults)]
							: []),
					].join('\n');
				}
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_delete_file',
		{
			title: '删除路径',
			description: '永久删除指定文件或文件夹，文件夹会递归删除全部内容。该操作不可恢复，请谨慎使用。',
			inputSchema: deleteFileSchema,
			outputSchema: structuredOutputSchema,
			annotations: mutationToolAnnotations,
		},
		async ({ path, force = true }) => {
			const normalizedPath = normalizeVaultPath(path);
			if (!normalizedPath) {
				throw new Error(localInstance.mcp_fs_delete_root_forbidden);
			}
			assertVaultPath(normalizedPath, 'path');
			const target = app.vault.getAbstractFileByPath(normalizedPath);
			if (!target) {
				return {
					path: normalizedPath,
					existed: false,
					deleted: false,
				};
			}
			await app.vault.delete(target, force);
			return {
				path: normalizedPath,
				existed: true,
				deleted: true,
			};
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_search_content',
		{
			title: '搜索文件内容',
			description: '递归搜索文件内容中的正则表达式匹配，支持文件类型过滤、上下文行和 JSON/text 两种返回格式。',
			inputSchema: searchContentSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({
			pattern,
			path = '/',
			fileType,
			maxResults = DEFAULT_SEARCH_MAX_RESULTS,
			caseSensitive = false,
			contextLines = 0,
			response_format = 'json',
		}) => {
			const normalizedPath = normalizeDirectoryPath(path);
			if (normalizedPath) {
				getFolderOrThrow(app, normalizedPath);
			}
			const regex = createContentSearchRegex(pattern, caseSensitive);
			const allowedExtensions = parseFileTypeFilter(fileType);
			const matches: ContentSearchMatch[] = [];
			const skippedFiles: Array<{ path: string; reason: string }> = [];
			let scannedFiles = 0;
			const buildResponse = (truncated: boolean) =>
				asStructuredOrText(
					response_format,
					{
						matches,
						meta: {
							path: normalizedPath || '/',
							fileType: allowedExtensions,
							maxResults,
							caseSensitive,
							contextLines,
							scannedFiles,
							skippedFiles,
							returned: matches.length,
							hasMore: truncated,
							truncated,
						},
					},
					(structured) => {
						const textMatches = structured.matches as ContentSearchMatch[];
						const meta = structured.meta as { truncated: boolean };
						if (textMatches.length === 0) {
							return 'No content matches found';
						}
						return [
							...textMatches.flatMap((match) => {
								const lines = [`${match.path}:${match.line}: ${match.text}`];
								for (const before of match.before) {
									lines.push(`  ${before.line}- ${before.text}`);
								}
								for (const after of match.after) {
									lines.push(`  ${after.line}+ ${after.text}`);
								}
								return lines;
							}),
							...(meta.truncated
								? ['[结果已截断，请缩小搜索范围或降低 maxResults]']
								: []),
						].join('\n');
					}
				);

			for (const file of app.vault.getFiles()) {
				if (!isPathUnderDirectory(normalizedPath, file.path)) {
					continue;
				}
				const skipReason = shouldSkipContentSearchFile(file, allowedExtensions);
				if (skipReason) {
					if (skipReason !== 'filtered') {
						skippedFiles.push({
							path: file.path,
							reason: skipReason,
						});
					}
					continue;
				}

				const content = await app.vault.cachedRead(file);
				scannedFiles += 1;
				const lines = normalizeLineEndings(content).split('\n');
				for (let index = 0; index < lines.length; index += 1) {
					if (!regex.test(lines[index])) {
						continue;
					}
					matches.push({
						path: file.path,
						line: index + 1,
						text: lines[index],
						before: createContextEntries(
							lines,
							index - contextLines,
							index - 1
						),
						after: createContextEntries(
							lines,
							index + 1,
							index + contextLines
						),
					});
					if (matches.length >= maxResults) {
						return buildResponse(true);
					}
				}
			}

			return buildResponse(false);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_query_vault',
		{
			title: '查询 Vault DSL',
			description: '使用安全 DSL 查询 Vault 中的文件、属性、标签和任务数据，并返回结构化 JSON。',
			inputSchema: queryVaultSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ expression, response_format = 'json' }) => {
			const result = await executeVaultQuery(app, expression);
			return asStructuredOrText(
				response_format,
				result,
				(structured) => toCanonicalJsonText(structured)
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_get_file_info',
		{
			title: '读取文件元信息',
			description: '读取文件或目录的元数据信息。',
			inputSchema: getFileInfoSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ path, response_format = 'json' }) => {
			const normalizedPath = normalizeDirectoryPath(path);
			const target = normalizedPath
				? getAbstractFileOrThrow(app, normalizedPath)
				: app.vault.getRoot();
			const adapterStat = normalizedPath
				? await app.vault.adapter.stat(normalizedPath)
				: null;
			const fileStat = target instanceof TFile ? getFileStat(target) : null;
			return asStructuredOrText(
				response_format,
				{
					path: normalizedPath || '/',
					type: target instanceof TFolder ? 'directory' : 'file',
					size: fileStat?.size ?? adapterStat?.size ?? 0,
					created: fileStat?.ctime ?? adapterStat?.ctime ?? null,
					modified: fileStat?.mtime ?? adapterStat?.mtime ?? null,
					accessed: null,
					permissions: 'N/A',
				},
				(structured) =>
					Object.entries(structured)
						.map(([key, value]) => `${key}: ${value}`)
						.join('\n')
			);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'formify_list_allowed_directories',
		{
			title: '列出允许访问的目录',
			description: '返回当前内置 Filesystem 工具允许访问的目录范围。',
			inputSchema: listAllowedDirectoriesSchema,
			outputSchema: structuredOutputSchema,
			annotations: readOnlyToolAnnotations,
		},
		async ({ response_format = 'json' }) => {
			return asStructuredOrText(
				response_format,
				{
					directories: ['/'],
					scope: 'vault-root',
				},
				() => 'Allowed directories:\n/'
			);
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
				structuredContent: result.structuredContent,
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				title: tool.title,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				outputSchema: tool.outputSchema,
				annotations: tool.annotations,
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
