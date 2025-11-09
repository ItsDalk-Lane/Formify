import { TFile, TFolder, TAbstractFile } from "obsidian";
import { Strings } from "./Strings";

export interface PathMatchResult {
	path: string;
	type: 'file' | 'folder';
	name: string;
	extension?: string;
	score: number;
}

export class PathMatcher {
	/**
	 * 智能路径匹配算法，支持多种匹配模式
	 * @param query 查询字符串
	 * @param allPath 所有可选路径
	 * @returns 匹配结果列表，按相关性排序
	 */
	static matchPaths(query: string, allPaths: TAbstractFile[]): PathMatchResult[] {
		if (!query || query.trim() === '') {
			// 如果查询为空，返回所有路径，按字母顺序排序
			return allPaths
				.map(file => this.createMatchResult(file, 0))
				.sort((a, b) => a.path.localeCompare(b.path));
		}

		const normalizedQuery = Strings.safeToLowerCaseString(query.trim());
		const results: PathMatchResult[] = [];

		for (const file of allPaths) {
			const score = this.calculateMatchScore(normalizedQuery, file);
			if (score > 0) {
				results.push(this.createMatchResult(file, score));
			}
		}

		// 按分数降序排序，分数相同则按字母顺序排序
		return results.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			return a.path.localeCompare(b.path);
		});
	}

	/**
	 * 计算匹配分数
	 * 分数越高表示匹配度越高
	 */
	private static calculateMatchScore(query: string, file: TAbstractFile): number {
		const normalizedPath = Strings.safeToLowerCaseString(file.path);
		const normalizedName = Strings.safeToLowerCaseString(file.name);

		let score = 0;

		// 1. 完全匹配（最高分）
		if (normalizedPath === query) {
			return 100;
		}

		// 2. 文件名完全匹配
		if (normalizedName === query) {
			score += 80;
		}

		// 3. 路径开头匹配
		if (normalizedPath.startsWith(query)) {
			score += 60;
		}

		// 4. 文件名开头匹配
		if (normalizedName.startsWith(query)) {
			score += 50;
		}

		// 5. 包含匹配
		if (normalizedPath.includes(query)) {
			score += 30;

			// 额外加分：匹配位置越靠前，分数越高
			const matchIndex = normalizedPath.indexOf(query);
			if (matchIndex === 0) {
				score += 20; // 开头匹配额外加分
			} else {
				score += Math.max(0, 10 - Math.floor(matchIndex / 10)); // 位置越靠前分数越高
			}
		}

		// 6. 文件名包含匹配
		if (normalizedName.includes(query)) {
			score += 25;
		}

		// 7. 分词匹配（将查询字符串按分隔符拆分后分别匹配）
		const queryParts = query.split(/[\s\-_\/\\\.]/).filter(part => part.length > 0);
		if (queryParts.length > 1) {
			let matchedParts = 0;
			for (const part of queryParts) {
				if (normalizedPath.includes(part)) {
					matchedParts++;
				}
			}
			if (matchedParts === queryParts.length) {
				score += 40; // 所有分词都匹配
			} else if (matchedParts > 0) {
				score += matchedParts * 10; // 部分分词匹配
			}
		}

		// 8. 模糊匹配（字符顺序匹配）
		const fuzzyScore = this.calculateFuzzyMatchScore(query, normalizedPath);
		score += fuzzyScore;

		// 9. 文件类型优先级调整
		if (file instanceof TFolder) {
			score += 5; // 文件夹稍微优先
		}

		return score;
	}

	/**
	 * 模糊匹配分数计算
	 * 检查查询字符是否按顺序出现在路径中
	 */
	private static calculateFuzzyMatchScore(query: string, path: string): number {
		if (query.length === 0) return 0;

		let pathIndex = 0;
		let matchedChars = 0;

		for (let i = 0; i < query.length; i++) {
			const char = query[i];
			const foundIndex = path.indexOf(char, pathIndex);

			if (foundIndex === -1) {
				break; // 字符未找到
			}

			matchedChars++;
			pathIndex = foundIndex + 1;
		}

		if (matchedChars === query.length) {
			// 所有字符都按顺序找到
			return Math.min(20, matchedChars * 2);
		}

		return 0;
	}

	/**
	 * 创建匹配结果对象
	 */
	private static createMatchResult(file: TAbstractFile, score: number): PathMatchResult {
		if (file instanceof TFolder) {
			return {
				path: file.path,
				type: 'folder',
				name: file.name,
				score
			};
		} else if (file instanceof TFile) {
			return {
				path: file.path,
				type: 'file',
				name: file.basename,
				extension: file.extension,
				score
			};
		} else {
			// 其他类型的文件
			return {
				path: file.path,
				type: 'file',
				name: file.name,
				score
			};
		}
	}

	/**
	 * 获取所有文件和文件夹
	 */
	static getAllFilesAndFolders(vault: any): TAbstractFile[] {
		const allFiles: TAbstractFile[] = [];

		// 添加所有文件
		const files = vault.getFiles();
		allFiles.push(...files);

		// 添加所有文件夹
		const folders = vault.getAllFolders();
		allFiles.push(...folders);

		return allFiles;
	}

	/**
	 * 过滤特定类型的文件（如果需要）
	 */
	static filterByExtensions(files: TAbstractFile[], extensions: string[]): TAbstractFile[] {
		return files.filter(file => {
			if (file instanceof TFile) {
				return extensions.includes(file.extension || '');
			}
			return true; // 保留文件夹
		});
	}
}