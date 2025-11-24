import { App, normalizePath, TFolder } from 'obsidian';

export const sanitizeFileName = (name: string): string => {
	const trimmed = name.trim();
	const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
	return sanitized.length > 0 ? sanitized : 'chat-session';
};

export const ensureFolderExists = async (app: App, folderPath: string): Promise<TFolder> => {
	const normalized = normalizePath(folderPath);
	const abstract = app.vault.getAbstractFileByPath(normalized);
	if (abstract && abstract instanceof TFolder) {
		return abstract;
	}

	if (abstract && !(abstract instanceof TFolder)) {
		throw new Error(`Path ${normalized} 已存在且不是文件夹`);
	}

	await app.vault.createFolder(normalized);
	const created = app.vault.getAbstractFileByPath(normalized);
	if (!created || !(created instanceof TFolder)) {
		throw new Error(`无法创建聊天历史文件夹: ${normalized}`);
	}
	return created;
};

export const joinPath = (folder: string, fileName: string): string => {
	return normalizePath(`${folder.replace(/\\$/g, '').replace(/\/$/g, '')}/${fileName}`);
};

