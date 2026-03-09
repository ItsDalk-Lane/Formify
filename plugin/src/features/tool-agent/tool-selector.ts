import { toolRegistry, ToolRegistry } from './registry';
import type { ToolDefinition, ToolSelectionResult } from './registry/types';
import type { ToolAgentRequest, ToolAgentRuntimeTool } from './types';

const DEFAULT_FALLBACK_TOOL_NAMES = [
	'quick_search',
	'search_content',
	'search_files',
	'list_directory',
	'read_file',
	'query_vault',
	'sequentialthinking',
];

const COMPLEXITY_BONUS: Record<
	NonNullable<NonNullable<ToolAgentRequest['hints']>['complexity']>,
	number
> = {
	simple: 0,
	moderate: 15,
	complex: 35,
};

const normalize = (value: string): string => value.trim().toLowerCase();

const tokenize = (value: string): string[] =>
	Array.from(
		new Set(
			normalize(value)
				.split(/[\s,.;:!?()[\]{}"'`\\/|<>，。；：！？（）【】《》、]+/g)
				.map((part) => part.trim())
				.filter(Boolean)
		)
	);

const scorePhrases = (task: string, candidates: string[], exactScore: number, partialScore: number): number => {
	const normalizedTask = normalize(task);
	let score = 0;
	for (const candidate of candidates) {
		const normalizedCandidate = normalize(candidate);
		if (!normalizedCandidate) continue;
		if (normalizedTask === normalizedCandidate) {
			score += exactScore;
			continue;
		}
		if (normalizedTask.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedTask)) {
			score += partialScore;
		}
	}
	return score;
};

const scoreTokens = (taskTokens: string[], candidates: string[], tokenScore: number): number => {
	let score = 0;
	for (const candidate of candidates) {
		const normalizedCandidate = normalize(candidate);
		if (!normalizedCandidate) continue;
		for (const token of taskTokens) {
			if (token === normalizedCandidate || normalizedCandidate.includes(token) || token.includes(normalizedCandidate)) {
				score += tokenScore;
				break;
			}
		}
	}
	return score;
};

export class ToolSelector {
	constructor(private readonly registry: ToolRegistry = toolRegistry) {}

	selectTools(
		task: string,
		hints?: ToolAgentRequest['hints']
	): ToolSelectionResult[] {
		const normalizedTask = normalize(task);
		const taskTokens = tokenize(task);
		const allowedServerIds =
			hints?.likelyServerIds && hints.likelyServerIds.length > 0
				? new Set(hints.likelyServerIds)
				: null;

		if (hints?.suggestedTools && hints.suggestedTools.length > 0) {
			const direct = hints.suggestedTools
				.map((name) => this.registry.getToolByName(name))
				.filter((tool): tool is ToolDefinition => !!tool)
				.filter((tool) => !allowedServerIds || allowedServerIds.has(tool.serverId))
				.map((tool, index) => ({
					tool,
					relevanceScore: 1000 - index * 10,
				}));
			if (direct.length > 0) {
				return direct.slice(0, 3);
			}
		}

		const allBuiltinTools = this.registry.getBuiltinExecutionTools();
		const serverScopedTools = allowedServerIds
			? allBuiltinTools.filter((tool) => allowedServerIds.has(tool.serverId))
			: allBuiltinTools;
		const intentScopedTools =
			hints?.domain || hints?.intentType
				? serverScopedTools.filter((tool) => {
					const matchesDomain =
						!hints?.domain || normalize(hints.domain) === normalize(tool.category);
					const matchesIntent =
						!hints?.intentType
						|| tool.intentPatterns.some((pattern) =>
							normalize(pattern).includes(normalize(hints.intentType ?? ''))
						)
						|| normalize(tool.name).includes(normalize(hints.intentType));
					return matchesDomain || matchesIntent;
				})
				: serverScopedTools;
		const candidateTools =
			intentScopedTools.length > 0
				? intentScopedTools
				: serverScopedTools.length > 0
					? serverScopedTools
					: allBuiltinTools;

		const scored = candidateTools
			.map((tool) => {
				let score = 0;
				score += scorePhrases(task, tool.intentPatterns, 180, 90);
				score += scoreTokens(taskTokens, tool.intentPatterns, 60);
				score += scorePhrases(task, tool.searchKeywords, 110, 55);
				score += scoreTokens(taskTokens, tool.searchKeywords, 35);
				score += scorePhrases(task, tool.scenarios.primary, 70, 35);
				score += scorePhrases(task, tool.scenarios.secondary, 35, 18);
				score += scoreTokens(taskTokens, [tool.name, tool.category, tool.serverId, tool.serverName], 20);
				if (hints?.domain && normalize(hints.domain) === normalize(tool.category)) {
					score += 45;
				}
				if (
					hints?.intentType
					&& (
						normalize(tool.name).includes(normalize(hints.intentType))
						|| tool.intentPatterns.some((pattern) =>
							normalize(pattern).includes(normalize(hints.intentType ?? ''))
						)
					)
				) {
					score += 55;
				}
				if (hints?.complexity) {
					score += COMPLEXITY_BONUS[hints.complexity];
				}
				if (allowedServerIds && allowedServerIds.has(tool.serverId)) {
					score += 25;
				}
				if (normalizedTask.includes(tool.name.toLowerCase())) {
					score += 120;
				}
				return {
					tool,
					relevanceScore: score,
				};
			})
			.filter((item) => item.relevanceScore > 0)
			.sort((left, right) => {
				if (right.relevanceScore !== left.relevanceScore) {
					return right.relevanceScore - left.relevanceScore;
				}
				return left.tool.name.localeCompare(right.tool.name, 'en');
			});

		if (scored.length === 0) {
			return DEFAULT_FALLBACK_TOOL_NAMES
				.map((name, index) => this.registry.getToolByName(name))
				.filter((tool): tool is ToolDefinition => !!tool)
				.filter((tool) => !allowedServerIds || allowedServerIds.has(tool.serverId))
				.map((tool, index) => ({
					tool,
					relevanceScore: 100 - index * 5,
				}));
		}

		const top = scored[0].relevanceScore;
		const closeMatches = scored.filter((item) => top - item.relevanceScore <= 80);
		const limit = top >= 220 && closeMatches.length <= 3 ? 3 : Math.min(8, closeMatches.length);
		return closeMatches.slice(0, Math.max(1, limit));
	}

	selectExternalTools(
		task: string,
		tools: ToolAgentRuntimeTool[],
		hints?: ToolAgentRequest['hints']
	): Array<ToolAgentRuntimeTool & { relevanceScore: number }> {
		const taskTokens = tokenize(task);
		const allowedServerIds =
			hints?.likelyServerIds && hints.likelyServerIds.length > 0
				? new Set(hints.likelyServerIds)
				: null;

		return tools
			.filter((tool) => !allowedServerIds || allowedServerIds.has(tool.serverId))
			.map((tool) => {
				let score = 0;
				score += scorePhrases(task, [tool.name, tool.description], 120, 60);
				score += scoreTokens(taskTokens, [tool.name, tool.description, tool.serverId], 30);
				if (normalize(task).includes(tool.name.toLowerCase())) {
					score += 80;
				}
				if (allowedServerIds && allowedServerIds.has(tool.serverId)) {
					score += 20;
				}
				return {
					...tool,
					relevanceScore: score,
				};
			})
			.filter((tool) => tool.relevanceScore > 0)
			.sort((left, right) => right.relevanceScore - left.relevanceScore)
			.slice(0, 6);
	}
}
