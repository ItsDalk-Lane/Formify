import { App, TFile } from 'obsidian';
import { resolveLinkedContent, extractLinks } from '../utils/InternalLinkResolver';
import { DebugLogger } from '../utils/DebugLogger';

/**
 * 缓存内容接口
 */
interface CachedContent {
	content: string;      // 解析后的内容
	timestamp: number;    // 缓存时间戳
	filePath: string;     // 源文件路径
	mtime: number;        // 文件修改时间
}

/**
 * 解析选项接口
 */
export interface ParseOptions {
	enableParsing?: boolean;           // 是否启用解析(默认true)
	maxDepth?: number;                 // 最大嵌套深度(默认5)
	timeout?: number;                  // 解析超时时间,毫秒(默认5000)
	preserveOriginalOnError?: boolean; // 错误时保留原文(默认true)
	enableCache?: boolean;             // 是否使用缓存(默认true)
}

/**
 * 解析错误类型
 */
type ParseErrorType = 'FILE_NOT_FOUND' | 'PERMISSION_ERROR' | 'TIMEOUT' | 'CIRCULAR_REFERENCE';

/**
 * 解析错误接口
 */
export interface ParseError {
	linkText: string;        // 原始链接文本
	errorType: ParseErrorType;
	errorMessage: string;    // 错误详情
}

/**
 * 解析结果接口
 */
export interface ParseResult {
	parsedText: string;      // 解析后的文本
	linksFound: number;      // 发现的链接数
	linksParsed: number;     // 成功解析的链接数
	errors: ParseError[];    // 解析错误列表
}

/**
 * 内链解析服务
 * 提供批量内链解析、缓存管理、循环引用检测等高级功能
 */
export class InternalLinkParserService {
	private app: App;
	private cache: Map<string, CachedContent>;
	private parseStack: Set<string>;
	private readonly MAX_CONCURRENT_LINKS = 10;

	constructor(app: App) {
		this.app = app;
		this.cache = new Map();
		this.parseStack = new Set();
	}

	/**
	 * 解析文本中的所有内链
	 * 
	 * @param text - 要解析的文本
	 * @param sourcePath - 当前文件路径
	 * @param options - 解析选项
	 * @returns 解析后的文本
	 */
	async parseLinks(
		text: string,
		sourcePath: string,
		options?: ParseOptions,
		currentDepth = 0
	): Promise<string> {
		// 1. 处理选项默认值
		const opts: Required<ParseOptions> = {
			enableParsing: options?.enableParsing ?? true,
			maxDepth: options?.maxDepth ?? 5,
			timeout: options?.timeout ?? 5000,
			preserveOriginalOnError: options?.preserveOriginalOnError ?? true,
			enableCache: options?.enableCache ?? true
		};

		// 2. 检查是否启用解析
		if (!opts.enableParsing) {
			return text;
		}

		// 3. 深度保护
		if (currentDepth >= opts.maxDepth) {
			return text;
		}

		// 4. 提取所有内链
		const links = extractLinks(text);
		
		if (links.length === 0) {
			return text;
		}

		DebugLogger.debug(`[InternalLinkParser] 发现 ${links.length} 个内链`);

		// 5. 去重链接列表
		const uniqueLinks = this.deduplicateLinks(links);

		// 6. 并行解析所有唯一链接
		const resolutionMap = await this.resolveLinksInBatches(
			uniqueLinks,
			sourcePath,
			opts,
			currentDepth
		);

		// 7. 从后向前替换文本(避免偏移量问题)
		let result = text;
		const reversedLinks = [...links].reverse();

		for (const link of reversedLinks) {
			const resolvedContent = resolutionMap.get(link.linkText);
			if (resolvedContent !== undefined) {
				result = result.substring(0, link.startIndex) +
					resolvedContent +
					result.substring(link.endIndex);
			}
		}

		return result;
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.cache.clear();
		DebugLogger.debug('[InternalLinkParser] 缓存已清空');
	}

	/**
	 * 去重链接列表
	 */
	private deduplicateLinks(links: ReturnType<typeof extractLinks>): string[] {
		const uniqueSet = new Set<string>();
		links.forEach(link => uniqueSet.add(link.linkText));
		return Array.from(uniqueSet);
	}

