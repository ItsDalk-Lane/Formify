import { DebugLogger } from 'src/utils/DebugLogger';
import type { Vendor } from 'src/features/tars/providers';
import {
	SubAgentRunner,
	parseJsonResponseFromContent,
	type ResolvedSubAgentProvider,
} from 'src/features/sub-agent';
import { IntentAgentPromptBuilder } from './IntentAgentPromptBuilder';
import type {
	ExecutionMode,
	IntentAgentProviderResolverResult,
	IntentAgentSettings,
	IntentComplexity,
	IntentDomain,
	IntentRequestRelation,
	IntentResult,
	IntentType,
	RequestContext,
	TargetType,
} from './types';

const VALID_TARGET_TYPES: TargetType[] = [
	'active_file',
	'selected_text',
	'specific_files',
	'vault_wide',
	'external',
	'conversation',
	'memory',
	'none',
];

const VALID_DOMAINS: IntentDomain[] = [
	'vault_read',
	'vault_write',
	'vault_search',
	'knowledge_mgmt',
	'generation',
	'reasoning',
	'conversation',
];

const VALID_INTENT_TYPES: IntentType[] = [
	'read_file',
	'read_directory',
	'read_metadata',
	'open_navigate',
	'create_file',
	'modify_file',
	'reorganize',
	'batch_operation',
	'find_by_name',
	'find_by_content',
	'find_by_tag',
	'find_by_property',
	'find_by_task',
	'complex_query',
	'memory_store',
	'memory_recall',
	'memory_update',
	'memory_explore',
	'generate_text',
	'transform_text',
	'generate_code',
	'generate_plan',
	'analyze_content',
	'compare',
	'explain',
	'decision_support',
	'chitchat',
	'clarification',
	'feedback',
	'continuation',
];

const VALID_COMPLEXITIES: IntentComplexity[] = ['simple', 'moderate', 'complex'];
const VALID_EXECUTION_MODES: ExecutionMode[] = [
	'direct_response',
	'tool_assisted',
	'plan_then_execute',
	'clarify_first',
];
const VALID_REQUEST_RELATIONS: IntentRequestRelation[] = [
	'standalone',
	'clarification_answer',
	'request_update',
];

const toRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' ? value as Record<string, unknown> : {};

const pickString = (value: unknown, fallback = ''): string =>
	typeof value === 'string' && value.trim() ? value.trim() : fallback;

const pickBoolean = (value: unknown, fallback = false): boolean =>
	typeof value === 'boolean' ? value : fallback;

const pickNumber = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const pickStringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		: [];

export interface IntentAgentDependencies {
	getSettings: () => IntentAgentSettings;
	resolveProviderByTag: (tag: string) => IntentAgentProviderResolverResult | null;
	getVendorByName: (vendorName: string) => Vendor | undefined;
	promptBuilder?: IntentAgentPromptBuilder;
	runner?: SubAgentRunner;
}

export class IntentAgent {
	private readonly promptBuilder: IntentAgentPromptBuilder;
	private readonly runner: SubAgentRunner;

	constructor(private readonly dependencies: IntentAgentDependencies) {
		this.promptBuilder = dependencies.promptBuilder ?? new IntentAgentPromptBuilder();
		this.runner = dependencies.runner ?? new SubAgentRunner({
			resolveProviderByTag: (tag) =>
				this.dependencies.resolveProviderByTag(tag) as ResolvedSubAgentProvider | null,
			getVendorByName: (vendorName) => this.dependencies.getVendorByName(vendorName),
		});
	}

	isEnabled(): boolean {
		const settings = this.dependencies.getSettings();
		return settings.enabled === true && settings.modelTag.trim().length > 0;
	}

	async recognize(context: RequestContext): Promise<IntentResult> {
		const settings = this.dependencies.getSettings();
		if (!this.isEnabled()) {
			throw new Error('Intent agent is disabled or not configured.');
		}

		const result = await this.runner.run({
			modelTag: settings.modelTag,
			timeoutMs: settings.timeoutMs,
			systemPrompt: this.promptBuilder.buildSystemPrompt(),
			userPrompt: this.promptBuilder.buildUserPrompt(context),
			enableReasoning: false,
			enableThinking: false,
			enableWebSearch: false,
		});
		const parsed = parseJsonResponseFromContent(result.content);
		const normalized = this.normalizeResult(parsed, context);
		DebugLogger.debug('[IntentAgent] IntentResult', normalized);
		return normalized;
	}

