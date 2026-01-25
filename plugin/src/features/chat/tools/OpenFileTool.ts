import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { FileOperationService } from 'src/service/FileOperationService';

interface OpenFileArgs {
	// 新参数名（优先）
	file_name_or_path?: string;
	// 兼容旧参数名
	path?: string;
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
		description: `在 Obsidian 编辑器中打开指定文件，让用户可以查看和编辑。当用户说「打开」「显示」「展示给我看」某个文件时使用此工具。

你可以传入完整路径，也可以只传入文件名。

⛔ 负面约束：
- 如果只是想获取文件内容用于分析或回答问题，不要使用此工具，应使用 read_file。
- 此工具的目的是在 UI 中展示文件给用户，而不是获取内容供 AI 处理。`,
		enabled: true,
		executionMode: 'auto',
		category: 'ui',
		icon: 'FileSearch',
		parameters: {
			type: 'object',
			properties: {
				file_name_or_path: {
					type: 'string',
					description: '文件名或路径。可传入完整路径或仅文件名，系统会自动定位。'
				},
				// 兼容旧参数名
				path: {
					type: 'string',
					description: '（已弃用，请使用 file_name_or_path）要打开的文件路径，相对于 vault 根目录。'
				},
				mode: {
					type: 'string',
					enum: ['none', 'modal', 'new-tab', 'current', 'split', 'new-window'],
					description: '打开模式。默认: new-tab'
				}
			},
			required: ['file_name_or_path']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as OpenFileArgs;
			const filePath = normalizeVaultPath(args.file_name_or_path ?? args.path ?? '');

			if (!filePath) {
				throw new Error('file_name_or_path 不能为空。示例: "notes/my-note.md" 或 "my-note.md"');
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
