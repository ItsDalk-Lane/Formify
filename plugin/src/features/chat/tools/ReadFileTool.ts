import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface ReadFileArgs {
	filePath: string;
	maxLength?: number;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

/**
 * 读取文件工具
 */
export const createReadFileTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'read_file',
		name: 'read_file',
		description: '读取 vault 中指定文件的内容。支持 Markdown 和纯文本文件。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'FileSearch',
		parameters: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: '文件路径，相对于 vault 根目录。例如: notes/我的笔记.md'
				},
				maxLength: {
					type: 'number',
					description: '最大读取字符数。默认为 50000。如果文件内容超过此限制，将被截断。'
				}
			},
			required: ['filePath']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ReadFileArgs;
			const filePath = normalizeVaultPath(args.filePath);
			const maxLength = args.maxLength ?? 50000;

			if (!filePath) {
				throw new Error('filePath 不能为空');
			}

			const file = app.vault.getAbstractFileByPath(filePath);

			if (!file) {
				throw new Error(`文件不存在: ${filePath}`);
			}

			if (!(file instanceof TFile)) {
				throw new Error(`路径不是文件: ${filePath}`);
			}

			try {
				let content = await app.vault.read(file);

				// 如果内容超过最大长度，截断并添加提示
				if (content.length > maxLength) {
					content = content.substring(0, maxLength) + `\n\n... [内容已截断，原文件共 ${content.length} 字符]`;
				}

				return content;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				throw new Error(`读取文件失败: ${errorMsg}`);
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
