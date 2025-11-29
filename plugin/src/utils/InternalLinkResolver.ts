import { App, parseLinktext, resolveSubpath, TFile } from 'obsidian';
import { DebugLogger } from './DebugLogger';

/**
 * 内链解析工具类
 * 提供核心的Obsidian内链解析功能,从TARS模块提取并简化
 * 
 * 功能:
 * - 解析 [[文件名]] 格式的内链
 * - 支持带路径的链接 [[文件夹/文件名]]
 * - 支持带标题的链接 [[文件名#标题]]
 * - 支持带别名的链接 [[文件名|显示文本]]
 */

/**
 * 解析单个内链并返回文件内容
 * 
 * @param app - Obsidian应用实例
 * @param linkText - 内链文本(不含[[ ]])
 * @param sourcePath - 当前文件路径,用于相对路径解析
 * @returns 解析后的文件内容
 * @throws 文件不存在、元数据缺失或子路径无效时抛出错误
 */
export async function resolveLinkedContent(
	app: App,
	linkText: string,
	sourcePath: string
): Promise<string> {
	// 1. 解析链接文本,提取路径和子路径
	const { path, subpath } = parseLinktext(linkText);
	DebugLogger.debug(`[InternalLinkResolver] 解析链接: path="${path}", subpath="${subpath}"`);

	// 2. 定位目标文件
	const targetFile = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
	
	if (targetFile === null) {
		throw new Error(`文件不存在: ${linkText.substring(0, 50)}`);
	}

	// 3. 获取文件元数据
	const fileMeta = app.metadataCache.getFileCache(targetFile);
	if (fileMeta === null) {
		throw new Error(`元数据缺失: ${path} ${subpath || ''}`);
	}

	// 4. 读取文件内容
	const targetFileText = await app.vault.cachedRead(targetFile);

	// 5. 如果存在子路径(如#标题),则提取指定部分
	if (subpath) {
		const subPathData = resolveSubpath(fileMeta, subpath);
		if (subPathData === null) {
			DebugLogger.warn(`[InternalLinkResolver] 子路径无效,返回完整内容: ${subpath}`);
			return targetFileText;
		}
		return targetFileText.substring(
			subPathData.start.offset,
			subPathData.end ? subPathData.end.offset : undefined
		);
	}

	return targetFileText;
}

/**
 * 从文本中提取所有内链
 * 
 * @param text - 要扫描的文本
 * @returns 链接匹配结果数组
 */
export function extractLinks(text: string): Array<{
	linkText: string;      // 链接文本(不含[[ ]])
	startIndex: number;    // 起始位置
	endIndex: number;      // 结束位置
	originalText: string;  // 原始文本(含[[ ]])
}> {
	const regex = /\[\[([^\]]+)\]\]/g;
	const matches: Array<{
		linkText: string;
		startIndex: number;
		endIndex: number;
		originalText: string;
	}> = [];

	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		matches.push({
			linkText: match[1],
			startIndex: match.index,
			endIndex: match.index + match[0].length,
			originalText: match[0]
		});
	}

	return matches;
}

/**
 * 验证文件是否存在
 * 
 * @param app - Obsidian应用实例
 * @param path - 文件路径
 * @param sourcePath - 源文件路径
 * @returns TFile对象或null
 */
export function resolveFilePath(
	app: App,
	path: string,
	sourcePath: string
): TFile | null {
	return app.metadataCache.getFirstLinkpathDest(path, sourcePath);
}
