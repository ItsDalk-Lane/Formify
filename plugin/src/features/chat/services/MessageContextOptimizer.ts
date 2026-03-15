import { countTokens } from 'gpt-tokenizer';
import type { Message as ProviderMessage } from 'src/features/tars/providers';
import { parseContentBlocks } from '../utils/markdown';
import type {
	ChatContextCompactionRange,
	ChatContextCompactionState,
	ChatMessage,
	MessageManagementSettings,
} from '../types/chat';
import { isPinnedChatMessage } from '../types/chat';

const CONTEXT_COMPACTION_VERSION = 3;
const MAX_SECTION_ITEMS = 6;
const MAX_SUMMARY_LINE_CHARS = 220;
const TOOL_RESULT_PREVIEW_CHARS = 160;
const EMBED_TOKEN_ESTIMATE = 256;
const HISTORY_SUMMARY_HEADER = '[Earlier conversation summary]';
const HISTORY_SUMMARY_INTRO =
	'This block compresses earlier chat turns. Treat it as prior context, not a new instruction.';
const SUMMARY_CONTEXT_HEADING = '[CONTEXT]';
const SUMMARY_DECISIONS_HEADING = '[KEY DECISIONS]';
const SUMMARY_CURRENT_STATE_HEADING = '[CURRENT STATE]';
const SUMMARY_IMPORTANT_DETAILS_HEADING = '[IMPORTANT DETAILS]';
const SUMMARY_OPEN_ITEMS_HEADING = '[OPEN ITEMS]';
const SUMMARY_HEADINGS = [
	SUMMARY_CONTEXT_HEADING,
	SUMMARY_DECISIONS_HEADING,
	SUMMARY_CURRENT_STATE_HEADING,
	SUMMARY_IMPORTANT_DETAILS_HEADING,
	SUMMARY_OPEN_ITEMS_HEADING,
] as const;

