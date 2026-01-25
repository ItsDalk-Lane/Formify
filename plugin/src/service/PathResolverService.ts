import { App, TFile, TFolder, TAbstractFile, normalizePath } from 'obsidian';
import { PathMatcher, PathMatchResult } from '../utils/PathMatcher';
import { Strings } from '../utils/Strings';

/**
 * 路径解析选项
 */
export interface PathResolutionOptions {
	/** 是否允许模糊匹配，默认 true */
	allowFuzzyMatch?: boolean;
	/** 是否必须是文件（排除文件夹） */
	requireFile?: boolean;
	/** 是否必须是文件夹（排除文件） */
	requireFolder?: boolean;
	/** 最低匹配分数阈值，默认 45 */
	minScore?: number;
	/** 多匹配时的最大结果数，默认 10 */
	maxResults?: number;
}

/**
 * 路径解析结果
 */
export interface PathResolutionResult {
	/** 是否成功解析 */
	success: boolean;
	/** 解析到的文件对象（仅当 type 为 file 时存在） */
	file?: TFile;
	/** 解析到的文件夹对象（仅当 type 为 folder 时存在） */
	folder?: TFolder;
	/** 匹配类型 */
	matchType: 'exact' | 'unique' | 'multiple' | 'none';
	/** 候选结果列表（当 matchType 为 multiple 时存在） */
	candidates?: PathMatchResult[];
	/** 错误信息（失败时存在） */
	error?: string;
}

/**
 * 路径解析服务
 *
 * 提供统一的路径解析功能，支持精确匹配和智能模糊匹配
 */
export class PathResolverService {
	private readonly app: App;
	private readonly defaultMinScore = 45; // 允许文件名开头匹配（50分）通过

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 解析路径
	 * @param inputPath 输入的路径（可以是完整路径或模糊路径）
	 * @param options 解析选项
	 * @returns 解析结果
	 */
	async resolvePath(
		inputPath: string,
		options: PathResolutionOptions = {}
	): Promise<PathResolutionResult> {
		// 1. 输入验证和标准化
		const normalized = this.normalizeAndValidate(inputPath);
		if (!normalized) {
			return {
				success: false,
				matchType: 'none',
				error: '路径不能为空'
			};
		}

		// 2. 尝试精确匹配
		const exactMatch = this.tryExactMatch(normalized, options);
		if (exactMatch) {
			return this.buildExactResult(exactMatch);
		}

		// 3. 检查是否启用模糊匹配
		if (options.allowFuzzyMatch === false) {
			return {
				success: false,
				matchType: 'none',
				error: `文件未找到: ${normalized}`
			};
		}

		// 4. 执行模糊匹配
		const candidates = await this.tryFuzzyMatch(normalized, options);

		// 5. 处理匹配结果
		return this.processFuzzyResults(candidates, normalized, options);
	}

	/**
	 * 标准化和验证输入路径
	 */
	private normalizeAndValidate(input: string): string | null {
		const trimmed = String(input ?? '').trim();
		if (!trimmed) return null;

		const invalidChars = /[<>:"|?*]/;
		if (invalidChars.test(trimmed)) {
			throw new Error('文件路径包含非法字符: < > : " | ? *');
		}

		// 使用 Obsidian 的 normalizePath 处理路径
		return normalizePath(trimmed.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
	}

	/**
	 * 尝试精确匹配
	 */
	private tryExactMatch(
		path: string,
		options: PathResolutionOptions
	): TAbstractFile | null {
		// 1. 首先尝试直接匹配
		let file = this.app.vault.getAbstractFileByPath(path);
		if (file) {
			if (options.requireFile && !(file instanceof TFile)) return null;
			if (options.requireFolder && !(file instanceof TFolder)) return null;
			return file;
		}

		// 2. 如果直接匹配失败，且是文件查找，尝试自动添加常见扩展名
		if (options.requireFile !== false) {
			// 常见扩展名列表（按优先级排序）
			const commonExtensions = [
				'.md',       // Markdown
				'.txt',      // 纯文本
				'.canvas',   // Obsidian 画布
				'.json',     // JSON
				'.yaml', '.yml',  // YAML
				'.xml',      // XML
				'.html', '.htm',  // HTML
			];

			for (const ext of commonExtensions) {
				const pathWithExt = path + ext;
				file = this.app.vault.getAbstractFileByPath(pathWithExt);
				if (file && file instanceof TFile) {
					return file;
				}
			}
		}

		return null;
	}

	/**
	 * 构建精确匹配结果
	 */
	private buildExactResult(file: TAbstractFile): PathResolutionResult {
		if (file instanceof TFile) {
			return {
				success: true,
				file,
				matchType: 'exact'
			};
		}
		return {
			success: true,
			folder: file as TFolder,
			matchType: 'exact'
		};
	}

	/**
	 * 尝试模糊匹配
	 */
	private async tryFuzzyMatch(
		query: string,
		options: PathResolutionOptions
	): Promise<PathMatchResult[]> {
		const allFiles = PathMatcher.getAllFilesAndFolders(this.app);
		const matches = PathMatcher.matchPaths(query, allFiles);

		const minScore = options.minScore ?? this.defaultMinScore;
		const maxResults = options.maxResults ?? 10;

		// 过滤低分结果
		let filtered = matches.filter(m => m.score >= minScore);

		// 应用类型过滤
		if (options.requireFile) {
			filtered = filtered.filter(m => m.type === 'file');
		}
		if (options.requireFolder) {
			filtered = filtered.filter(m => m.type === 'folder');
		}

		// 限制结果数量
		return filtered.slice(0, maxResults);
	}

	/**
	 * 处理模糊匹配结果
	 */
	private processFuzzyResults(
		candidates: PathMatchResult[],
		originalPath: string,
		options: PathResolutionOptions
	): PathResolutionResult {
		if (candidates.length === 0) {
			return {
				success: false,
				matchType: 'none',
				error: `未找到匹配的文件: ${originalPath}`
			};
		}

		if (candidates.length === 1) {
			const match = candidates[0];
			const file = this.app.vault.getAbstractFileByPath(match.path);

			if (match.type === 'file' && file instanceof TFile) {
				return {
					success: true,
					file,
					matchType: 'unique',
					candidates: [match]
				};
			}
			if (match.type === 'folder' && file instanceof TFolder) {
				return {
					success: true,
					folder: file,
					matchType: 'unique',
					candidates: [match]
				};
			}
		}

		// 多个匹配 - 返回候选列表和错误信息
		return {
			success: false,
			matchType: 'multiple',
			candidates,
			error: this.formatMultipleMatchError(candidates, originalPath)
		};
	}

	/**
	 * 格式化多匹配错误信息
	 */
	private formatMultipleMatchError(
		candidates: PathMatchResult[],
		query: string
	): string {
		const count = candidates.length;
		const fileList = candidates
			.slice(0, 5)
			.map(c => `  - ${c.path} (分数: ${c.score})`)
			.join('\n');

		let message = `找到 ${count} 个匹配 "${query}" 的文件，请明确指定路径：\n\n${fileList}`;

		if (count > 5) {
			message += `\n  ... 还有 ${count - 5} 个文件`;
		}

		return message;
	}
}
