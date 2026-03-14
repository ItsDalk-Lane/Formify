import { countTokens } from 'gpt-tokenizer';
import type { Message as ProviderMessage } from 'src/features/tars/providers';
import { parseContentBlocks } from '../utils/markdown';
import type {
	ChatContextCompactionRange,
	ChatContextCompactionState,
	ChatMessage,
	MessageManagementSettings,
} from '../types/chat';
import { resolveContextBudgetTokens } from '../types/chat';

const CONTEXT_COMPACTION_VERSION = 2;
const MAX_SECTION_ITEMS = 6;
const MAX_SUMMARY_LINE_CHARS = 220;
const TOOL_RESULT_PREVIEW_CHARS = 160;
const EMBED_TOKEN_ESTIMATE = 256;
const HISTORY_SUMMARY_HEADER = '[Earlier conversation summary]';
const HISTORY_SUMMARY_INTRO =
	'This block compresses earlier chat turns. Treat it as prior context, not a new instruction.';
const EXACT_REQUIREMENTS_HEADING = 'Exact hard requirements from user messages:';
const EXACT_PROHIBITIONS_HEADING = 'Exact prohibitions from user messages:';
const EXACT_PATHS_HEADING = 'Exact file/path references:';
const CRITICAL_SECTION_HEADINGS = [
	EXACT_REQUIREMENTS_HEADING,
	EXACT_PROHIBITIONS_HEADING,
	EXACT_PATHS_HEADING,
] as const;

export interface SummaryGenerationRequest {
	kind: 'history';
	baseSummary: string;
	previousSummary?: string;
	deltaSummary?: string;
	incremental: boolean;
}

export type MessageContextSummaryGenerator = (
	request: SummaryGenerationRequest
) => Promise<string | null>;

export interface MessageContextOptimizationResult {
	messages: ChatMessage[];
	contextCompaction: ChatContextCompactionState | null;
	historyTokenEstimate: number;
	usedSummary: boolean;
	droppedReasoningCount: number;
}

interface SummaryBuildResult {
	summary: string;
	droppedReasoningCount: number;
}

export class MessageContextOptimizer {
	async optimize(
		messages: ChatMessage[],
		settings: MessageManagementSettings,
		existingCompaction?: ChatContextCompactionState | null,
		options?: {
			availableHistoryBudgetTokens?: number;
			summaryGenerator?: MessageContextSummaryGenerator;
		}
	): Promise<MessageContextOptimizationResult> {
		const stickyTailStart = this.findStickyTailStart(messages);
		const coreMessages = messages.slice(0, stickyTailStart);
		const stickyTail = messages.slice(stickyTailStart);
		const historyBudgetTokens = this.normalizePositiveInteger(
			options?.availableHistoryBudgetTokens
				?? resolveContextBudgetTokens(settings),
			resolveContextBudgetTokens(settings)
		);
		const recentTurns = this.normalizePositiveInteger(settings.recentTurns, 6);

		if (coreMessages.length === 0) {
			return {
				messages,
				contextCompaction: null,
				historyTokenEstimate: 0,
				usedSummary: false,
				droppedReasoningCount: 0,
			};
		}

		const totalHistoryTokens = this.estimateChatTokens(coreMessages);
		if (totalHistoryTokens <= historyBudgetTokens) {
			return {
				messages,
				contextCompaction: existingCompaction
					? {
						...existingCompaction,
						historyTokenEstimate: totalHistoryTokens,
						totalTokenEstimate: existingCompaction.totalTokenEstimate,
					}
					: null,
				historyTokenEstimate: totalHistoryTokens,
				usedSummary: false,
				droppedReasoningCount: 0,
			};
		}

		let recentStart = this.findRecentTurnStart(coreMessages, recentTurns);
		let optimized = await this.buildCompactedResult(
			coreMessages,
			stickyTail,
			recentStart,
			existingCompaction,
			options?.summaryGenerator
		);

		while (optimized.historyTokenEstimate > historyBudgetTokens) {
			const nextStart = this.findNextTurnStart(coreMessages, recentStart);
			if (nextStart === recentStart) {
				break;
			}
			recentStart = nextStart;
			optimized = await this.buildCompactedResult(
				coreMessages,
				stickyTail,
				recentStart,
				existingCompaction,
				options?.summaryGenerator
			);
		}

		return optimized;
	}

