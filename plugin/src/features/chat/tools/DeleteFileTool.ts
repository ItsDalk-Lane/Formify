import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface DeleteFileArgs {
	// 新参数名（优先）
	file_name_or_path?: string;
	// 兼容旧参数名
	path?: string;
	filePath?: string;
	file_path?: string;
	paths?: string[];
	recursive?: boolean;
}

interface DeleteFileResult {
	path: string;
	existed: boolean;
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

export const createDeleteFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'delete_file',
		name: 'delete_file',
		description: `永久删除指定的文件或文件夹。当用户明确要求「删除」「移除」「清理」某个文件时使用此工具。

你可以传入完整路径，也可以只传入文件名，系统会尝试定位。

⛔ 负面约束（重要）：
- 这是一个危险操作，删除后无法撤销（或进入回收站，取决于系统设置）。
- 除非用户明确表达删除意图，否则不要主动调用此工具。
- 对于「清空文件内容」的需求，应使用 write_file 写入空内容，而不是删除文件。`,
		enabled: true,
		executionMode: 'manual',
		category: 'file',
		icon: 'Trash2',
		parameters: {
			type: 'object',
			properties: {
				file_name_or_path: {
					type: 'string',
					description: '文件名或路径。可传入完整路径或仅文件名，系统会尝试定位。'
				},
				// 兼容旧参数名
				path: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）要删除的文件或文件夹路径，相对于 vault 根目录。'
				},
				filePath: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）文件路径，相对于 vault 根目录。'
				},
				file_path: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）文件路径，相对于 vault 根目录。'
				},
				paths: {
					type: 'array',
					description: '（可选）要删除的多个路径'
				},
				recursive: {
					type: 'boolean',
					description: '是否递归删除文件夹。默认 true。'
				}
			},
			required: []
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as DeleteFileArgs;
		const filePath = normalizeVaultPath(
			coalesceString(args.file_name_or_path, args.path, args.filePath, args.file_path)
		);
		const normalizedPaths = (args.paths ?? [])
			.map((item) => normalizeVaultPath(item))
			.filter((item) => item);
		const paths = normalizedPaths.length > 0 ? normalizedPaths : (filePath ? [filePath] : []);
		if (paths.length === 0) {
			throw new Error('必须提供 file_name_or_path 参数或 paths 参数');
		}

		const service = new FileOperationService(app);
		const result = await service.deleteFile({
			paths,
			folderMode: args.recursive === false ? 'files-only' : 'recursive',
			silent: true
		});

		if (!result.success && result.deletedFiles.length === 0 && result.deletedFolders.length === 0) {
			const reason = result.errors.map((item) => item.error).join('; ');
			throw new Error(`删除失败: ${reason || '未知错误'}`);
		}

		const summaryPath = paths.length === 1 ? paths[0] : `${paths.length} items`;
		const response: DeleteFileResult = {
			path: summaryPath,
			existed: result.deletedFiles.length > 0 || result.deletedFolders.length > 0,
			message: `成功删除 ${result.deletedFiles.length} 个文件和 ${result.deletedFolders.length} 个文件夹`
		};
		return response;
		},
		createdAt: now,
		updatedAt: now
	};
};
