import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface OpenFileArgs {
	path: string;
	mode?: 'none' | 'modal' | 'new-tab' | 'current' | 'split' | 'new-window';
}

interface OpenFileResult {
	path: string;
	message: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

export const createOpenFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'open_file',
		name: 'open_file',
		description: '在 Obsidian 编辑器中打开指定文件。',
		enabled: true,
		executionMode: 'auto',
		category: 'ui',
		icon: 'FileSearch',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: '要打开的文件路径，相对于 vault 根目录'
				},
				mode: {
					type: 'string',
					enum: ['none', 'modal', 'new-tab', 'current', 'split', 'new-window'],
					description: '打开模式。默认: new-tab'
				}
			},
			required: ['path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as OpenFileArgs;
			const filePath = normalizeVaultPath(args.path);

			if (!filePath) {
				throw new Error('path 不能为空。示例: "notes/my-note.md"');
			}

			const invalidChars = /[<>:"|?*]/;
			if (invalidChars.test(filePath)) {
				throw new Error('文件路径包含非法字符: < > : " | ? *');
			}

			const service = new FileOperationService(app);
			const result = await service.openFile({
				path: filePath,
				mode: args.mode || 'new-tab',
				silent: true
			});
			if (!result.success) {
				throw new Error(result.error || '打开文件失败');
			}
			return {
				path: result.path,
				message: 'File opened successfully'
			};
		},
		createdAt: now,
		updatedAt: now
	};
};