	estimateChatTokens(messages: ChatMessage[]): number {
		if (messages.length === 0) {
			return 0;
		}

		try {
			return Number(
				countTokens(
					messages.map((message) => ({
						role: message.role === 'tool' ? 'assistant' : message.role,
						content: message.content,
					})) as any
				)
			);
		} catch {
			const totalChars = messages.reduce(
				(sum, message) => sum + String(message.content ?? '').length,
				0
			);
			return Math.ceil(totalChars / 4);
		}
	}

	estimateProviderMessagesTokens(messages: Array<Pick<ProviderMessage, 'role' | 'content' | 'embeds'>>): number {
		if (messages.length === 0) {
			return 0;
		}

		try {
			const tokenEstimate = Number(
				countTokens(
					messages.map((message) => ({
						role: message.role,
						content: message.content,
					})) as any
				)
			);
			const embedPenalty = messages.reduce(
				(sum, message) => sum + (message.embeds?.length ?? 0) * EMBED_TOKEN_ESTIMATE,
				0
			);
			return tokenEstimate + embedPenalty;
		} catch {
			const totalChars = messages.reduce(
				(sum, message) => sum + String(message.content ?? '').length,
				0
			);
			const embedPenalty = messages.reduce(
				(sum, message) => sum + (message.embeds?.length ?? 0) * EMBED_TOKEN_ESTIMATE,
				0
			);
			return Math.ceil(totalChars / 4) + embedPenalty;
		}
	}

	private async buildCompactedResult(
		coreMessages: ChatMessage[],
		stickyTail: ChatMessage[],
		recentStart: number,
		existingCompaction?: ChatContextCompactionState | null,
		summaryGenerator?: MessageContextSummaryGenerator
	): Promise<MessageContextOptimizationResult> {
		const compactedHistory = coreMessages.slice(0, recentStart);
		if (compactedHistory.length === 0) {
			return {
				messages: [...coreMessages, ...stickyTail],
				contextCompaction: existingCompaction
					? {
						...existingCompaction,
						historyTokenEstimate: this.estimateChatTokens(coreMessages),
					}
					: null,
				historyTokenEstimate: this.estimateChatTokens(coreMessages),
				usedSummary: false,
				droppedReasoningCount: 0,
			};
		}

		const coveredRange = this.buildCoveredRange(compactedHistory);
		const summaryBuild = await this.resolveSummary(
			compactedHistory,
			coveredRange,
			existingCompaction,
			summaryGenerator
		);
		const summaryMessage: ChatMessage = {
			id: `context-compaction:${coveredRange.endMessageId ?? 'history'}`,
			role: 'assistant',
			content: summaryBuild.summary,
			timestamp: compactedHistory[compactedHistory.length - 1]?.timestamp ?? Date.now(),
			metadata: {
				isContextSummary: true,
				hidden: true,
				hiddenFromHistory: true,
			},
		};
		const optimizedCoreMessages = [
			summaryMessage,
			...coreMessages.slice(recentStart),
		];
		const historyTokenEstimate = this.estimateChatTokens(optimizedCoreMessages);

		return {
			messages: [...optimizedCoreMessages, ...stickyTail],
			contextCompaction: {
				version: CONTEXT_COMPACTION_VERSION,
				coveredRange,
				summary: summaryBuild.summary,
				historyTokenEstimate,
				contextSummary: existingCompaction?.contextSummary,
				contextSourceSignature: existingCompaction?.contextSourceSignature,
				contextTokenEstimate: existingCompaction?.contextTokenEstimate,
				totalTokenEstimate: existingCompaction?.totalTokenEstimate,
				updatedAt: Date.now(),
				droppedReasoningCount: summaryBuild.droppedReasoningCount,
			},
			historyTokenEstimate,
			usedSummary: true,
			droppedReasoningCount: summaryBuild.droppedReasoningCount,
		};
	}

	private async resolveSummary(
		messages: ChatMessage[],
		coveredRange: ChatContextCompactionRange,
		existingCompaction?: ChatContextCompactionState | null,
		summaryGenerator?: MessageContextSummaryGenerator
	): Promise<SummaryBuildResult> {
		if (this.canReuseCompaction(existingCompaction, coveredRange)) {
			return {
				summary: existingCompaction.summary,
				droppedReasoningCount: existingCompaction.droppedReasoningCount ?? 0,
			};
		}

		const baseSummary = this.buildSummary(messages);
		if (!summaryGenerator) {
			return baseSummary;
		}

		try {
			const incrementalDelta = this.getIncrementalDeltaSummary(messages, existingCompaction);
			const generatedSummary = await summaryGenerator({
				kind: 'history',
				baseSummary: baseSummary.summary,
				previousSummary: incrementalDelta ? existingCompaction?.summary : undefined,
				deltaSummary: incrementalDelta?.summary,
				incremental: Boolean(incrementalDelta),
			});
			return {
				summary: this.normalizeGeneratedSummary(generatedSummary, baseSummary.summary),
				droppedReasoningCount: baseSummary.droppedReasoningCount,
			};
		} catch {
			return baseSummary;
		}
	}