	/**
	 * 分批并行解析链接
	 */
	private async resolveLinksInBatches(
		linkTexts: string[],
		sourcePath: string,
		options: Required<ParseOptions>,
		currentDepth: number
	): Promise<Map<string, string>> {
		const resolutionMap = new Map<string, string>();

		// 分批处理,每批最多MAX_CONCURRENT_LINKS个
		for (let i = 0; i < linkTexts.length; i += this.MAX_CONCURRENT_LINKS) {
			const batch = linkTexts.slice(i, i + this.MAX_CONCURRENT_LINKS);
			
			const batchResults = await Promise.all(
				batch.map(linkText =>
					this.resolveSingleLink(linkText, sourcePath, currentDepth, options)
				)
			);

			batch.forEach((linkText, index) => {
				resolutionMap.set(linkText, batchResults[index]);
			});
		}

		return resolutionMap;
	}

	/**
	 * 解析单个链接
	 * 
	 * @param linkText - 链接文本
	 * @param sourcePath - 源文件路径
	 * @param depth - 当前递归深度
	 * @param options - 解析选项
	 * @returns 解析后的内容或原始链接文本
	 */
	private async resolveSingleLink(
		linkText: string,
		sourcePath: string,
		depth: number,
		options: Required<ParseOptions>
	): Promise<string> {
		const originalText = `[[${linkText}]]`;

		// 1. 检查递归深度
		if (depth >= options.maxDepth) {
			DebugLogger.warn(`[InternalLinkParser] 达到最大深度限制: ${linkText}`);
			return originalText;
		}

		// 2. 检查循环引用
		if (this.isCircularReference(linkText)) {
			DebugLogger.warn(`[InternalLinkParser] 检测到循环引用: ${linkText}`);
			return originalText;
		}

		// 3. 检查缓存
		if (options.enableCache) {
			const cached = this.getCachedContent(linkText, sourcePath);
			if (cached !== null) {
				DebugLogger.debug(`[InternalLinkParser] 缓存命中: ${linkText}`);
				return cached;
			}
		}

		// 4. 标记解析路径
		this.parseStack.add(linkText);

		try {
			// 5. 设置超时保护
			const contentPromise = resolveLinkedContent(this.app, linkText, sourcePath);
			const timeoutPromise = new Promise<string>((_, reject) => {
				setTimeout(() => reject(new Error('解析超时')), options.timeout);
			});

			const content = await Promise.race([contentPromise, timeoutPromise]);
			const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
			const nestedSourcePath = targetFile?.path ?? sourcePath;
			const parsedContent = await this.parseLinks(content, nestedSourcePath, options, depth + 1);

			// 6. 缓存结果
			if (options.enableCache) {
				this.setCachedContent(linkText, sourcePath, parsedContent);
			}

			DebugLogger.debug(`[InternalLinkParser] 成功解析: ${linkText} (${parsedContent.length} 字符)`);
			return parsedContent;

		} catch (error) {
			if (options.preserveOriginalOnError) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				DebugLogger.warn(`[InternalLinkParser] 解析失败,保留原文: ${linkText} - ${errorMsg}`);
				return originalText;
			} else {
				throw error;
			}
		} finally {
			// 7. 清除路径标记
			this.parseStack.delete(linkText);
		}
	}

	/**
	 * 检查是否为循环引用
	 */
	private isCircularReference(linkText: string): boolean {
		return this.parseStack.has(linkText);
	}

	/**
	 * 获取缓存内容
	 */
	private getCachedContent(linkText: string, sourcePath: string): string | null {
		const cacheKey = this.getCacheKey(linkText, sourcePath);
		const cached = this.cache.get(cacheKey);

		if (!cached) {
			return null;
		}

		// 验证文件是否被修改
		const file = this.app.vault.getAbstractFileByPath(cached.filePath);
		if (file instanceof TFile) {
			if (file.stat.mtime === cached.mtime) {
				return cached.content;
			} else {
				// 文件已修改,清除缓存
				this.cache.delete(cacheKey);
			}
		}

		return null;
	}

	/**
	 * 设置缓存内容
	 */
	private setCachedContent(linkText: string, sourcePath: string, content: string): void {
		const cacheKey = this.getCacheKey(linkText, sourcePath);
		
		// 尝试获取文件修改时间
		const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		if (file) {
			this.cache.set(cacheKey, {
				content,
				timestamp: Date.now(),
				filePath: file.path,
				mtime: file.stat.mtime
			});
		}
	}

	/**
	 * 生成缓存键
	 */
	private getCacheKey(linkText: string, sourcePath: string): string {
		return `${sourcePath}:${linkText}`;
	}
}
