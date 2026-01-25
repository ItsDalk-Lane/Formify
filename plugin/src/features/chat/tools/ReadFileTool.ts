import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';
import { PathResolverService } from '../../../service/PathResolverService';

interface ReadFileArgs {
	// 新参数名（优先）
	file_name_or_path?: string;
	// 兼容旧参数名
	path?: string;
	filePath?: string;
	file_path?: string;
}

const MAX_READ_SIZE = 1024 * 1024;

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

export const createReadFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'read_file',
		name: 'read_file',
		description: `读取指定笔记的文本内容。当用户想要「查看」「阅读」「打开」「检查」或「获取内容」时使用此工具。

你可以传入完整路径（如 "notes/日记/2024-01.md"），也可以只传入文件名（如 "2024-01" 或 "日记"），系统会自动尝试定位文件。

⛔ 负面约束：
- 当你需要查找「哪些文件包含某关键词」时，不要使用此工具，应使用 search_content。
- 当你不确定文件是否存在、想先看看有哪些文件时，不要使用此工具，应使用 list_directory 或 search_files。
- 此工具不能读取二进制文件（图片、PDF 等）。`,
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'FileText',
		parameters: {
			type: 'object',
			properties: {
				file_name_or_path: {
					type: 'string',
					description: '文件名或路径。可传入完整路径（如 "notes/日记/2024-01.md"）或仅文件名（如 "2024-01.md" 或 "日记"），系统会自动尝试定位文件。'
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
				}
			},
			required: ['file_name_or_path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ReadFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(args.file_name_or_path, args.path, args.filePath, args.file_path)
			);

			if (!filePath) {
				throw new Error('file_name_or_path 不能为空。示例: "notes/my-note.md" 或 "my-note.md"');
			}

			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(filePath)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			// 1) 优先使用模糊路由解析路径
			try {
				const resolver = new PathResolverService(app);
				const result = await resolver.resolvePath(filePath, {
					allowFuzzyMatch: true,
					requireFile: true
				});

				if (result.success && result.file) {
					const existing = result.file;
					if (isBinaryExtension(existing.extension)) {
						throw new Error('该文件为二进制文件，read_file 仅支持文本文件');
					}
					const content = await app.vault.read(existing);
					const stat = await app.vault.adapter.stat(existing.path);
					const size = stat?.size ?? content.length;
					if (size > MAX_READ_SIZE || content.length > MAX_READ_SIZE) {
						return `${content.slice(0, MAX_READ_SIZE)}\n\n[内容过大已截断]`;
					}
					return content;
				}
				// PathResolverService 失败，继续到 Node.js 降级逻辑
				throw new Error(result.error || `文件不存在: ${filePath}`);
			} catch (error) {
				// 2) 降级到 Node.js API
				try {
					const adapter: any = app.vault.adapter as any;
					const basePath: string | undefined = adapter?.basePath;
					if (!basePath) {
						throw new Error('无法获取 vault 物理路径（basePath）');
					}
					const absPath = path.join(basePath, filePath);
					if (!fs.existsSync(absPath)) {
						throw new Error('文件未找到');
					}
					const ext = path.extname(absPath).replace('.', '');
					if (isBinaryExtension(ext)) {
						throw new Error('该文件为二进制文件，read_file 仅支持文本文件');
					}
					const content = fs.readFileSync(absPath, { encoding: 'utf-8' });
					const stat = fs.statSync(absPath);
					const size = stat.size;
					if (size > MAX_READ_SIZE || content.length > MAX_READ_SIZE) {
						return `${content.slice(0, MAX_READ_SIZE)}\n\n[内容过大已截断]`;
					}
					return content;
				} catch (fallbackError) {
					const primary = error instanceof Error ? error.message : String(error);
					const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(`读取失败（Obsidian API）: ${primary}\n读取失败（Node 降级）: ${fallback}`);
				}
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