	private getIncrementalDeltaSummary(
		messages: ChatMessage[],
		existingCompaction?: ChatContextCompactionState | null
	): SummaryBuildResult | null {
		if (!existingCompaction) {
			return null;
		}

		const previousCount = existingCompaction.coveredRange.messageCount;
		if (previousCount <= 0 || previousCount >= messages.length) {
			return null;
		}

		const previousMessages = messages.slice(0, previousCount);
		const previousLastMessage = previousMessages[previousMessages.length - 1];
		if (!previousLastMessage || previousLastMessage.id !== existingCompaction.coveredRange.endMessageId) {
			return null;
		}

		if (this.buildSignature(previousMessages) !== existingCompaction.coveredRange.signature) {
			return null;
		}

		const deltaMessages = messages.slice(previousCount);
		return deltaMessages.length > 0 ? this.buildSummary(deltaMessages) : null;
	}

	private normalizeGeneratedSummary(summary: string | null, fallback: string): string {
		const trimmed = summary?.trim();
		if (!trimmed) {
			return fallback;
		}
		const normalized = trimmed.includes(HISTORY_SUMMARY_HEADER)
			? trimmed
			: [
			HISTORY_SUMMARY_HEADER,
			HISTORY_SUMMARY_INTRO,
			'',
			trimmed,
		].join('\n');
		return this.mergeCriticalSections(normalized, fallback);
	}

	private canReuseCompaction(
		compaction: ChatContextCompactionState | null | undefined,
		coveredRange: ChatContextCompactionRange
	): compaction is ChatContextCompactionState {
		return Boolean(
			compaction
			&& compaction.version === CONTEXT_COMPACTION_VERSION
			&& compaction.coveredRange.endMessageId === coveredRange.endMessageId
			&& compaction.coveredRange.messageCount === coveredRange.messageCount
			&& compaction.coveredRange.signature === coveredRange.signature
			&& typeof compaction.summary === 'string'
			&& compaction.summary.trim().length > 0
		);
	}

	private buildCoveredRange(messages: ChatMessage[]): ChatContextCompactionRange {
		return {
			endMessageId: messages[messages.length - 1]?.id ?? null,
			messageCount: messages.length,
			signature: this.buildSignature(messages),
		};
	}

	private buildSignature(messages: ChatMessage[]): string {
		let hash = 5381;
		for (const message of messages) {
			const toolSignature = (message.toolCalls ?? [])
				.map((toolCall) => `${toolCall.name}:${toolCall.result ?? ''}`)
				.join('|');
			const value = [
				message.id,
				message.role,
				message.timestamp,
				message.content,
				toolSignature,
			].join('::');
			for (let index = 0; index < value.length; index += 1) {
				hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
			}
		}
		return String(hash >>> 0);
	}

