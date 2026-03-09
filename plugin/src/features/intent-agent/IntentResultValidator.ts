import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_VAULT_SERVER_ID,
} from 'src/builtin-mcp/constants';
import type {
	ExecutionMode,
	IntentComplexity,
	IntentDomain,
	IntentResult,
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

const VALID_EXECUTION_MODES: ExecutionMode[] = [
	'direct_response',
	'tool_assisted',
	'plan_then_execute',
	'clarify_first',
];

const VALID_COMPLEXITIES: IntentComplexity[] = [
	'simple',
	'moderate',
	'complex',
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

const toRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

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

const defaultServerIdsForDomain = (domain: IntentDomain): string[] => {
	switch (domain) {
		case 'vault_read':
		case 'vault_write':
			return [BUILTIN_VAULT_SERVER_ID];
		case 'vault_search':
			return [BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_VAULT_SERVER_ID];
		case 'knowledge_mgmt':
			return [BUILTIN_MEMORY_SERVER_ID];
		case 'reasoning':
			return [BUILTIN_SEQUENTIAL_THINKING_SERVER_ID];
		default:
			return [];
	}
};

export class IntentResultValidator {
	validate(raw: unknown, context: RequestContext): IntentResult {
		const root = toRecord(raw);
		const understanding = toRecord(root.understanding);
		const target = toRecord(understanding.target);
		const classification = toRecord(root.classification);
		const routing = toRecord(root.routing);
		const contextPrep = toRecord(routing.contextPrep);
		const constraints = toRecord(routing.constraints);
		const safetyFlags = toRecord(routing.safetyFlags);
		const clarification = toRecord(routing.clarification);

		const targetType = VALID_TARGET_TYPES.includes(target.type as TargetType)
			? (target.type as TargetType)
			: this.inferTargetType(context);
		const domain = VALID_DOMAINS.includes(classification.domain as IntentDomain)
			? (classification.domain as IntentDomain)
			: this.inferDomain(targetType, context);
		let executionMode = VALID_EXECUTION_MODES.includes(routing.executionMode as ExecutionMode)
			? (routing.executionMode as ExecutionMode)
			: this.inferExecutionMode(domain, targetType, context);
		const complexity = VALID_COMPLEXITIES.includes(classification.complexity as IntentComplexity)
			? (classification.complexity as IntentComplexity)
			: (executionMode === 'plan_then_execute' ? 'complex' : 'simple');
		const confidence = Math.max(0, Math.min(1, pickNumber(classification.confidence, 0.3)));
		const missingInfo = pickStringArray(understanding.missingInfo);

		const result: IntentResult = {
			understanding: {
				normalizedRequest: pickString(understanding.normalizedRequest, context.userMessage.trim()),
				target: {
					type: targetType,
					...(pickStringArray(target.paths).length > 0
						? { paths: pickStringArray(target.paths) }
						: this.defaultTargetPaths(targetType, context)),
					...(pickString(target.contentHint)
						? { contentHint: pickString(target.contentHint).slice(0, 50) }
						: context.selectedText
							? { contentHint: context.selectedText.trim().slice(0, 50) }
							: {}),
				},
				...(Object.keys(toRecord(understanding.resolvedReferences)).length > 0
					? { resolvedReferences: toRecord(understanding.resolvedReferences) as Record<string, string> }
					: {}),
				...(missingInfo.length > 0 ? { missingInfo } : {}),
			},
			classification: {
				domain,
				intentType: pickString(classification.intentType, domain === 'conversation' ? 'chitchat' : 'analyze_content') as IntentResult['classification']['intentType'],
				confidence,
				isCompound: pickBoolean(classification.isCompound),
				...(Array.isArray(classification.subIntents)
					? {
						subIntents: classification.subIntents
							.map((item) => toRecord(item))
							.filter((item) =>
								VALID_DOMAINS.includes(item.domain as IntentDomain)
								&& typeof item.intentType === 'string'
							)
							.map((item) => ({
								domain: item.domain as IntentDomain,
								intentType: item.intentType as IntentResult['classification']['intentType'],
							})),
					}
					: {}),
				complexity,
			},
			routing: {
				executionMode,
				...(routing.toolHints
					? {
						toolHints: {
							likelyServerIds:
								pickStringArray(toRecord(routing.toolHints).likelyServerIds).length > 0
									? pickStringArray(toRecord(routing.toolHints).likelyServerIds)
									: defaultServerIdsForDomain(domain),
							...(pickStringArray(toRecord(routing.toolHints).suggestedTools).length > 0
								? { suggestedTools: pickStringArray(toRecord(routing.toolHints).suggestedTools) }
								: {}),
							domain,
							intentType: this.asIntentType(toRecord(routing.toolHints).intentType),
							complexity,
						},
					}
					: {}),
				contextPrep: {
					needsActiveFileContent:
						pickBoolean(contextPrep.needsActiveFileContent)
						|| targetType === 'active_file',
					needsSelectedText:
						pickBoolean(contextPrep.needsSelectedText)
						|| targetType === 'selected_text',
					...(pickStringArray(contextPrep.needsFileRead).length > 0
						? { needsFileRead: pickStringArray(contextPrep.needsFileRead) }
						: {}),
					needsMemoryLoad: pickBoolean(contextPrep.needsMemoryLoad),
					needsPlanContext:
						pickBoolean(contextPrep.needsPlanContext)
						|| Boolean(context.livePlan),
				},
				constraints: {
					readOnly: pickBoolean(constraints.readOnly, executionMode === 'direct_response'),
					allowShell: pickBoolean(constraints.allowShell),
					allowScript: pickBoolean(constraints.allowScript),
					maxToolCalls: Math.max(
						0,
						Math.floor(
							pickNumber(
								constraints.maxToolCalls,
								executionMode === 'direct_response' ? 0 : 6
							)
						)
					),
				},
				...(pickString(routing.promptAugmentation)
					? { promptAugmentation: pickString(routing.promptAugmentation) }
					: {}),
				safetyFlags: {
					isDestructive: pickBoolean(safetyFlags.isDestructive),
					affectsMultipleFiles:
						pickBoolean(safetyFlags.affectsMultipleFiles)
						|| targetType === 'vault_wide'
						|| (resultLikePathsCount(target.paths) > 1),
					requiresConfirmation: pickBoolean(safetyFlags.requiresConfirmation),
				},
				...(Object.keys(clarification).length > 0
					? {
						clarification: {
							questions: Array.isArray(clarification.questions)
								? clarification.questions
									.map((item) => toRecord(item))
									.filter((item) => typeof item.question === 'string')
									.map((item) => ({
										question: pickString(item.question),
										...(pickStringArray(item.options).length > 0
											? { options: pickStringArray(item.options) }
											: {}),
										defaultAssumption: pickString(item.defaultAssumption, 'Use the safest default.'),
									}))
								: [],
							reason: pickString(clarification.reason, 'More detail is required.'),
						},
					}
					: {}),
			},
		};

		if (result.classification.isCompound && (result.classification.subIntents?.length ?? 0) === 0) {
			result.classification.subIntents = [
				{
					domain: result.classification.domain,
					intentType: result.classification.intentType,
				},
			];
		}

		if (
			result.classification.domain === 'conversation'
			&& result.classification.intentType !== 'continuation'
		) {
			executionMode = 'direct_response';
			result.routing.executionMode = executionMode;
		}

		if (result.routing.executionMode === 'plan_then_execute') {
			result.classification.complexity = 'complex';
		}

		if (result.routing.safetyFlags.isDestructive) {
			result.routing.constraints.readOnly = false;
		}

		if (result.routing.executionMode === 'direct_response') {
			result.routing.constraints.maxToolCalls = 0;
			delete result.routing.toolHints;
		}

		if (
			(result.routing.executionMode === 'tool_assisted'
				|| result.routing.executionMode === 'plan_then_execute')
			&& !result.routing.toolHints
		) {
			result.routing.toolHints = {
				likelyServerIds: defaultServerIdsForDomain(result.classification.domain),
				domain: result.classification.domain,
				intentType: result.classification.intentType,
				complexity: result.classification.complexity,
			};
		}

		if (result.routing.executionMode === 'clarify_first') {
			result.routing.constraints.maxToolCalls = 0;
			if (!result.routing.clarification || result.routing.clarification.questions.length === 0) {
				result.routing.clarification = this.buildClarification(result, context);
			}
		}

		if (result.classification.confidence < 0.5) {
			result.routing.executionMode = 'clarify_first';
			result.routing.constraints.maxToolCalls = 0;
			result.routing.clarification = this.buildClarification(result, context);
		}

		return result;
	}

	private inferTargetType(context: RequestContext): TargetType {
		if (context.selectedText) {
			return 'selected_text';
		}
		if (context.activeFilePath) {
			return 'active_file';
		}
		if ((context.selectedFiles?.length ?? 0) > 0 || (context.selectedFolders?.length ?? 0) > 0) {
			return 'specific_files';
		}
		return 'none';
	}

	private inferDomain(targetType: TargetType, context: RequestContext): IntentDomain {
		if (targetType === 'memory') {
			return 'knowledge_mgmt';
		}
		if (targetType === 'selected_text' || targetType === 'active_file' || targetType === 'specific_files') {
			return 'reasoning';
		}
		if (context.livePlan) {
			return 'vault_write';
		}
		return 'conversation';
	}

	private inferExecutionMode(
		domain: IntentDomain,
		targetType: TargetType,
		context: RequestContext
	): ExecutionMode {
		if (domain === 'conversation' && targetType === 'none') {
			return 'direct_response';
		}
		if (context.userMessage.trim().length <= 2) {
			return 'clarify_first';
		}
		return 'tool_assisted';
	}

	private defaultTargetPaths(
		targetType: TargetType,
		context: RequestContext
	): { paths?: string[] } {
		if (targetType === 'active_file' && context.activeFilePath) {
			return { paths: [context.activeFilePath] };
		}
		if (targetType === 'specific_files') {
			const paths = [
				...(context.selectedFiles ?? []),
				...(context.selectedFolders ?? []),
			];
			if (paths.length > 0) {
				return { paths };
			}
		}
		return {};
	}

	private asIntentType(value: unknown): IntentResult['classification']['intentType'] | undefined {
		return typeof value === 'string' ? (value as IntentResult['classification']['intentType']) : undefined;
	}

	private buildClarification(result: IntentResult, context: RequestContext): NonNullable<IntentResult['routing']['clarification']> {
		const targetLabel =
			result.understanding.target.paths?.[0]
			?? context.activeFilePath
			?? 'the target content';
		const missingInfo = result.understanding.missingInfo ?? [];
		return {
			questions: [
				{
					question:
						missingInfo[0]
						?? `What exactly should I do with ${targetLabel}?`,
					options: ['Explain', 'Summarize', 'Modify'],
					defaultAssumption: `Explain ${targetLabel}.`,
				},
			],
			reason:
				missingInfo[0]
				?? 'The request is underspecified and needs one more detail before execution.',
		};
	}
}

const resultLikePathsCount = (value: unknown): number =>
	Array.isArray(value)
		? value.filter((item) => typeof item === 'string' && item.trim().length > 0).length
		: 0;

