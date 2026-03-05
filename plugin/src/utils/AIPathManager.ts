import { App, TFile, TFolder, normalizePath } from 'obsidian';

export const AI_PROMPTS_SUBFOLDER = 'ai prompts';
export const AI_CHAT_HISTORY_SUBFOLDER = 'chat-history';

const MIGRATION_SUFFIX = '-migrated';

const trimTrailingSlash = (value: string): string => value.replace(/[\\/]+$/g, '');

const getFolderParent = (path: string): string => {
	const normalized = normalizePath(trimTrailingSlash(path));
	const idx = normalized.lastIndexOf('/');
	return idx > 0 ? normalized.substring(0, idx) : '';
};

const ensureFolderPath = async (app: App, folderPath: string): Promise<void> => {
	const normalized = normalizePath(trimTrailingSlash(folderPath));
	if (!normalized) {
		return;
	}

	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) {
		return;
	}
	if (existing) {
		throw new Error(`路径已存在且不是文件夹: ${normalized}`);
	}

	const segments = normalized.split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const currentPath = normalizePath(current);
		const currentEntry = app.vault.getAbstractFileByPath(currentPath);
		if (currentEntry instanceof TFolder) {
			continue;
		}
		if (currentEntry) {
			throw new Error(`路径已存在且不是文件夹: ${currentPath}`);
		}
		try {
			await app.vault.createFolder(currentPath);
		} catch (e) {
			// 在插件启动时，vault 缓存可能尚未完全同步，导致
			// getAbstractFileByPath 返回 null 但 createFolder 抛出
			// "Folder already exists"。此处安全忽略该错误。
			const msg = e instanceof Error ? e.message : String(e);
			if (!msg.includes('Folder already exists')) {
				throw e;
			}
		}
	}
};

const buildUniqueTargetPath = async (app: App, targetPath: string): Promise<string> => {
	if (!(await app.vault.adapter.exists(targetPath))) {
		return targetPath;
	}

	const extensionIndex = targetPath.lastIndexOf('.');
	const hasExtension = extensionIndex > targetPath.lastIndexOf('/');
	const base = hasExtension ? targetPath.substring(0, extensionIndex) : targetPath;
	const ext = hasExtension ? targetPath.substring(extensionIndex) : '';

	let counter = 1;
	while (true) {
		const candidate = `${base}${MIGRATION_SUFFIX}-${counter}${ext}`;
		if (!(await app.vault.adapter.exists(candidate))) {
			return candidate;
		}
		counter += 1;
	}
};

export const getPromptTemplatePath = (aiDataFolder: string): string => {
	return normalizePath(`${trimTrailingSlash(aiDataFolder)}/${AI_PROMPTS_SUBFOLDER}`);
};

export const getChatHistoryPath = (aiDataFolder: string): string => {
	return normalizePath(`${trimTrailingSlash(aiDataFolder)}/${AI_CHAT_HISTORY_SUBFOLDER}`);
};

export const ensureAIDataFolders = async (app: App, aiDataFolder: string): Promise<void> => {
	const root = normalizePath(trimTrailingSlash(aiDataFolder));
	await ensureFolderPath(app, root);
	await ensureFolderPath(app, getPromptTemplatePath(root));
	await ensureFolderPath(app, getChatHistoryPath(root));
};

export const canDeriveAIDataFolderFromLegacy = (
	legacyPromptTemplateFolder?: string,
	legacyChatFolder?: string
): string | null => {
	if (!legacyPromptTemplateFolder || !legacyChatFolder) {
		return null;
	}
	const promptParent = getFolderParent(legacyPromptTemplateFolder);
	const chatParent = getFolderParent(legacyChatFolder);
	if (!promptParent || !chatParent) {
		return null;
	}
	return promptParent === chatParent ? promptParent : null;
};

export const moveFolderFilesWithRenameOnConflict = async (
	app: App,
	sourceFolderPath: string,
	targetFolderPath: string
): Promise<number> => {
	const source = normalizePath(trimTrailingSlash(sourceFolderPath));
	const target = normalizePath(trimTrailingSlash(targetFolderPath));
	if (!source || !target || source === target) {
		return 0;
	}

	const sourceEntry = app.vault.getAbstractFileByPath(source);
	if (!(sourceEntry instanceof TFolder)) {
		return 0;
	}

	await ensureFolderPath(app, target);

	const allFiles = app.vault.getFiles().filter((file) => {
		return file.path === source || file.path.startsWith(`${source}/`);
	});

	let moved = 0;
	for (const file of allFiles) {
		const relativePath = file.path === source ? file.name : file.path.slice(source.length + 1);
		const destinationPath = normalizePath(`${target}/${relativePath}`);
		const destinationParent = getFolderParent(destinationPath);
		if (destinationParent) {
			await ensureFolderPath(app, destinationParent);
		}
		const finalPath = await buildUniqueTargetPath(app, destinationPath);
		if (finalPath === file.path) {
			continue;
		}
		await app.vault.rename(file as TFile, finalPath);
		moved += 1;
	}

	return moved;
};