	private buildSummary(messages: ChatMessage[]): SummaryBuildResult {
		const sessionIntent: string[] = [];
		const establishedFacts: string[] = [];
		const decisions: string[] = [];
		const importantFiles = new Set<string>();
		const exactRequirements: string[] = [];
		const exactProhibitions: string[] = [];
		const toolOutcomes: string[] = [];
		let droppedReasoningCount = 0;

		for (const message of messages) {
			const text = this.extractVisibleText(message);
			const compact = this.compactLine(text);

			if (message.role === 'user' && compact) {
				this.pushUnique(sessionIntent, compact);
			}

			if (message.role === 'assistant' && compact) {
				this.pushUnique(establishedFacts, compact);
				if (this.looksLikeDecision(compact)) {
					this.pushUnique(decisions, compact);
				}
			}

			if (message.role === 'user') {
				const constraints = this.extractConstraintLines(message.content);
				for (const requirement of constraints.requirements) {
					this.pushUnique(exactRequirements, requirement);
				}
				for (const prohibition of constraints.prohibitions) {
					this.pushUnique(exactProhibitions, prohibition);
				}
			}

			const reasoningBlocks = parseContentBlocks(message.content).filter(
				(block) => block.type === 'reasoning'
			);
			droppedReasoningCount += reasoningBlocks.length;

			for (const reference of this.extractPathReferences(message)) {
				if (importantFiles.size < MAX_SECTION_ITEMS) {
					importantFiles.add(reference);
				}
			}

			for (const toolCall of message.toolCalls ?? []) {
				const parts = [toolCall.name];
				const target = this.extractToolTarget(toolCall.arguments ?? {});
				if (target) {
					parts.push(target);
				}
				const resultPreview = this.compactLine(toolCall.result ?? '', TOOL_RESULT_PREVIEW_CHARS);
				if (resultPreview) {
					parts.push(`结果: ${resultPreview}`);
				}
				this.pushUnique(toolOutcomes, parts.join(' · '));
			}
		}

		const openThreads = sessionIntent.slice(-2);
		const lines = [
			HISTORY_SUMMARY_HEADER,
			HISTORY_SUMMARY_INTRO,
			'',
			'Session intent:',
			...this.toBulletLines(sessionIntent),
			'',
			EXACT_REQUIREMENTS_HEADING,
			...this.toBulletLines(exactRequirements),
			'',
			EXACT_PROHIBITIONS_HEADING,
			...this.toBulletLines(exactProhibitions),
			'',
			'Established facts:',
			...this.toBulletLines(establishedFacts),
			'',
			'Decisions made:',
			...this.toBulletLines(decisions),
			'',
			EXACT_PATHS_HEADING,
			...this.toBulletLines(Array.from(importantFiles)),
			'',
			'Tool outcomes:',
			...this.toBulletLines(toolOutcomes),
			'',
			'Open threads before the recent window:',
			...this.toBulletLines(openThreads),
		];

		return {
			summary: lines.join('\n').trim(),
			droppedReasoningCount,
		};
	}

	private extractVisibleText(message: ChatMessage): string {
		if (message.role !== 'assistant') {
			return this.normalizeText(message.content);
		}

		const blocks = parseContentBlocks(message.content);
		const textBlocks = blocks.filter((block) => block.type === 'text');
		if (textBlocks.length > 0) {
			return this.normalizeText(textBlocks.map((block) => block.content).join('\n'));
		}
		return this.normalizeText(message.content);
	}

	private extractPathReferences(message: ChatMessage): string[] {
		const matches = new Set<string>();
		const push = (value: string) => {
			const normalized = this.normalizePathReference(value);
			if (!normalized) {
				return;
			}
			matches.add(normalized);
		};

		for (const match of message.content.matchAll(/\[\[([^\]]+)\]\]/g)) {
			if (match[1]) {
				push(match[1]);
			}
		}

		for (const match of message.content.matchAll(/`([^`\n]*[\\/][^`\n]+)`/g)) {
			if (match[1]) {
				push(match[1]);
			}
		}

		for (const match of message.content.matchAll(
			/(?:^|[\s(（:：])((?:\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.:-]+(?:\.[A-Za-z0-9_.-]+)?)(?=$|[\s),.;:，。；）])/gm
		)) {
			if (match[1]) {
				push(match[1]);
			}
		}

		for (const toolCall of message.toolCalls ?? []) {
			const target = this.extractToolTarget(toolCall.arguments ?? {});
			if (target) {
				push(target);
			}
		}

