import { normalizePath, type App } from 'obsidian';
import type {
	MessageAction,
	MessageAnalysis,
	MessagePathResolution,
	MessageTargetKind,
	MessageTargetReference,
	MessageTargetReferenceType,
	ResolvedMessageTarget,
} from './types';

type AnalyzeInput = {
	userMessage: string;
	activeFilePath?: string;
	selectedText?: string;
	selectedFiles?: string[];
	selectedFolders?: string[];
};

type PathEntry = {
	path: string;
	name: string;
	basename: string;
	kind: Extract<MessageTargetKind, 'file' | 'folder'>;
};

const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;
const EXPLICIT_PATH_PATTERN =
	/(?:^|[\s"'“”‘’：:])((?:\.{0,2}\/)?(?:[A-Za-z0-9_\-.]+\/)+[A-Za-z0-9_\-.]+(?:\.[A-Za-z0-9_-]+)?\/?)/g;
const NATURAL_FOLDER_PATTERN =
	/(?:^|[\s"'“”‘’：:])([^\s"'“”‘’，。！？,.\\/]+)\s*(?:号)?(?:文件夹|目录)/g;
const NATURAL_FILE_PATTERN =
	/(?:^|[\s"'“”‘’：:])([^\s"'“”‘’，。！？,.\\/]+)\s*(?:号)?(?:文件|笔记|文档|note)\b/gi;
const ACTIVE_FILE_PATTERN = /(当前文件|当前笔记|这个文件|这篇笔记|当前文章)/i;
const SELECTED_TEXT_PATTERN = /(选中文本|选中内容|这段文本|这段话|这部分内容)/i;
const PARENT_FOLDER_PATTERN = /(上一级目录|上级目录|父目录)/i;
const TODAY_NOTE_PATTERN = /(今天的日记|今天笔记|今日笔记|today'?s? daily note)/i;
const COMPOUND_CONNECTOR_PATTERN = /(然后|并且|并|再|之后|接着|后|and then|then|after that)/i;
const LEADING_HELPER_PATTERN =
	/^(?:请|请帮我|帮我|帮忙|麻烦|麻烦你|给我|替我|先|请先)+/i;
const LEADING_ACTION_PHRASE_PATTERN =
	/^(?:(?:看一下|看下|看看|分析一下|分析下|分析|总结一下|总结下|总结|读取|查看|查一下|找一下|搜一下|搜索|比较一下|比较|对比一下|对比|整理一下|整理|归纳一下|归纳|过一遍)+)+/i;
const SPECIAL_REFERENCE_PATTERN =
	/^(上一级|上级|父目录|当前文件|当前笔记|这个文件|选中文本|选中内容|今天|今日)$/i;
const TODAY_NOTE_DAILY_PATH_PATTERN =
	/(^|\/)(daily|dialy|dailylife|diary|journal|journals)(\/|$)|日记/i;
const TODAY_NOTE_EXCLUDED_PATH_PATTERN =
	/(^|\/)(system|\.obsidian)(\/|$)|chat-history|quick-actions|\/reports?\//i;

const ACTION_PATTERNS: Array<{ action: MessageAction; pattern: RegExp }> = [
	{ action: 'continue', pattern: /^(继续|下一步|next|continue|接着|go on)\b/i },
	{ action: 'remember', pattern: /(记住|remember|别忘了|记录一下|帮我记|don't forget)/i },
	{ action: 'compare', pattern: /(对比|比较|compare)/i },
	{ action: 'summarize', pattern: /(总结|概括|摘要|归纳|梳理|总结出|summarize|summary)/i },
	{ action: 'analyze', pattern: /(分析|解读|review|inspect|analyze|帮我看看|看一下|看看|过一遍)/i },
	{ action: 'search', pattern: /(搜索|搜一下|找一下|查找|查询|找出|定位|查一下|search|find|look for)/i },
	{ action: 'read', pattern: /(读取|查看|打开|列出|浏览|read|show|list)/i },
	{ action: 'modify', pattern: /(修改|改写|润色|编辑|更新|整理一下|rewrite|transform|polish)/i },
	{ action: 'generate', pattern: /(生成|创建|撰写|写一份|产出|generate|create|write)/i },
];

const stripQuotes = (value: string): string =>
	value.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim();

const dedupeStrings = (values: string[]): string[] =>
	Array.from(new Set(values.filter((value) => value.trim().length > 0)));

const normalizeReferenceToken = (value: string): string =>
	stripQuotes(value)
		.replace(/^\[\[/, '')
		.replace(/\]\]$/, '')
		.replace(/\s+/g, ' ')
		.trim();

const sanitizeNaturalReferenceToken = (
	value: string
): string | null => {
	let normalized = normalizeReferenceToken(value).replace(/号$/, '').trim();
	if (!normalized) {
		return null;
	}
	normalized = normalized.replace(LEADING_HELPER_PATTERN, '').trim();
	normalized = normalized.replace(LEADING_ACTION_PHRASE_PATTERN, '').trim();
	normalized = normalized.replace(LEADING_HELPER_PATTERN, '').trim();
	if (!normalized || SPECIAL_REFERENCE_PATTERN.test(normalized)) {
		return null;
	}
	return normalized;
};

const toLower = (value: string): string => value.toLocaleLowerCase();

const buildLocalDateTokens = (): string[] => {
	const now = new Date();
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return [`${year}-${month}-${day}`, `${year}${month}${day}`, `${year}_${month}_${day}`];
};

const isFolderLike = (value: unknown): value is { path: string; name: string; children: unknown[] } =>
	Boolean(
		value
		&& typeof value === 'object'
		&& typeof (value as { path?: unknown }).path === 'string'
		&& typeof (value as { name?: unknown }).name === 'string'
		&& Array.isArray((value as { children?: unknown[] }).children)
	);

const isFileLike = (value: unknown): value is { path: string; name: string; basename?: string } =>
	Boolean(
		value
		&& typeof value === 'object'
		&& typeof (value as { path?: unknown }).path === 'string'
		&& typeof (value as { name?: unknown }).name === 'string'
		&& !Array.isArray((value as { children?: unknown[] }).children)
	);

const getParentFolderPath = (activeFilePath: string | undefined): string | undefined => {
	if (!activeFilePath) {
		return undefined;
	}
	const normalized = normalizePath(activeFilePath);
	const segments = normalized.split('/');
	segments.pop();
	return segments.join('/');
};

export class MessageSemanticAnalyzer {
	constructor(private readonly app: App) {}

	analyze(input: AnalyzeInput): MessageAnalysis {
		const message = input.userMessage.trim();
		const references: MessageTargetReference[] = [];
		const pathResolutions: MessagePathResolution[] = [];
		const resolvedTargets: ResolvedMessageTarget[] = [];
		const ambiguityReasons: string[] = [];
		let resolvedSpecialTarget: MessageAnalysis['resolvedSpecialTarget'];

		const actions = this.detectActions(message);
		const primaryAction = this.pickPrimaryAction(actions);
		const preparatoryActions = actions.filter((action) => action !== primaryAction);
		const isCompound =
			actions.length > 1
			|| (actions.length > 0 && COMPOUND_CONNECTOR_PATTERN.test(message));

		for (const reference of this.extractWikiLinkReferences(message)) {
			references.push(reference);
			this.pushPathResolution(reference, input.activeFilePath, pathResolutions, resolvedTargets);
		}

		for (const reference of this.extractExplicitPathReferences(message)) {
			references.push(reference);
			this.pushPathResolution(reference, input.activeFilePath, pathResolutions, resolvedTargets);
		}

		for (const reference of this.extractNaturalReferences(message, 'natural_folder')) {
			references.push(reference);
			this.pushPathResolution(reference, input.activeFilePath, pathResolutions, resolvedTargets);
		}

		for (const reference of this.extractNaturalReferences(message, 'natural_file')) {
			references.push(reference);
			this.pushPathResolution(reference, input.activeFilePath, pathResolutions, resolvedTargets);
		}

		if (PARENT_FOLDER_PATTERN.test(message)) {
			const raw = '上一级目录';
			references.push({
				raw,
				type: 'parent_folder',
				normalized: raw,
				preferredKind: 'folder',
			});
			const parentFolderPath = getParentFolderPath(input.activeFilePath);
			if (typeof parentFolderPath === 'string') {
				pathResolutions.push({
					referenceRaw: raw,
					referenceType: 'parent_folder',
					preferredKind: 'folder',
					status: 'unique',
					candidates: [parentFolderPath],
				});
				resolvedTargets.push({ path: parentFolderPath, kind: 'folder' });
			} else {
				pathResolutions.push({
					referenceRaw: raw,
					referenceType: 'parent_folder',
					preferredKind: 'folder',
					status: 'missing',
					candidates: [],
					reason: 'missing_active_file',
				});
			}
		}

		if (ACTIVE_FILE_PATTERN.test(message) && input.activeFilePath) {
			references.push({
				raw: '当前文件',
				type: 'active_file',
				normalized: input.activeFilePath,
				preferredKind: 'active_file',
			});
			resolvedSpecialTarget = 'active_file';
		}

		if (SELECTED_TEXT_PATTERN.test(message) && input.selectedText) {
			references.push({
				raw: '选中文本',
				type: 'selected_text',
				normalized: 'selected_text',
				preferredKind: 'selected_text',
			});
			if (!resolvedSpecialTarget) {
				resolvedSpecialTarget = 'selected_text';
			}
		}

		if (TODAY_NOTE_PATTERN.test(message)) {
			const raw = '今天的日记';
			references.push({
				raw,
				type: 'time_alias',
				normalized: raw,
				preferredKind: 'file',
			});
			const todayResolution = this.resolveTodayNote();
			pathResolutions.push(todayResolution);
			if (todayResolution.status === 'unique') {
				resolvedTargets.push({
					path: todayResolution.candidates[0],
					kind: 'file',
				});
			}
		}

		const dedupedResolvedTargets = this.dedupeResolvedTargets(resolvedTargets);
		const dedupedResolutions = this.dedupeResolutions(pathResolutions);
		const dedupedReferences = this.dedupeReferences(references);

		if (actions.length === 0) {
			ambiguityReasons.push('missing_action');
		}

		for (const resolution of dedupedResolutions) {
			if (resolution.status === 'ambiguous') {
				ambiguityReasons.push('multiple_target_candidates');
			}
			if (resolution.status === 'missing') {
				ambiguityReasons.push(
					resolution.referenceType === 'time_alias'
						? 'time_alias_unresolved'
						: 'target_not_found'
				);
			}
		}

		if (this.hasTypeConflict(dedupedReferences)) {
			ambiguityReasons.push('target_type_conflict');
		}

		const { preferredTarget, targetStatus, hasUniqueResolvedTarget } = this.summarizeTargetState(
			dedupedReferences,
			dedupedResolutions,
			dedupedResolvedTargets,
			resolvedSpecialTarget
		);

		return {
			normalizedActions: actions,
			primaryAction,
			preparatoryActions,
			isCompound,
			references: dedupedReferences,
			pathResolutions: dedupedResolutions,
			resolvedTargets: dedupedResolvedTargets,
			resolvedSpecialTarget,
			preferredTarget,
			targetStatus,
			hasClearAction: actions.length > 0,
			hasUniqueResolvedTarget,
			ambiguityReasons: dedupeStrings(ambiguityReasons),
			summary: this.buildSummary(actions, preferredTarget, targetStatus, dedupedResolvedTargets),
		};
	}

	private detectActions(message: string): MessageAction[] {
		const scored = ACTION_PATTERNS
			.map((entry, index) => ({
				action: entry.action,
				index: message.search(entry.pattern),
				order: index,
			}))
			.filter((entry) => entry.index >= 0)
			.sort((left, right) => left.index - right.index || left.order - right.order);

		return dedupeStrings(scored.map((entry) => entry.action)) as MessageAction[];
	}

	private pickPrimaryAction(actions: MessageAction[]): MessageAction | undefined {
		if (actions.length === 0) {
			return undefined;
		}
		const preferred = [...actions].reverse().find((action) => action !== 'search');
		return preferred ?? actions[0];
	}

	private extractWikiLinkReferences(message: string): MessageTargetReference[] {
		const references: MessageTargetReference[] = [];
		for (const match of message.matchAll(WIKI_LINK_PATTERN)) {
			const raw = match[1];
			if (!raw) {
				continue;
			}
			references.push({
				raw,
				type: 'wiki_link',
				normalized: normalizeReferenceToken(raw).split('|')[0].split('#')[0].trim(),
				preferredKind: 'file',
			});
		}
		return references;
	}

	private extractExplicitPathReferences(message: string): MessageTargetReference[] {
		const references: MessageTargetReference[] = [];
		for (const match of message.matchAll(EXPLICIT_PATH_PATTERN)) {
			const raw = stripQuotes(match[1] ?? '');
			if (!raw || raw.startsWith('[[')) {
				continue;
			}
			references.push({
				raw,
				type: 'explicit_path',
				normalized: normalizeReferenceToken(raw).replace(/\/$/, ''),
				preferredKind: raw.endsWith('/') ? 'folder' : 'file',
			});
		}
		return references;
	}

	private extractNaturalReferences(
		message: string,
		type: Extract<MessageTargetReferenceType, 'natural_folder' | 'natural_file'>
	): MessageTargetReference[] {
		const pattern = type === 'natural_folder' ? NATURAL_FOLDER_PATTERN : NATURAL_FILE_PATTERN;
		const preferredKind = type === 'natural_folder' ? 'folder' : 'file';
		const references: MessageTargetReference[] = [];
		for (const match of message.matchAll(pattern)) {
			const raw = stripQuotes(match[1] ?? '');
			if (!raw) {
				continue;
			}
			const normalized = sanitizeNaturalReferenceToken(raw);
			if (!normalized) {
				continue;
			}
			references.push({
				raw,
				type,
				normalized,
				preferredKind,
			});
		}
		return references;
	}

	private pushPathResolution(
		reference: MessageTargetReference,
		activeFilePath: string | undefined,
		pathResolutions: MessagePathResolution[],
		resolvedTargets: ResolvedMessageTarget[]
	): void {
		if (reference.type === 'wiki_link') {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				reference.normalized,
				activeFilePath ?? ''
			);
			if (resolved?.path) {
				pathResolutions.push({
					referenceRaw: reference.raw,
					referenceType: reference.type,
					preferredKind: 'file',
					status: 'unique',
					candidates: [resolved.path],
				});
				resolvedTargets.push({ path: resolved.path, kind: 'file' });
				return;
			}
			pathResolutions.push({
				referenceRaw: reference.raw,
				referenceType: reference.type,
				preferredKind: 'file',
				status: 'missing',
				candidates: [],
				reason: 'wiki_link_not_found',
			});
			return;
		}

		if (reference.type === 'explicit_path') {
			const resolution = this.resolveExplicitPath(reference, activeFilePath);
			pathResolutions.push(resolution);
			if (resolution.status === 'unique') {
				resolvedTargets.push({
					path: resolution.candidates[0],
					kind: reference.preferredKind === 'folder' ? 'folder' : this.lookupPathKind(resolution.candidates[0]) ?? 'file',
				});
			}
			return;
		}

		if (reference.type === 'natural_folder' || reference.type === 'natural_file') {
			const resolution = this.resolveNaturalReference(reference);
			pathResolutions.push(resolution);
			if (resolution.status === 'unique') {
				resolvedTargets.push({
					path: resolution.candidates[0],
					kind: reference.preferredKind === 'folder' ? 'folder' : 'file',
				});
			}
		}
	}

	private resolveExplicitPath(
		reference: MessageTargetReference,
		activeFilePath: string | undefined
	): MessagePathResolution {
		const candidates = this.buildExplicitPathCandidates(reference.normalized, activeFilePath);
		const matchedCandidates = dedupeStrings(
			candidates.flatMap((candidate) => this.lookupExplicitPathCandidates(candidate))
		);
		if (matchedCandidates.length === 1) {
			const actualKind = this.lookupPathKind(matchedCandidates[0]);
			return {
				referenceRaw: reference.raw,
				referenceType: reference.type,
				preferredKind: actualKind ?? (reference.preferredKind === 'folder' ? 'folder' : 'file'),
				status: 'unique',
				candidates: matchedCandidates,
			};
		}
		if (matchedCandidates.length > 1) {
			const kinds = new Set(
				matchedCandidates
					.map((candidate) => this.lookupPathKind(candidate))
					.filter((kind): kind is Extract<MessageTargetKind, 'file' | 'folder'> => kind !== null)
			);
			return {
				referenceRaw: reference.raw,
				referenceType: reference.type,
				preferredKind:
					kinds.size === 1
						? Array.from(kinds)[0]
						: reference.preferredKind === 'folder'
							? 'folder'
							: 'file',
				status: 'ambiguous',
				candidates: dedupeStrings(matchedCandidates),
				reason: 'multiple_path_candidates',
			};
		}
		return {
			referenceRaw: reference.raw,
			referenceType: reference.type,
			preferredKind: reference.preferredKind === 'folder' ? 'folder' : 'file',
			status: 'missing',
			candidates: [],
			reason: 'path_not_found',
		};
	}

	private resolveNaturalReference(reference: MessageTargetReference): MessagePathResolution {
		const entries = this.getPathEntries(reference.preferredKind === 'folder' ? 'folder' : 'file');
		const normalized = toLower(reference.normalized);

		const exactMatches = entries.filter(
			(entry) =>
				entry.basename === reference.normalized
				|| entry.name === reference.normalized
				|| entry.path === reference.normalized
		);
		if (exactMatches.length === 1) {
			return this.toUniqueResolution(reference, exactMatches[0].path);
		}
		if (exactMatches.length > 1) {
			return this.toAmbiguousResolution(reference, exactMatches.map((entry) => entry.path));
		}

		const lowerMatches = entries.filter(
			(entry) =>
				toLower(entry.basename) === normalized
				|| toLower(entry.name) === normalized
				|| toLower(entry.path) === normalized
		);
		if (lowerMatches.length === 1) {
			return this.toUniqueResolution(reference, lowerMatches[0].path);
		}
		if (lowerMatches.length > 1) {
			return this.toAmbiguousResolution(reference, lowerMatches.map((entry) => entry.path));
		}

		const partialMatches = entries.filter(
			(entry) =>
				toLower(entry.basename).includes(normalized)
				|| toLower(entry.name).includes(normalized)
		);
		if (partialMatches.length === 1) {
			return this.toUniqueResolution(reference, partialMatches[0].path);
		}
		if (partialMatches.length > 1) {
			return this.toAmbiguousResolution(reference, partialMatches.map((entry) => entry.path));
		}

		return {
			referenceRaw: reference.raw,
			referenceType: reference.type,
			preferredKind: reference.preferredKind === 'folder' ? 'folder' : 'file',
			status: 'missing',
			candidates: [],
			reason: 'name_not_found',
		};
	}

	private resolveTodayNote(): MessagePathResolution {
		const tokens = buildLocalDateTokens().map((token) => token.toLocaleLowerCase());
		const rankedCandidates = this.app.vault
			.getFiles()
			.filter((file) => {
				const basename = toLower((file as { basename?: string }).basename ?? file.name);
				const path = toLower(file.path);
				return tokens.some((token) => basename.includes(token) || path.includes(token));
			})
			.map((file) => {
				const basename = toLower((file as { basename?: string }).basename ?? file.name);
				const path = toLower(file.path);
				let score = 0;
				if (TODAY_NOTE_EXCLUDED_PATH_PATTERN.test(path)) {
					score = -1;
				} else {
					if (tokens.includes(basename)) {
						score += 3;
					} else if (tokens.some((token) => basename.includes(token))) {
						score += 1;
					}
					if (tokens.some((token) => path.endsWith(`/${token}.md`) || path === `${token}.md`)) {
						score += 2;
					}
					if (TODAY_NOTE_DAILY_PATH_PATTERN.test(path)) {
						score += 3;
					}
				}
				return {
					path: file.path,
					score,
				};
			})
			.filter((candidate) => candidate.score >= 0)
			.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
		const highConfidenceCandidates = rankedCandidates
			.filter((candidate) => candidate.score >= 7)
			.map((candidate) => candidate.path);
		if (highConfidenceCandidates.length === 1) {
			return {
				referenceRaw: '今天的日记',
				referenceType: 'time_alias',
				preferredKind: 'file',
				status: 'unique',
				candidates: highConfidenceCandidates,
			};
		}
		const fallbackCandidates = rankedCandidates
			.filter((candidate) => candidate.score >= 3)
			.map((candidate) => candidate.path);
		return {
			referenceRaw: '今天的日记',
			referenceType: 'time_alias',
			preferredKind: 'file',
			status: highConfidenceCandidates.length > 1 ? 'ambiguous' : 'missing',
			candidates:
				highConfidenceCandidates.length > 1
					? highConfidenceCandidates
					: fallbackCandidates,
			reason:
				highConfidenceCandidates.length > 1
					? 'multiple_today_note_candidates'
					: fallbackCandidates.length > 0
						? 'today_note_low_confidence'
						: 'today_note_not_found',
		};
	}

	private buildExplicitPathCandidates(rawPath: string, activeFilePath: string | undefined): string[] {
		const cleaned = normalizeReferenceToken(rawPath).replace(/\\/g, '/').replace(/\/$/, '');
		if (!cleaned) {
			return [];
		}
		const candidates = new Set<string>();
		candidates.add(normalizePath(cleaned.replace(/^\//, '')));
		if (activeFilePath && (cleaned.startsWith('./') || cleaned.startsWith('../'))) {
			const segments = normalizePath(activeFilePath).split('/');
			segments.pop();
			for (const segment of cleaned.split('/')) {
				if (segment === '.' || segment.length === 0) {
					continue;
				}
				if (segment === '..') {
					if (segments.length > 0) {
						segments.pop();
					}
					continue;
				}
				segments.push(segment);
			}
			candidates.add(normalizePath(segments.join('/')));
		}
		return Array.from(candidates);
	}

	private lookupPathKind(path: string): Extract<MessageTargetKind, 'file' | 'folder'> | null {
		if (path === '') {
			return 'folder';
		}
		const matched = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!matched) {
			return null;
		}
		if (isFolderLike(matched)) {
			return 'folder';
		}
		if (isFileLike(matched)) {
			return 'file';
		}
		return null;
	}

	private lookupExplicitPathCandidates(candidate: string): string[] {
		const normalizedCandidate = normalizePath(candidate);
		if (this.lookupPathKind(normalizedCandidate) !== null) {
			return [normalizedCandidate];
		}
		const lowerCandidate = toLower(normalizedCandidate);
		return [
			...this.getPathEntries('file'),
			...this.getPathEntries('folder'),
		]
			.filter((entry) => toLower(entry.path) === lowerCandidate)
			.map((entry) => entry.path);
	}

	private getPathEntries(kind: Extract<MessageTargetKind, 'file' | 'folder'>): PathEntry[] {
		if (kind === 'file') {
			return this.app.vault.getFiles().map((file) => ({
				path: file.path,
				name: file.name,
				basename: (file as { basename?: string }).basename ?? file.name.replace(/\.[^.]+$/, ''),
				kind: 'file',
			}));
		}

		return this.app.vault
			.getAllLoadedFiles()
			.filter((item) => isFolderLike(item) && item.path !== '/')
			.map((folder) => ({
				path: folder.path,
				name: folder.name,
				basename: folder.name,
				kind: 'folder',
			}));
	}

	private toUniqueResolution(reference: MessageTargetReference, path: string): MessagePathResolution {
		return {
			referenceRaw: reference.raw,
			referenceType: reference.type,
			preferredKind: reference.preferredKind === 'folder' ? 'folder' : 'file',
			status: 'unique',
			candidates: [path],
		};
	}

	private toAmbiguousResolution(reference: MessageTargetReference, candidates: string[]): MessagePathResolution {
		return {
			referenceRaw: reference.raw,
			referenceType: reference.type,
			preferredKind: reference.preferredKind === 'folder' ? 'folder' : 'file',
			status: 'ambiguous',
			candidates: dedupeStrings(candidates),
			reason: 'multiple_name_matches',
		};
	}

	private dedupeReferences(references: MessageTargetReference[]): MessageTargetReference[] {
		const seen = new Set<string>();
		const result: MessageTargetReference[] = [];
		for (const reference of references) {
			const key = `${reference.type}:${reference.normalized}:${reference.preferredKind}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(reference);
		}
		return result;
	}

	private dedupeResolutions(resolutions: MessagePathResolution[]): MessagePathResolution[] {
		const seen = new Set<string>();
		const result: MessagePathResolution[] = [];
		for (const resolution of resolutions) {
			const key = `${resolution.referenceType}:${resolution.referenceRaw}:${resolution.status}:${resolution.candidates.join('|')}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push({
				...resolution,
				candidates: dedupeStrings(resolution.candidates),
			});
		}
		return result;
	}

	private dedupeResolvedTargets(targets: ResolvedMessageTarget[]): ResolvedMessageTarget[] {
		const seen = new Set<string>();
		const result: ResolvedMessageTarget[] = [];
		for (const target of targets) {
			const key = `${target.kind}:${target.path}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(target);
		}
		return result;
	}

	private summarizeTargetState(
		references: MessageTargetReference[],
		pathResolutions: MessagePathResolution[],
		resolvedTargets: ResolvedMessageTarget[],
		resolvedSpecialTarget: MessageAnalysis['resolvedSpecialTarget']
	): Pick<MessageAnalysis, 'preferredTarget' | 'targetStatus' | 'hasUniqueResolvedTarget'> {
		if (
			resolvedTargets.length > 0
			&& pathResolutions.some((resolution) =>
				resolution.status === 'unique'
				&& (
					resolution.referenceType === 'explicit_path'
					|| resolution.referenceType === 'wiki_link'
					|| resolution.referenceType === 'parent_folder'
					|| resolution.referenceType === 'time_alias'
				)
			)
		) {
			return {
				preferredTarget: resolvedTargets[0].kind,
				targetStatus: 'unique',
				hasUniqueResolvedTarget: true,
			};
		}

		if (pathResolutions.some((resolution) => resolution.status === 'ambiguous')) {
			return {
				preferredTarget: this.pickPreferredTarget(references, resolvedTargets, resolvedSpecialTarget),
				targetStatus: 'ambiguous',
				hasUniqueResolvedTarget: false,
			};
		}

		if (resolvedTargets.length > 0) {
			return {
				preferredTarget: resolvedTargets[0].kind,
				targetStatus: 'unique',
				hasUniqueResolvedTarget: true,
			};
		}

		if (resolvedSpecialTarget) {
			return {
				preferredTarget: resolvedSpecialTarget,
				targetStatus: 'special',
				hasUniqueResolvedTarget: true,
			};
		}

		if (references.length > 0 || pathResolutions.some((resolution) => resolution.status === 'missing')) {
			return {
				preferredTarget: this.pickPreferredTarget(references, resolvedTargets, resolvedSpecialTarget),
				targetStatus: 'missing',
				hasUniqueResolvedTarget: false,
			};
		}

		return {
			preferredTarget: 'none',
			targetStatus: 'none',
			hasUniqueResolvedTarget: false,
		};
	}

	private pickPreferredTarget(
		references: MessageTargetReference[],
		resolvedTargets: ResolvedMessageTarget[],
		resolvedSpecialTarget: MessageAnalysis['resolvedSpecialTarget']
	): MessageTargetKind {
		if (resolvedTargets.length > 0) {
			return resolvedTargets[0].kind;
		}
		if (resolvedSpecialTarget) {
			return resolvedSpecialTarget;
		}
		if (references.length === 0) {
			return 'none';
		}
		return references[0].preferredKind;
	}

	private hasTypeConflict(references: MessageTargetReference[]): boolean {
		const kinds = new Set(
			references
				.map((reference) => reference.preferredKind)
				.filter((kind) => kind === 'file' || kind === 'folder')
		);
		return kinds.size > 1;
	}

	private buildSummary(
		actions: MessageAction[],
		preferredTarget: MessageTargetKind,
		targetStatus: MessageAnalysis['targetStatus'],
		resolvedTargets: ResolvedMessageTarget[]
	): string {
		const actionText = actions.length > 0 ? actions.join(', ') : 'none';
		const targetText =
			resolvedTargets.length > 0
				? resolvedTargets.map((target) => `${target.kind}:${target.path}`).join(', ')
				: preferredTarget;
		return `actions=${actionText}; target=${targetText}; status=${targetStatus}`;
	}
}
