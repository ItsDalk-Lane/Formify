import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface OpenFileArgs {
	path: string;
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

			const existing = app.vault.getAbstractFileByPath(filePath);
			if (!existing || !(existing instanceof TFile)) {
				throw new Error(`文件未找到: ${filePath}`);
			}

			const active = app.workspace.getActiveFile();
			if (active?.path === existing.path) {
				const result: OpenFileResult = {
					path: filePath,
					message: 'File already open'
				};
				return result;
			}

			const leaf = app.workspace.getLeaf(true);
			await leaf.openFile(existing);

			const result: OpenFileResult = {
				path: filePath,
				message: 'File opened successfully'
			};
			return result;
		},
		createdAt: now,
		updatedAt: now
	};
};