		return Array.from(matches).slice(0, MAX_SECTION_ITEMS);
	}

	private normalizePathReference(value: string): string {
		const normalized = value
			.trim()
			.replace(/[，。；：,.;:]+$/g, '')
			.replace(/^['"`]+|['"`]+$/g, '');
		if (!this.isLikelyPathReference(normalized)) {
			return '';
		}
		return normalized;
	}

	private isLikelyPathReference(value: string): boolean {
		if (!value || /^https?:\/\//i.test(value)) {
			return false;
		}
		if (!value.includes('/') && !value.includes('\\')) {
			return false;
		}
		if (/\s/.test(value)) {
			return false;
		}
		return /[A-Za-z0-9_.-]/.test(value);
	}

	private extractConstraintLines(content: string): {
		requirements: string[];
		prohibitions: string[];
	} {
		const requirements: string[] = [];
		const prohibitions: string[] = [];
		const lines = String(content ?? '').split('\n');

		for (const rawLine of lines) {
			const line = rawLine
				.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|#+\s*)/, '')
				.trim();
			if (!line) {
				continue;
			}
			if (line.length > MAX_SUMMARY_LINE_CHARS * 1.8) {
				continue;
			}
			if (this.isConstraintLine(line)) {
				if (this.isProhibitionLine(line)) {
					this.pushUnique(prohibitions, line);
				} else {
					this.pushUnique(requirements, line);
				}
			}
		}

		return { requirements, prohibitions };
	}

	private isConstraintLine(line: string): boolean {
		return /必须|需要|应当|共享|进入同一套|只保留|优先生成|回退到|只能看到|至少要记住|完整保留|原始历史|frontmatter|reasoning_content|telemetry|markdown 正文|文件上下文|工具调用结果/i.test(
			line
		);
	}

	private isProhibitionLine(line: string): boolean {
		return /不允许|禁止|不得|不能|不要|不再|严禁/i.test(line);
	}

	private mergeCriticalSections(summary: string, fallback: string): string {
		const missingBlocks: string[] = [];

		for (const heading of CRITICAL_SECTION_HEADINGS) {
			const fallbackItems = this.extractSectionItems(fallback, heading);
			if (fallbackItems.length === 0 || fallbackItems.every((item) => item === '- None')) {
				continue;
			}

			const missingItems = fallbackItems.filter((item) => !summary.includes(item.slice(2)));
			if (missingItems.length === 0) {
				continue;
			}

			missingBlocks.push(heading, ...missingItems, '');
		}

		if (missingBlocks.length === 0) {
			return summary;
		}

		return `${summary.trim()}\n\n${missingBlocks.join('\n').trim()}`;
	}

	private extractSectionItems(summary: string, heading: string): string[] {
		const lines = summary.split('\n');
		const items: string[] = [];
		let collecting = false;

		for (const line of lines) {
			if (line === heading) {
				collecting = true;
				continue;
			}
			if (!collecting) {
				continue;
			}
			if (!line.trim()) {
				break;
			}
			if (!line.startsWith('- ')) {
				break;
			}
			items.push(line);
		}

		return items;
	}

	private extractToolTarget(args: Record<string, unknown>): string | null {
		const candidate = args.filePath ?? args.path ?? args.file ?? args.target ?? args.url ?? args.uri;
		return typeof candidate === 'string' && candidate.trim().length > 0
			? candidate.trim()
			: null;
	}

	private normalizeText(content: string): string {
		return String(content ?? '')
			.replace(/<!-- FF_AGENT_EVENTS_START -->[\s\S]*?<!-- FF_AGENT_EVENTS_END -->/g, ' ')
			.replace(/\{\{FF_MCP_TOOL_START\}\}[\s\S]*?\{\{FF_MCP_TOOL_END\}\}/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private compactLine(content: string, maxChars = MAX_SUMMARY_LINE_CHARS): string {
		const normalized = this.normalizeText(content);
		if (!normalized) {
			return '';
		}
		if (normalized.length <= maxChars) {
			return normalized;
		}
		return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
	}

	private looksLikeDecision(content: string): boolean {
		return /决定|采用|改为|使用|保留|切换|改成|方案|策略|计划|rewrite|reuse|keep|switch/i.test(
			content
		);
	}

	private toBulletLines(items: string[]): string[] {
		if (items.length === 0) {
			return ['- None'];
		}
		return items.slice(0, MAX_SECTION_ITEMS).map((item) => `- ${item}`);
	}

	private pushUnique(collection: string[], value: string): void {
		if (!value || collection.includes(value) || collection.length >= MAX_SECTION_ITEMS) {
			return;
		}
		collection.push(value);
	}

	private findStickyTailStart(messages: ChatMessage[]): number {
		let index = messages.length;
		while (index > 0 && messages[index - 1].metadata?.isEphemeralContext) {
			index -= 1;
		}
		return index;
	}

	private findRecentTurnStart(messages: ChatMessage[], recentTurns: number): number {
		let remainingTurns = recentTurns;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			if (messages[index].role !== 'user') {
				continue;
			}
			remainingTurns -= 1;
			if (remainingTurns === 0) {
				return index;
			}
		}
		return 0;
	}

	private findNextTurnStart(messages: ChatMessage[], currentStart: number): number {
		for (let index = currentStart + 1; index < messages.length; index += 1) {
			if (messages[index].role === 'user') {
				return index;
			}
		}
		return currentStart;
	}

	private normalizePositiveInteger(value: number, fallback: number): number {
		if (Number.isFinite(value) && value > 0) {
			return Math.floor(value);
		}
		return fallback;
	}
}
