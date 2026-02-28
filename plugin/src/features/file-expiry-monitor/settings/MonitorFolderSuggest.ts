import { AbstractInputSuggest, TFolder, App } from 'obsidian';
import { computePathRelevance } from './FileSuggest';

/** 最大搜索结果数 */
const MAX_RESULTS = 50;

/**
 * 文件夹路径自动补全（监控功能专用）
 * 使用相关性评分排序，精确匹配和前缀匹配优先展示
 */
export default class MonitorFolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(public app: App, textInputEl: HTMLInputElement) {
		super(app, textInputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const lowerQuery = (query || '').toLowerCase().trim();
		const folders = this.app.vault.getAllFolders();

		if (!lowerQuery) {
			return folders.slice(0, MAX_RESULTS);
		}

		return folders
			.map((folder) => {
				const name = folder.name.toLowerCase();
				const path = folder.path.toLowerCase();
				return {
					folder,
					score: computePathRelevance(path, name, name, lowerQuery),
				};
			})
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score || a.folder.path.localeCompare(b.folder.path))
			.slice(0, MAX_RESULTS)
			.map((r) => r.folder);
	}

	renderSuggestion(value: TFolder, el: HTMLElement): void {
		el.setText(value.path);
	}
}