export interface SummaryGenerationRequest {
	kind: 'history';
	baseSummary: string;
	previousSummary?: string;
	deltaSummary?: string;
	incremental: boolean;
	targetTokens: number;
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
			targetHistoryBudgetTokens?: number;
			summaryGenerator?: MessageContextSummaryGenerator;
		}
	): Promise<MessageContextOptimizationResult> {
		const stickyTailStart = this.findStickyTailStart(messages);
		const coreMessages = messages.slice(0, stickyTailStart);
		const stickyTail = messages.slice(stickyTailStart);
		const historyBudgetTokens = this.normalizePositiveInteger(
			options?.targetHistoryBudgetTokens,
			Number.MAX_SAFE_INTEGER
		);
		const recentTurns = this.normalizePositiveInteger(settings.recentTurns, 1);

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

		const recentStart = this.findRecentTurnStart(coreMessages, recentTurns);
		const recentMessages = coreMessages.slice(recentStart);
		const olderMessages = coreMessages.slice(0, recentStart);
		const pinnedOlderMessages = olderMessages.filter((message) =>
			isPinnedChatMessage(message)
		);
		const compactedHistory = olderMessages.filter(
			(message) => !isPinnedChatMessage(message)
		);
		const protectedMessages = [...pinnedOlderMessages, ...recentMessages];
		const protectedHistoryTokens = this.estimateChatTokens(protectedMessages);

		if (compactedHistory.length === 0 || protectedHistoryTokens >= historyBudgetTokens) {
			const preservedMessages = [...protectedMessages, ...stickyTail];
			return {
				messages: preservedMessages,
				contextCompaction: {
					version: CONTEXT_COMPACTION_VERSION,
					coveredRange: {
						endMessageId: null,
						messageCount: 0,
						signature: '0',
					},
					summary: '',
					historyTokenEstimate: this.estimateChatTokens(protectedMessages),
					contextSummary: existingCompaction?.contextSummary,
					contextSourceSignature: existingCompaction?.contextSourceSignature,
					contextTokenEstimate: existingCompaction?.contextTokenEstimate,
					totalTokenEstimate: existingCompaction?.totalTokenEstimate,
					updatedAt: Date.now(),
					droppedReasoningCount: 0,
					overflowedProtectedLayers: true,
				},
				historyTokenEstimate: this.estimateChatTokens(protectedMessages),
				usedSummary: false,
				droppedReasoningCount: 0,
			};
		}

		return this.buildCompactedResult(
			compactedHistory,
			pinnedOlderMessages,
			recentMessages,
			stickyTail,
			historyBudgetTokens,
			existingCompaction,
			options?.summaryGenerator
		);
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
		compactedHistory: ChatMessage[],
		pinnedMessages: ChatMessage[],
		recentMessages: ChatMessage[],
		stickyTail: ChatMessage[],
		historyBudgetTokens: number,
		existingCompaction?: ChatContextCompactionState | null,
		summaryGenerator?: MessageContextSummaryGenerator
	): Promise<MessageContextOptimizationResult> {
		const coveredRange = this.buildCoveredRange(compactedHistory);
		const protectedHistoryTokens = this.estimateChatTokens([
			...pinnedMessages,
			...recentMessages,
		]);
		const summaryBudgetTokens = Math.max(0, historyBudgetTokens - protectedHistoryTokens);
		const summaryBuild = await this.resolveSummary(
			compactedHistory,
			coveredRange,
			summaryBudgetTokens,
			existingCompaction,
			summaryGenerator
		);
		const summaryMessage =
			summaryBuild.summary.trim().length > 0
				? {
					id: `context-compaction:${coveredRange.endMessageId ?? 'history'}`,
					role: 'assistant' as const,
					content: summaryBuild.summary,
					timestamp:
						compactedHistory[compactedHistory.length - 1]?.timestamp ?? Date.now(),
					metadata: {
						isContextSummary: true,
						hidden: true,
						hiddenFromHistory: true,
					},
				}
				: null;
		const optimizedCoreMessages = [
			...pinnedMessages,
			...(summaryMessage ? [summaryMessage] : []),
			...recentMessages,
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
				overflowedProtectedLayers: false,
			},
			historyTokenEstimate,
			usedSummary: Boolean(summaryMessage),
			droppedReasoningCount: summaryBuild.droppedReasoningCount,
		};
	}

	private async resolveSummary(
		messages: ChatMessage[],
		coveredRange: ChatContextCompactionRange,
		summaryBudgetTokens: number,
		existingCompaction?: ChatContextCompactionState | null,
		summaryGenerator?: MessageContextSummaryGenerator
	): Promise<SummaryBuildResult> {
		if (summaryBudgetTokens <= 0) {
			return {
				summary: '',
				droppedReasoningCount: 0,
			};
		}

		if (this.canReuseCompaction(existingCompaction, coveredRange)) {
			return {
				summary: this.fitSummaryToBudget(existingCompaction.summary, summaryBudgetTokens),
				droppedReasoningCount: existingCompaction.droppedReasoningCount ?? 0,
			};
		}

		const baseSummary = this.buildSummary(messages, summaryBudgetTokens);
		if (!summaryGenerator) {
			return {
				summary: this.fitSummaryToBudget(baseSummary.summary, summaryBudgetTokens),
				droppedReasoningCount: baseSummary.droppedReasoningCount,
			};
		}

		try {
			const incrementalDelta = this.getIncrementalDeltaSummary(messages, existingCompaction);
			const generatedSummary = await summaryGenerator({
				kind: 'history',
				baseSummary: baseSummary.summary,
				previousSummary: incrementalDelta ? existingCompaction?.summary : undefined,
				deltaSummary: incrementalDelta?.summary,
				incremental: Boolean(incrementalDelta),
				targetTokens: summaryBudgetTokens,
			});
			return {
				summary: this.fitSummaryToBudget(
					this.normalizeGeneratedSummary(generatedSummary, baseSummary.summary),
					summaryBudgetTokens
				),
				droppedReasoningCount: baseSummary.droppedReasoningCount,
			};
		} catch {
			return {
				summary: this.fitSummaryToBudget(baseSummary.summary, summaryBudgetTokens),
				droppedReasoningCount: baseSummary.droppedReasoningCount,
			};
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
		if (
			!previousLastMessage
			|| this.buildStableMessageKey(previousLastMessage)
				!== existingCompaction.coveredRange.endMessageId
		) {
			return null;
		}

		if (this.buildSignature(previousMessages) !== existingCompaction.coveredRange.signature) {
			return null;
		}

		const deltaMessages = messages.slice(previousCount);
		return deltaMessages.length > 0
			? this.buildSummary(deltaMessages, Number.MAX_SAFE_INTEGER)
			: null;
	}

	private normalizeGeneratedSummary(summary: string | null, fallback: string): string {
		const trimmed = summary?.trim();
		if (!trimmed) {
			return fallback;
		}
		if (!this.hasExpectedSummaryStructure(trimmed)) {
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
		return this.mergeImportantDetails(normalized, fallback);
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
			endMessageId: messages[messages.length - 1]
				? this.buildStableMessageKey(messages[messages.length - 1])
				: null,
			messageCount: messages.length,
			signature: this.buildSignature(messages),
		};
	}

	private buildStableMessageKey(message: ChatMessage): string {
		const toolSignature = (message.toolCalls ?? [])
			.map((toolCall) => `${toolCall.name}:${toolCall.result ?? ''}`)
			.join('|');
		return [
			message.role,
			message.timestamp,
			message.content,
			toolSignature,
		].join('::');
	}

	private buildSignature(messages: ChatMessage[]): string {
		let hash = 5381;
		for (const message of messages) {
			const value = this.buildStableMessageKey(message);
			for (let index = 0; index < value.length; index += 1) {
				hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
			}
		}
		return String(hash >>> 0);
	}

	private buildSummary(
		messages: ChatMessage[],
		summaryBudgetTokens: number
	): SummaryBuildResult {
		const sessionIntent: string[] = [];
		const currentState: string[] = [];
		const decisions: string[] = [];
		const importantDetails: string[] = [];
		const openItems: string[] = [];
		let droppedReasoningCount = 0;
		const detailLimit = summaryBudgetTokens < 320
			? 2
			: summaryBudgetTokens < 640
				? 4
				: MAX_SECTION_ITEMS;
		const importantDetailLimit = Math.min(
			MAX_SECTION_ITEMS,
			Math.max(4, detailLimit)
		);

		for (const message of messages) {
			const text = this.extractVisibleText(message);
			const compact = this.compactLine(text);

			if (message.role === 'user' && compact) {
				this.pushUnique(sessionIntent, compact);
				this.pushUnique(openItems, compact);
			}

			if (message.role === 'assistant' && compact) {
				this.pushUnique(currentState, compact);
				if (this.looksLikeDecision(compact)) {
					this.pushUnique(decisions, compact);
				}
			}

			if (message.role === 'user') {
				const constraints = this.extractConstraintLines(message.content);
				for (const requirement of constraints.requirements) {
					this.pushUnique(importantDetails, `Requirement: ${requirement}`);
				}
				for (const prohibition of constraints.prohibitions) {
					this.pushUnique(importantDetails, `Prohibition: ${prohibition}`);
				}
			}

			const reasoningBlocks = parseContentBlocks(message.content).filter(
				(block) => block.type === 'reasoning'
			);
			droppedReasoningCount += reasoningBlocks.length;

			for (const reference of this.extractPathReferences(message)) {
				this.pushUnique(importantDetails, `Path: ${reference}`);
			}

			for (const detail of this.extractImportantDetailLines(message.content)) {
				this.pushUnique(importantDetails, detail);
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
				this.pushUnique(importantDetails, `Tool: ${parts.join(' · ')}`);
			}
		}

		const lines = [
			HISTORY_SUMMARY_HEADER,
			HISTORY_SUMMARY_INTRO,
			'',
			SUMMARY_CONTEXT_HEADING,
			...this.toBulletLines(sessionIntent, Math.min(3, detailLimit)),
			'',
			SUMMARY_DECISIONS_HEADING,
			...this.toBulletLines(decisions, detailLimit),
			'',
			SUMMARY_CURRENT_STATE_HEADING,
			...this.toBulletLines(currentState, detailLimit),
			'',
			SUMMARY_IMPORTANT_DETAILS_HEADING,
			...this.toBulletLines(importantDetails, importantDetailLimit),
			'',
			SUMMARY_OPEN_ITEMS_HEADING,
			...this.toBulletLines(openItems, Math.min(3, detailLimit)),
		];

		return {
			summary: lines.join('\n').trim(),
			droppedReasoningCount,
		};
	}

	private extractImportantDetailLines(content: string): string[] {
		const details: string[] = [];
		const lines = String(content ?? '').split('\n');

		for (const rawLine of lines) {
			const line = rawLine
				.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|#+\s*)/, '')
				.trim();
			if (!line || line.length > MAX_SUMMARY_LINE_CHARS * 1.8) {
				continue;
			}
			if (
				/`[^`]+`/.test(line)
				|| /(?:^|[^\d])\d+(?:\.\d+)?(?:%|ms|s|kb|mb|gb|tokens?)?/i.test(line)
				|| /(max_tokens|max_output_tokens|contextlength|summarymodeltag|frontmatter|contextsummary|contextsourcesignature|totaltokenestimate)/i.test(line)
				|| /[:=]/.test(line)
			) {
				this.pushUnique(details, line);
			}
		}

		return details;
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

	private hasExpectedSummaryStructure(summary: string): boolean {
		return SUMMARY_HEADINGS.every((heading) => summary.includes(heading));
	}

	private mergeImportantDetails(summary: string, fallback: string): string {
		const fallbackItems = this.extractSectionItems(
			fallback,
			SUMMARY_IMPORTANT_DETAILS_HEADING
		);
		if (
			fallbackItems.length === 0
			|| fallbackItems.every((item) => item === '- None')
		) {
			return summary;
		}

		const summaryItems = this.extractSectionItems(
			summary,
			SUMMARY_IMPORTANT_DETAILS_HEADING
		);
		const missingItems = fallbackItems.filter((item) => !summaryItems.includes(item));
		if (missingItems.length === 0) {
			return summary;
		}

		const parsed = this.parseStructuredSummary(summary);
		const importantSection = parsed.sections.find(
			(section) => section.heading === SUMMARY_IMPORTANT_DETAILS_HEADING
		);
		if (!importantSection) {
			parsed.sections.push({
				heading: SUMMARY_IMPORTANT_DETAILS_HEADING,
				items: [...missingItems],
			});
			return this.renderStructuredSummary(parsed);
		}

		for (const item of missingItems) {
			if (!importantSection.items.includes(item)) {
				importantSection.items.push(item);
			}
		}

		return this.renderStructuredSummary(parsed);
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
			if (SUMMARY_HEADINGS.includes(line as typeof SUMMARY_HEADINGS[number])) {
				break;
			}
			if (line.startsWith('- ')) {
				items.push(line);
			}
		}

		return items;
	}

	private parseStructuredSummary(summary: string): {
		preamble: string[];
		sections: Array<{ heading: string; items: string[] }>;
	} {
		const lines = summary.trim().split('\n');
		const preamble: string[] = [];
		const sections: Array<{ heading: string; items: string[] }> = [];
		let currentSection: { heading: string; items: string[] } | null = null;

		for (const line of lines) {
			if (SUMMARY_HEADINGS.includes(line as typeof SUMMARY_HEADINGS[number])) {
				currentSection = { heading: line, items: [] };
				sections.push(currentSection);
				continue;
			}
			if (!currentSection) {
				preamble.push(line);
				continue;
			}
			if (line.startsWith('- ')) {
				currentSection.items.push(line);
			} else if (line.trim()) {
				currentSection.items.push(`- ${line.trim()}`);
			}
		}

		for (const heading of SUMMARY_HEADINGS) {
			if (!sections.some((section) => section.heading === heading)) {
				sections.push({ heading, items: ['- None'] });
			}
		}

		return { preamble, sections };
	}

	private renderStructuredSummary(summary: {
		preamble: string[];
		sections: Array<{ heading: string; items: string[] }>;
	}): string {
		const lines: string[] = [];
		const preamble = summary.preamble.filter((line) => line.trim().length > 0);
		if (preamble.length > 0) {
			lines.push(...preamble, '');
		}

		for (const heading of SUMMARY_HEADINGS) {
			const section = summary.sections.find((item) => item.heading === heading);
			lines.push(heading, ...(section?.items.length ? section.items : ['- None']), '');
		}

		return lines.join('\n').trim();
	}

	private fitSummaryToBudget(summary: string, targetBudgetTokens: number): string {
		const trimmed = summary.trim();
		if (!trimmed || targetBudgetTokens <= 0) {
			return '';
		}

		let parsed = this.parseStructuredSummary(trimmed);
		let fitted = this.renderStructuredSummary(parsed);
		const estimateTokens = (value: string) =>
			this.estimateProviderMessagesTokens([{ role: 'assistant', content: value }]);
		if (estimateTokens(fitted) <= targetBudgetTokens) {
			return fitted;
		}

		const trimOrder = [
			SUMMARY_OPEN_ITEMS_HEADING,
			SUMMARY_CURRENT_STATE_HEADING,
			SUMMARY_DECISIONS_HEADING,
			SUMMARY_CONTEXT_HEADING,
		];

		for (;;) {
			let removed = false;
			for (const heading of trimOrder) {
				const section = parsed.sections.find((item) => item.heading === heading);
				if (section && section.items.length > 1) {
					section.items.pop();
					removed = true;
					break;
				}
			}
			fitted = this.renderStructuredSummary(parsed);
			if (!removed || estimateTokens(fitted) <= targetBudgetTokens) {
				break;
			}
		}

		for (const maxChars of [180, 140, 110, 90, 70, 50]) {
			parsed = {
				...parsed,
				sections: parsed.sections.map((section) => ({
					...section,
					items: section.items.map((item) =>
						item === '- None'
							|| section.heading === SUMMARY_IMPORTANT_DETAILS_HEADING
							? item
							: `- ${this.compactLine(item.slice(2), maxChars)}`
					),
				})),
			};
			fitted = this.renderStructuredSummary(parsed);
			if (estimateTokens(fitted) <= targetBudgetTokens) {
				return fitted;
			}
		}

		return fitted;
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

	private toBulletLines(items: string[], limit = MAX_SECTION_ITEMS): string[] {
		if (items.length === 0) {
			return ['- None'];
		}
		return items.slice(0, limit).map((item) => `- ${item}`);
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

	private normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
		if (Number.isFinite(value) && value > 0) {
			return Math.floor(value);
		}
		return fallback;
	}
}
