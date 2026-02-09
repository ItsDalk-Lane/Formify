import { App, TFile, TFolder } from "obsidian";

export interface ExpandTargetPathsOptions {
	/** 是否仅包含 Markdown 文件 */
	mdOnly?: boolean;
	/** 是否递归展开子文件夹（默认 true） */
	recursive?: boolean;
}

/**
 * 将文件/文件夹路径数组展开为文件路径数组
 * 文件夹路径会递归展开为其中所有文件
 *
 * @param paths 文件和文件夹路径的混合数组
 * @param app Obsidian App 实例
 * @param options 展开选项
 * @returns 去重后的文件路径数组
 */
export function expandTargetPaths(
	paths: string[],
	app: App,
	options?: ExpandTargetPathsOptions,
): string[] {
	const { mdOnly = false, recursive = true } = options ?? {};
	const result: string[] = [];

	for (const path of paths) {
		if (!path || path.trim() === "") {
			continue;
		}

		const abstractFile = app.vault.getAbstractFileByPath(path);

		if (abstractFile instanceof TFile) {
			if (!mdOnly || abstractFile.extension === "md") {
				result.push(abstractFile.path);
			}
		} else if (abstractFile instanceof TFolder) {
			collectFilesFromFolder(abstractFile, result, mdOnly, recursive);
		}
		// 如果路径不存在（可能是模板变量），保留原始路径由调用方处理
	}

	return Array.from(new Set(result));
}

/**
 * 从文件夹中收集所有文件路径
 */
function collectFilesFromFolder(
	folder: TFolder,
	result: string[],
	mdOnly: boolean,
	recursive: boolean,
): void {
	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (!mdOnly || child.extension === "md") {
				result.push(child.path);
			}
		} else if (child instanceof TFolder && recursive) {
			collectFilesFromFolder(child, result, mdOnly, recursive);
		}
	}
}
