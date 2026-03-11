import { App, TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian';

const invalidPathChars = /[<>:"|?*]/;

export const normalizeVaultPath = (input: string): string => {
	const text = String(input ?? '').trim().replace(/^[/\\]+/, '');
	if (!text) return '';
	return normalizePath(text).replace(/^\/+/, '');
};

export const assertVaultPath = (path: string, fieldName = 'path'): void => {
	if (!path) {
		throw new Error(`${fieldName} 不能为空`);
	}
	if (invalidPathChars.test(path)) {
		throw new Error(`${fieldName} 包含非法字符`);
	}
	const segments = path.split('/').filter(Boolean);
	if (segments.some((segment) => segment === '..')) {
		throw new Error(`${fieldName} 不能包含 ..`);
	}
};

export const assertVaultPathOrRoot = (
	path: string,
	fieldName = 'path'
): void => {
	if (!path) {
		return;
	}
	assertVaultPath(path, fieldName);
};

export const ensureFolderExists = async (
	app: App,
	folderPath: string
): Promise<void> => {
	const normalized = normalizeVaultPath(folderPath);
	if (!normalized) return;

	const parts = normalized.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const file = app.vault.getAbstractFileByPath(current);
		if (!file) {
			await app.vault.createFolder(current);
		} else if (!(file instanceof TFolder)) {
			throw new Error(`路径冲突，存在同名文件: ${current}`);
		}
	}
};

export const ensureParentFolderExists = async (
	app: App,
	filePath: string
): Promise<void> => {
	const normalized = normalizeVaultPath(filePath);
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash < 0) return;
	const parent = normalized.slice(0, lastSlash);
	if (parent) {
		await ensureFolderExists(app, parent);
	}
};

export const getAbstractFileOrThrow = (
	app: App,
	path: string
): TAbstractFile => {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file) {
		throw new Error(`路径不存在: ${path}`);
	}
	return file;
};

export const getFileOrThrow = (app: App, path: string): TFile => {
	const file = getAbstractFileOrThrow(app, path);
	if (!(file instanceof TFile)) {
		throw new Error(`目标不是文件: ${path}`);
	}
	return file;
};

export const getFolderOrThrow = (app: App, path: string): TFolder => {
	const file = path
		? getAbstractFileOrThrow(app, path)
		: app.vault.getRoot();
	if (!(file instanceof TFolder)) {
		throw new Error(`目标不是文件夹: ${path || '/'}`);
	}
	return file;
};

export const resolveRegex = (regex?: string): RegExp | null => {
	const value = String(regex ?? '').trim();
	if (!value) return null;
	try {
		return new RegExp(value);
	} catch (error) {
		throw new Error(
			`非法正则表达式: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};

export const getFileStat = (file: TFile): {
	size: number;
	mtime: number;
	ctime: number;
} => {
	return {
		size: file.stat?.size ?? 0,
		mtime: file.stat?.mtime ?? 0,
		ctime: file.stat?.ctime ?? 0,
	};
};
