import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface DeleteFileArgs {
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
		description: '删除指定路径的文件或文件夹。如果删除文件夹，将递归删除其中的所有内容。',
		enabled: true,
		executionMode: 'manual',
		category: 'file',
		icon: 'Trash2',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: '要删除的文件或文件夹路径，相对于 vault 根目录'
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
			coalesceString(args.path, args.filePath, args.file_path)
		);
		const normalizedPaths = (args.paths ?? [])
			.map((item) => normalizeVaultPath(item))
			.filter((item) => item);
		const paths = normalizedPaths.length > 0 ? normalizedPaths : (filePath ? [filePath] : []);
		if (paths.length === 0) {
			throw new Error('必须提供 path 或 paths 参数');
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
