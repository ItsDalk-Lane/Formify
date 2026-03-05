/**
 * Obsidian 风格搜索引擎 — 搜索协调器
 *
 * 主入口：接收查询字符串，解析 AST，遍历 vault 文件，
 * 评估匹配，收集结果并排序。
 */

import { App, TFile, TFolder } from 'obsidian';
import { evaluateNode, MatcherOptions } from './matcher';
import { explainQuery, parseSearchQuery } from './parser';
import {
	FileContext,
	FileSearchResult,
	SearchNode,
	SearchOperator,
	SearchOptions,
	SearchResult,
	SortOrder,
} from './types';

// ─── FileContext 构建 ─────────────────────────────────────

function buildFileContext(app: App, file: TFile): FileContext {
	let cachedContent: string | null = null;
	let cachedTags: string[] | null = null;
	let cachedProperties: Record<string, unknown> | null = null;

	return {
		path: file.path,
		name: file.name,
		basename: file.basename,
		extension: file.extension,
		size: file.stat?.size ?? 0,
		mtime: file.stat?.mtime ?? 0,
		ctime: file.stat?.ctime ?? 0,

		getContent: async () => {
			if (cachedContent === null) {
				cachedContent = await app.vault.cachedRead(file);
			}
			return cachedContent;
		},

		getTags: () => {
			if (cachedTags !== null) return cachedTags;

			const cache = app.metadataCache.getFileCache(file);
			const tags: string[] = [];

			// frontmatter tags
			const fm = cache?.frontmatter;
			if (fm) {
				const rawTags = fm.tags ?? fm.tag;
				if (Array.isArray(rawTags)) {
					for (const t of rawTags) {
						const s = String(t).trim();
						if (s) tags.push(s.startsWith('#') ? s : `#${s}`);
					}
				} else if (typeof rawTags === 'string') {
					for (const t of rawTags.split(/[,\s]+/)) {
						const s = t.trim();
						if (s) tags.push(s.startsWith('#') ? s : `#${s}`);
					}
				}
			}

			// inline tags
			if (cache?.tags) {
				for (const tagRef of cache.tags) {
					if (tagRef.tag) {
						tags.push(tagRef.tag);
					}
				}
			}

			cachedTags = tags;
			return cachedTags;
		},

		getProperties: () => {
			if (cachedProperties !== null) return cachedProperties;

			const cache = app.metadataCache.getFileCache(file);
			cachedProperties = { ...(cache?.frontmatter ?? {}) };
			// 移除 Obsidian 内部的 position 字段
			delete cachedProperties.position;
			return cachedProperties;
		},
	};
}

// ─── 文件夹上下文构建 ────────────────────────────────────

function buildFolderContext(folder: TFolder): FileContext {
	return {
		path: folder.path,
		name: folder.name,
		basename: folder.name,
		extension: '',
		size: 0,
		mtime: 0,
		ctime: 0,
		isFolder: true,
		getContent: async () => '',
		getTags: () => [],
		getProperties: () => ({}),
	};
}

// ─── AST 中是否包含 folder: 操作符 ───────────────────────

function containsFolderOp(node: SearchNode): boolean {
	switch (node.type) {
	case 'operator':
		return node.operator === SearchOperator.FOLDER
			|| containsFolderOp(node.child);
	case 'and':
	case 'or':
		return node.children.some(containsFolderOp);
	case 'not':
		return containsFolderOp(node.child);
	default:
		return false;
	}
}

// ─── 排序函数 ─────────────────────────────────────────────

function createSorter(
	sortBy: SortOrder
): (a: FileSearchResult, b: FileSearchResult) => number {
	switch (sortBy) {
	case 'path-asc':
		return (a, b) => a.path.localeCompare(b.path);
	case 'path-desc':
		return (a, b) => b.path.localeCompare(a.path);
	case 'mtime-new':
		return (a, b) => b.mtime - a.mtime;
	case 'mtime-old':
		return (a, b) => a.mtime - b.mtime;
	case 'ctime-new':
		return (a, b) => b.ctime - a.ctime;
	case 'ctime-old':
		return (a, b) => a.ctime - b.ctime;
	}
}

// ─── 主搜索函数 ───────────────────────────────────────────

export async function executeSearch(
	app: App,
	query: string,
	options: SearchOptions
): Promise<SearchResult> {
	const ast = parseSearchQuery(query);

	const matcherOptions: MatcherOptions = {
		caseSensitive: false,
		contextLines: options.contextLines,
	};

	const files = app.vault.getFiles();
	const results: FileSearchResult[] = [];
	let totalMatches = 0;

	for (const file of files) {
		const ctx = buildFileContext(app, file);
		const result = await evaluateNode(ast, ctx, matcherOptions);

		if (result.matched) {
			const fileResult: FileSearchResult = {
				path: file.path,
				name: file.name,
				size: file.stat?.size ?? 0,
				mtime: file.stat?.mtime ?? 0,
				ctime: file.stat?.ctime ?? 0,
				matches: result.details,
			};
			results.push(fileResult);
			totalMatches += result.details.length;
		}
	}

	// 文件夹搜索：当查询包含 folder: 操作符时，也遍历文件夹
	if (containsFolderOp(ast)) {
		const allAbstract = app.vault.getAllLoadedFiles();
		for (const item of allAbstract) {
			if (!(item instanceof TFolder) || item.isRoot()) continue;

			const ctx = buildFolderContext(item);
			const result = await evaluateNode(ast, ctx, matcherOptions);

			if (result.matched) {
				results.push({
					path: item.path + '/',
					name: item.name,
					size: 0,
					mtime: 0,
					ctime: 0,
					matches: result.details,
				});
				totalMatches += result.details.length;
			}
		}
	}

	// 排序
	results.sort(createSorter(options.sortBy));

	// 截断
	const truncated = results.length > options.maxResults;
	const finalResults = truncated
		? results.slice(0, options.maxResults)
		: results;

	return {
		query,
		results: finalResults,
		totalFiles: finalResults.length,
		totalMatches,
		truncated,
		explain: options.explain ? explainQuery(ast) : undefined,
	};
}