	private normalizeResult(raw: unknown, context: RequestContext): IntentResult {
		const root = toRecord(raw);
		const understanding = toRecord(root.understanding);
		const target = toRecord(understanding.target);
		const classification = toRecord(root.classification);
		const routing = toRecord(root.routing);
		const contextPrep = toRecord(routing.contextPrep);
		const constraints = toRecord(routing.constraints);
		const safetyFlags = toRecord(routing.safetyFlags);
		const clarification = toRecord(routing.clarification);
		const requestRelation = VALID_REQUEST_RELATIONS.includes(routing.requestRelation as IntentRequestRelation)
			? routing.requestRelation as IntentRequestRelation
			: 'standalone';
		const targetType = VALID_TARGET_TYPES.includes(target.type as TargetType)
			? target.type as TargetType
			: 'none';
		const domain = VALID_DOMAINS.includes(classification.domain as IntentDomain)
			? classification.domain as IntentDomain
			: 'conversation';
		const executionMode = VALID_EXECUTION_MODES.includes(routing.executionMode as ExecutionMode)
			? routing.executionMode as ExecutionMode
			: 'direct_response';
		const intentType = VALID_INTENT_TYPES.includes(classification.intentType as IntentType)
			? classification.intentType as IntentType
			: (executionMode === 'clarify_first' ? 'clarification' : 'chitchat');
		const complexity = VALID_COMPLEXITIES.includes(classification.complexity as IntentComplexity)
			? classification.complexity as IntentComplexity
			: (executionMode === 'plan_then_execute' ? 'complex' : 'simple');

		return {
			understanding: {
				normalizedRequest: pickString(understanding.normalizedRequest, context.userMessage.trim()),
				target: {
					type: targetType,
					...(pickStringArray(target.paths).length > 0
						? { paths: pickStringArray(target.paths) }
						: {}),
					...(pickString(target.contentHint)
						? { contentHint: pickString(target.contentHint).slice(0, 120) }
						: {}),
				},
				...(Object.keys(toRecord(understanding.resolvedReferences)).length > 0
					? { resolvedReferences: toRecord(understanding.resolvedReferences) as Record<string, string> }
					: {}),
				...(pickStringArray(understanding.missingInfo).length > 0
					? { missingInfo: pickStringArray(understanding.missingInfo) }
					: {}),
			},
			classification: {
				domain,
				intentType,
				confidence: Math.max(0, Math.min(1, pickNumber(classification.confidence, 0.5))),
				isCompound: pickBoolean(classification.isCompound),
				...(Array.isArray(classification.subIntents)
					? {
						subIntents: classification.subIntents
							.map((item) => toRecord(item))
							.filter((item) =>
								VALID_DOMAINS.includes(item.domain as IntentDomain)
								&& VALID_INTENT_TYPES.includes(item.intentType as IntentType)
							)
							.map((item) => ({
								domain: item.domain as IntentDomain,
								intentType: item.intentType as IntentType,
							})),
					}
					: {}),
				complexity,
			},
			routing: {
				executionMode,
				requestRelation,
				...(routing.toolHints
					? {
						toolHints: {
							likelyServerIds: pickStringArray(toRecord(routing.toolHints).likelyServerIds),
							...(pickStringArray(toRecord(routing.toolHints).suggestedTools).length > 0
								? { suggestedTools: pickStringArray(toRecord(routing.toolHints).suggestedTools) }
								: {}),
							domain,
							...(VALID_INTENT_TYPES.includes(toRecord(routing.toolHints).intentType as IntentType)
								? { intentType: toRecord(routing.toolHints).intentType as IntentType }
								: {}),
							...(VALID_COMPLEXITIES.includes(toRecord(routing.toolHints).complexity as IntentComplexity)
								? { complexity: toRecord(routing.toolHints).complexity as IntentComplexity }
								: {}),
						},
					}
					: {}),
				contextPrep: {
					needsActiveFileContent: pickBoolean(contextPrep.needsActiveFileContent),
					needsSelectedText: pickBoolean(contextPrep.needsSelectedText),
					...(pickStringArray(contextPrep.needsFileRead).length > 0
						? { needsFileRead: pickStringArray(contextPrep.needsFileRead) }
						: {}),
					needsMemoryLoad: pickBoolean(contextPrep.needsMemoryLoad),
					needsPlanContext: pickBoolean(contextPrep.needsPlanContext),
				},
				constraints: {
					readOnly: pickBoolean(constraints.readOnly, executionMode === 'direct_response'),
					allowShell: pickBoolean(constraints.allowShell),
					allowScript: pickBoolean(constraints.allowScript),
					maxToolCalls: Math.max(
						0,
						Math.floor(pickNumber(constraints.maxToolCalls, executionMode === 'direct_response' ? 0 : 6))
					),
				},
				...(pickString(routing.promptAugmentation)
					? { promptAugmentation: pickString(routing.promptAugmentation) }
					: {}),
				safetyFlags: {
					isDestructive: pickBoolean(safetyFlags.isDestructive),
					affectsMultipleFiles: pickBoolean(safetyFlags.affectsMultipleFiles),
					requiresConfirmation: pickBoolean(safetyFlags.requiresConfirmation),
				},
				...(Object.keys(clarification).length > 0
					? {
						clarification: {
							reason: pickString(clarification.reason, 'More detail is required.'),
							questions: Array.isArray(clarification.questions)
								? clarification.questions
									.map((item) => toRecord(item))
									.filter((item) => pickString(item.question).length > 0)
									.map((item) => ({
										question: pickString(item.question),
										...(pickStringArray(item.options).length > 0
											? { options: pickStringArray(item.options) }
											: {}),
										defaultAssumption: pickString(item.defaultAssumption, 'Use the safest reasonable default.'),
									}))
								: [],
						},
					}
					: {}),
			},
		};
	}
}
