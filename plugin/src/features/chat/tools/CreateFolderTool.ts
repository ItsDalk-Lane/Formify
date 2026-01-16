import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface CreateFolderArgs {
	folderPath: string;
}

const normalizeVaultPath = (input: string): string => {
	const trimmed = String(input ?? '').trim();
	return trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/');
};

/**
 * 递归创建文件夹
 */
const ensureFolderExists = async (app: App, folderPath: string) => {
	const normalized = normalizeVaultPath(folderPath);
	if (!normalized || normalized === '.') return;

	const parts = normalized.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.createFolder(current);
		}
	}
};

/**
 * 创建文件夹工具
 */
export const createCreateFolderTool = (app: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'create_folder',
		name: 'create_folder',
		description: '在 vault 中创建文件夹。如果父文件夹不存在，会自动创建所有必需的父文件夹。',
		enabled: true,
		executionMode: 'auto',
		category: 'file',
		icon: 'Folder',
		parameters: {
			type: 'object',
			properties: {
				folderPath: {
					type: 'string',
					description: '文件夹路径，相对于 vault 根目录。例如: notes/daily 或 projects/2024/january'
				}
			},
			required: ['folderPath']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as CreateFolderArgs;
			const folderPath = normalizeVaultPath(args.folderPath);

			if (!folderPath) {
				throw new Error('folderPath 不能为空');
			}

			// 检查文件夹是否已存在
			const existing = app.vault.getAbstractFileByPath(folderPath);
			if (existing) {
				return `文件夹已存在: ${folderPath}`;
			}

			try {
				await ensureFolderExists(app, folderPath);
				return `已创建文件夹: ${folderPath}`;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				throw new Error(`创建文件夹失败: ${errorMsg}`);
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
