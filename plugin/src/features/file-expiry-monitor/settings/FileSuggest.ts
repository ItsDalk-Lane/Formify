import { AbstractInputSuggest, TFile, App } from 'obsidian';

/** 最大搜索结果数 */
const MAX_RESULTS = 50;

/**
 * 计算路径匹配的相关性分数
 * 分数越高越相关，用于排序搜索结果
 *
 * @param path - 完整路径（小写）
 * @param name - 文件/文件夹名称（小写）
 * @param basename - 不含扩展名的名称（小写）
 * @param query - 搜索关键字（小写）
 * @returns 0 表示不匹配，>0 表示匹配程度
 */
export function computePathRelevance(
	path: string,
	name: string,
	basename: string,
	query: string,
): number {
	// 完整名称精确匹配（含或不含扩展名）
	if (name === query || basename === query) return 100;
	// 名称前缀匹配
	if (basename.startsWith(query) || name.startsWith(query)) return 80;
	// 名称包含匹配
	if (basename.includes(query) || name.includes(query)) return 60;
	// 路径前缀匹配
	if (path.startsWith(query)) return 50;
	// 路径包含匹配
	if (path.includes(query)) return 40;
	return 0;
}

/**
 * 文件路径自动补全
 * 基于 AbstractInputSuggest，搜索 vault 中所有文件
 * 使用相关性评分排序，精确匹配和前缀匹配优先展示
 */
export default class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(public app: App, textInputEl: HTMLInputElement) {
		super(app, textInputEl);
	}

	protected getSuggestions(query: string): TFile[] {
		const lowerQuery = (query || '').toLowerCase().trim();
		if (!lowerQuery) {
			return this.app.vault.getFiles().slice(0, MAX_RESULTS);
		}

		return this.app.vault
			.getFiles()
			.map((file) => ({
				file,
				score: computePathRelevance(
					file.path.toLowerCase(),
					file.name.toLowerCase(),
					file.basename.toLowerCase(),
					lowerQuery,
				),
			}))
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
			.slice(0, MAX_RESULTS)
			.map((r) => r.file);
	}

	renderSuggestion(value: TFile, el: HTMLElement): void {
		el.setText(value.path);
	}
}
