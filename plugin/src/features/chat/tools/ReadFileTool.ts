import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../types/tools';

interface ReadFileArgs {
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
		description: '读取指定路径的文本文件内容并返回。',
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
				}
			},
			required: ['path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ReadFileArgs;
			const filePath = normalizeVaultPath(
				coalesceString(args.path, args.filePath, args.file_path)
			);

			if (!filePath) {
				throw new Error('path 不能为空。示例: "notes/my-note.md"');
			}

			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(filePath)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			// 1) 优先使用 Obsidian API
			try {
				const existing = app.vault.getAbstractFileByPath(filePath);
				if (!existing || !(existing instanceof TFile)) {
					throw new Error(`文件不存在: ${filePath}`);
				}
				if (isBinaryExtension(existing.extension)) {
					throw new Error('该文件为二进制文件，read_file 仅支持文本文件');
				}
				const content = await app.vault.read(existing);
				const stat = await app.vault.adapter.stat(filePath);
				const size = stat?.size ?? content.length;
				if (size > MAX_READ_SIZE || content.length > MAX_READ_SIZE) {
					return `${content.slice(0, MAX_READ_SIZE)}\n\n[内容过大已截断]`;
				}
				return content;
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
