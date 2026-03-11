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
	IntentValidationOptions,
	MessageAction,
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
	validate(
		raw: unknown,
		context: RequestContext,
		options: IntentValidationOptions = {}
	): IntentResult {
		const root = toRecord(raw);
		const understanding = toRecord(root.understanding);
		const target = toRecord(understanding.target);
		const classification = toRecord(root.classification);
		const routing = toRecord(root.routing);
		const contextPrep = toRecord(routing.contextPrep);
		const constraints = toRecord(routing.constraints);
		const safetyFlags = toRecord(routing.safetyFlags);
		const clarification = toRecord(routing.clarification);
		const confidenceThreshold =
			typeof options.confidenceThreshold === 'number'
				? options.confidenceThreshold
				: 0.6;
		const analysis = context.messageAnalysis;

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
		const targetPaths = pickStringArray(target.paths);
		const fallbackTargetPaths = this.defaultTargetPaths(targetType, context).paths ?? [];
		const defaultSubIntents = this.defaultSubIntents(context);
		const resolvedReferences = this.mergeResolvedReferences(
			toRecord(understanding.resolvedReferences) as Record<string, string>,
			context
		);
		const missingInfo = this.inferMissingInfo(
			pickStringArray(understanding.missingInfo),
			context
		);
		const defaultLikelyServerIds = this.defaultLikelyServerIds(domain, targetType, context);
		const defaultPromptAugmentation = this.defaultPromptAugmentation(
			executionMode,
			domain,
			targetType,
			context
		);

		const result: IntentResult = {
			understanding: {
				normalizedRequest: pickString(understanding.normalizedRequest, context.userMessage.trim()),
				target: {
					type: targetType,
					...((targetPaths.length > 0 || fallbackTargetPaths.length > 0)
						? { paths: targetPaths.length > 0 ? targetPaths : fallbackTargetPaths }
						: {}),
					...(pickString(target.contentHint)
						? { contentHint: pickString(target.contentHint).slice(0, 50) }
						: context.selectedText
							? { contentHint: context.selectedText.trim().slice(0, 50) }
							: {}),
				},
				...(Object.keys(resolvedReferences).length > 0
					? { resolvedReferences }
					: {}),
				...(missingInfo.length > 0 ? { missingInfo } : {}),
			},
			classification: {
				domain,
				intentType: pickString(
					classification.intentType,
					this.defaultIntentType(domain, targetType, context)
				) as IntentResult['classification']['intentType'],
				confidence,
				isCompound: pickBoolean(classification.isCompound, analysis.isCompound),
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
					: defaultSubIntents
						? { subIntents: defaultSubIntents }
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
										: defaultLikelyServerIds,
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
						: (() => {
							const defaultNeedsFileRead = this.defaultNeedsFileRead(targetType, domain, context);
							return defaultNeedsFileRead ? { needsFileRead: defaultNeedsFileRead } : {};
						})()),
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
					: defaultPromptAugmentation
						? { promptAugmentation: defaultPromptAugmentation }
					: {}),
				safetyFlags: {
					isDestructive: pickBoolean(safetyFlags.isDestructive),
					affectsMultipleFiles:
						pickBoolean(safetyFlags.affectsMultipleFiles)
						|| targetType === 'vault_wide'
						|| this.affectsMultipleFiles(context, targetPaths.length > 0 ? targetPaths : fallbackTargetPaths),
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
				likelyServerIds: this.defaultLikelyServerIds(
					result.classification.domain,
					result.understanding.target.type,
					context
				),
				domain: result.classification.domain,
				intentType: result.classification.intentType,
				complexity: result.classification.complexity,
			};
		}

		if (result.routing.executionMode === 'clarify_first') {
			result.routing.constraints.maxToolCalls = 0;
		}

		if (this.shouldClarify(result, context, confidenceThreshold)) {
			result.routing.executionMode = 'clarify_first';
			result.routing.constraints.maxToolCalls = 0;
			result.routing.clarification = this.buildClarification(result, context);
		} else if (result.routing.executionMode === 'clarify_first') {
			result.routing.executionMode = this.inferExecutionMode(
				result.classification.domain,
				result.understanding.target.type,
				context
			);
		}

		if (
			result.routing.executionMode === 'tool_assisted'
			&& result.classification.confidence < confidenceThreshold
			&& context.messageAnalysis.hasClearAction
			&& context.messageAnalysis.hasUniqueResolvedTarget
		) {
			result.classification.confidence = confidenceThreshold;
		}

		if (
			(result.routing.executionMode === 'tool_assisted'
				|| result.routing.executionMode === 'plan_then_execute')
			&& result.routing.constraints.maxToolCalls === 0
		) {
			result.routing.constraints.maxToolCalls = Math.max(
				1,
				Math.floor(pickNumber(constraints.maxToolCalls, 6))
			);
		}

		if (
			(result.routing.executionMode === 'tool_assisted'
				|| result.routing.executionMode === 'plan_then_execute')
			&& !result.routing.toolHints
		) {
			result.routing.toolHints = {
				likelyServerIds: this.defaultLikelyServerIds(
					result.classification.domain,
					result.understanding.target.type,
					context
				),
				domain: result.classification.domain,
				intentType: result.classification.intentType,
				complexity: result.classification.complexity,
			};
		}

		if (
			(result.routing.executionMode === 'tool_assisted'
				|| result.routing.executionMode === 'plan_then_execute')
		) {
			const defaultSuggestedTools = this.defaultSuggestedTools(
				result.classification.domain,
				result.understanding.target.type,
				result.classification.intentType,
				context
			);
			if (defaultSuggestedTools && defaultSuggestedTools.length > 0) {
				result.routing.toolHints = result.routing.toolHints ?? {
					likelyServerIds: this.defaultLikelyServerIds(
						result.classification.domain,
						result.understanding.target.type,
						context
					),
					domain: result.classification.domain,
					intentType: result.classification.intentType,
					complexity: result.classification.complexity,
				};
				if (
					!result.routing.toolHints.suggestedTools
					|| result.routing.toolHints.suggestedTools.length === 0
				) {
					result.routing.toolHints.suggestedTools = defaultSuggestedTools;
				}
			}
		}

		if (
			(result.routing.executionMode === 'tool_assisted'
				|| result.routing.executionMode === 'plan_then_execute')
			&& !pickString(result.routing.promptAugmentation)
		) {
			const fallbackPromptAugmentation = this.defaultPromptAugmentation(
				result.routing.executionMode,
				result.classification.domain,
				result.understanding.target.type,
				context
			);
			if (fallbackPromptAugmentation) {
				result.routing.promptAugmentation = fallbackPromptAugmentation;
			}
		}

		return result;
	}

	private inferTargetType(context: RequestContext): TargetType {
		if (context.messageAnalysis.resolvedSpecialTarget === 'selected_text' && context.selectedText) {
			return 'selected_text';
		}
		if (context.messageAnalysis.resolvedSpecialTarget === 'active_file' && context.activeFilePath) {
			return 'active_file';
		}
		if (context.messageAnalysis.resolvedTargets.length > 0) {
			return 'specific_files';
		}
		if (
			context.messageAnalysis.primaryAction === 'search'
			|| this.requiresDiscoveryBeforeExecution(context)
		) {
			return 'vault_wide';
		}
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
		const action = context.messageAnalysis.primaryAction;
		if (targetType === 'memory') {
			return 'knowledge_mgmt';
		}
		if (action === 'remember') {
			return 'knowledge_mgmt';
		}
		if (
			action === 'search'
			|| (this.requiresDiscoveryBeforeExecution(context) && targetType !== 'selected_text')
		) {
			return 'vault_search';
		}
		if (action === 'modify' || action === 'generate') {
			return targetType === 'specific_files' ? 'vault_write' : 'generation';
		}
		if (action === 'read') {
			return targetType === 'vault_wide' ? 'vault_search' : 'vault_read';
		}
		if (
			action === 'summarize'
			|| action === 'analyze'
			|| action === 'compare'
			|| targetType === 'selected_text'
			|| targetType === 'active_file'
			|| targetType === 'specific_files'
		) {
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
		if (!context.messageAnalysis.hasClearAction && context.userMessage.trim().length <= 2) {
			return 'clarify_first';
		}
		if (context.messageAnalysis.isCompound && domain === 'vault_write') {
			return 'plan_then_execute';
		}
		return 'tool_assisted';
	}

	private defaultTargetPaths(
		targetType: TargetType,
		context: RequestContext
	): { paths?: string[] } {
		if (context.messageAnalysis.resolvedTargets.length > 0) {
			return {
				paths: context.messageAnalysis.resolvedTargets.map((target) => target.path),
			};
		}
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

	private defaultIntentType(
		domain: IntentDomain,
		targetType: TargetType,
		context: RequestContext
	): IntentResult['classification']['intentType'] {
		const action = context.messageAnalysis.primaryAction;
		if (domain === 'vault_search' && this.requiresDiscoveryBeforeExecution(context)) {
			return this.hasNamedReference(context) ? 'find_by_name' : 'find_by_content';
		}
		if (action === 'continue') {
			return 'continuation';
		}
		if (action === 'remember') {
			return 'memory_store';
		}
		if (action === 'compare') {
			return 'compare';
		}
		if (action === 'summarize' || action === 'analyze') {
			return 'analyze_content';
		}
		if (action === 'modify') {
			return targetType === 'selected_text' ? 'transform_text' : 'modify_file';
		}
		if (action === 'generate') {
			return domain === 'reasoning' ? 'generate_plan' : 'generate_text';
		}
		if (action === 'read') {
			return this.hasFolderTarget(context) ? 'read_directory' : 'read_file';
		}
		if (action === 'search') {
			if (/#[^\s]+|标签|tag/i.test(context.userMessage)) {
				return 'find_by_tag';
			}
			return this.hasNamedReference(context) ? 'find_by_name' : 'find_by_content';
		}
		return domain === 'conversation' ? 'chitchat' : 'analyze_content';
	}

	private defaultSubIntents(
		context: RequestContext
	): IntentResult['classification']['subIntents'] | undefined {
		if (!context.messageAnalysis.isCompound) {
			return undefined;
		}
		const subIntents = context.messageAnalysis.normalizedActions.map((action) => ({
			domain: this.mapActionToDomain(action, context) as IntentDomain,
			intentType: this.mapActionToIntentType(action, context),
		}));
		return subIntents.length > 0 ? subIntents : undefined;
	}

	private mapActionToDomain(action: MessageAction, context: RequestContext): IntentDomain {
		if (action === 'remember') {
			return 'knowledge_mgmt';
		}
		if (action === 'search') {
			return 'vault_search';
		}
		if (action === 'modify' || action === 'generate') {
			return context.messageAnalysis.resolvedTargets.length > 0 ? 'vault_write' : 'generation';
		}
		if (action === 'read') {
			return this.requiresDiscoveryBeforeExecution(context) ? 'vault_search' : 'vault_read';
		}
		if (action === 'continue') {
			return 'vault_write';
		}
		return 'reasoning';
	}

	private mapActionToIntentType(
		action: MessageAction,
		context: RequestContext
	): IntentResult['classification']['intentType'] {
		if (action === 'continue') {
			return 'continuation';
		}
		if (action === 'remember') {
			return 'memory_store';
		}
		if (action === 'compare') {
			return 'compare';
		}
		if (action === 'summarize' || action === 'analyze') {
			return 'analyze_content';
		}
		if (action === 'modify') {
			return context.messageAnalysis.resolvedSpecialTarget === 'selected_text'
				? 'transform_text'
				: 'modify_file';
		}
		if (action === 'generate') {
			return 'generate_text';
		}
		if (action === 'read') {
			return this.hasFolderTarget(context) ? 'read_directory' : 'read_file';
		}
		if (/#[^\s]+|标签|tag/i.test(context.userMessage)) {
			return 'find_by_tag';
		}
		return this.hasNamedReference(context) ? 'find_by_name' : 'find_by_content';
	}

	private inferMissingInfo(existing: string[], context: RequestContext): string[] {
		if (existing.length > 0) {
			return existing;
		}
		const missing: string[] = [];
		if (!context.messageAnalysis.hasClearAction) {
			missing.push('请说明你希望我执行的动作。');
		}
		if (
			context.messageAnalysis.references.length > 0
			&& !context.messageAnalysis.hasUniqueResolvedTarget
			&& !this.isSearchOnly(context)
		) {
			missing.push('请明确具体的目标文件或文件夹。');
		}
		return missing;
	}

	private mergeResolvedReferences(
		existing: Record<string, string>,
		context: RequestContext
	): Record<string, string> {
		const merged = { ...existing };
		for (const resolution of context.messageAnalysis.pathResolutions) {
			if (resolution.status === 'unique' && resolution.candidates[0]) {
				merged[resolution.referenceRaw] = resolution.candidates[0];
			}
		}
		return merged;
	}

	private defaultNeedsFileRead(
		targetType: TargetType,
		domain: IntentDomain,
		context: RequestContext
	): string[] | undefined {
		if (
			targetType === 'specific_files'
			&& (domain === 'reasoning' || domain === 'vault_read' || domain === 'generation' || domain === 'vault_write')
		) {
			return context.messageAnalysis.resolvedTargets.map((target) => target.path);
		}
		return undefined;
	}

	private defaultLikelyServerIds(
		domain: IntentDomain,
		targetType: TargetType,
		context: RequestContext
	): string[] {
		const serverIds = new Set<string>();
		const needsFileRead = this.defaultNeedsFileRead(targetType, domain, context)?.length ?? 0;
		const needsDiscovery = this.requiresDiscoveryBeforeExecution(context);
		const analysis = context.messageAnalysis;

		switch (domain) {
			case 'vault_read':
			case 'vault_write':
				serverIds.add(BUILTIN_VAULT_SERVER_ID);
				if (needsDiscovery) {
					serverIds.add(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID);
				}
				break;
			case 'vault_search':
				serverIds.add(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID);
				serverIds.add(BUILTIN_VAULT_SERVER_ID);
				break;
			case 'knowledge_mgmt':
				serverIds.add(BUILTIN_MEMORY_SERVER_ID);
				break;
			case 'reasoning':
				if (
					targetType === 'active_file'
					|| targetType === 'specific_files'
					|| needsFileRead > 0
					|| (
						(needsDiscovery || analysis.normalizedActions.includes('search'))
						&& (
							analysis.normalizedActions.includes('compare')
							|| analysis.normalizedActions.includes('analyze')
							|| analysis.normalizedActions.includes('summarize')
							|| analysis.normalizedActions.includes('read')
						)
					)
				) {
					serverIds.add(BUILTIN_VAULT_SERVER_ID);
				}
				if (
					needsDiscovery
					|| analysis.normalizedActions.includes('search')
					|| analysis.preparatoryActions.includes('search')
				) {
					serverIds.add(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID);
				}
				if (
					analysis.isCompound
					|| analysis.normalizedActions.includes('compare')
					|| analysis.normalizedActions.includes('analyze')
					|| analysis.normalizedActions.includes('summarize')
				) {
					serverIds.add(BUILTIN_SEQUENTIAL_THINKING_SERVER_ID);
				}
				break;
			default:
				break;
		}

		if (serverIds.size === 0) {
			for (const serverId of defaultServerIdsForDomain(domain)) {
				serverIds.add(serverId);
			}
		}

		return Array.from(serverIds);
	}

	private defaultSuggestedTools(
		domain: IntentDomain,
		targetType: TargetType,
		intentType: IntentResult['classification']['intentType'],
		context: RequestContext
	): string[] | undefined {
		const tools: string[] = [];
		const addTool = (toolName: string) => {
			if (!tools.includes(toolName)) {
				tools.push(toolName);
			}
		};
		const analysis = context.messageAnalysis;
		const hasSearchPhase =
			domain === 'vault_search'
			|| analysis.normalizedActions.includes('search')
			|| analysis.preparatoryActions.includes('search');
		const hasReasoningPhase =
			domain === 'reasoning'
			|| analysis.normalizedActions.includes('summarize')
			|| analysis.normalizedActions.includes('analyze')
			|| analysis.normalizedActions.includes('compare')
			|| analysis.normalizedActions.includes('read');
		const hasFolderTarget = this.hasFolderTarget(context);
		const hasFileTarget =
			targetType === 'active_file'
			|| context.messageAnalysis.resolvedTargets.some((target) => target.kind === 'file');

		if (intentType === 'find_by_tag' || /#[^\s]+|标签|tag/i.test(context.userMessage)) {
			addTool('search_tags');
		} else if (hasSearchPhase) {
			if (
				context.messageAnalysis.references.some((reference) =>
					reference.type === 'natural_folder' || reference.type === 'parent_folder'
				)
			) {
				addTool('search_folder');
			} else if (this.hasNamedReference(context)) {
				addTool('search_files');
			} else {
				addTool('quick_search');
			}
		}

		if (hasFolderTarget) {
			addTool('list_directory');
		}
		if (hasFileTarget || hasFolderTarget || hasReasoningPhase) {
			addTool('read_file');
		}
		if (
			analysis.isCompound
			|| analysis.normalizedActions.includes('compare')
		) {
			addTool('sequentialthinking');
		}

		return tools.length > 0 ? tools.slice(0, 4) : undefined;
	}

	private affectsMultipleFiles(context: RequestContext, paths: string[]): boolean {
		if (paths.length > 1) {
			return true;
		}
		return context.messageAnalysis.resolvedTargets.some((target) => target.kind === 'folder');
	}

	private asIntentType(value: unknown): IntentResult['classification']['intentType'] | undefined {
		return typeof value === 'string' ? (value as IntentResult['classification']['intentType']) : undefined;
	}

	private defaultPromptAugmentation(
		executionMode: ExecutionMode,
		domain: IntentDomain,
		targetType: TargetType,
		context: RequestContext
	): string | undefined {
		if (
			executionMode !== 'tool_assisted'
			&& executionMode !== 'plan_then_execute'
		) {
			return undefined;
		}
		if (
			domain === 'conversation'
			|| targetType === 'selected_text'
		) {
			return undefined;
		}
		if (
			targetType === 'active_file'
			|| targetType === 'specific_files'
			|| domain === 'vault_search'
			|| this.requiresDiscoveryBeforeExecution(context)
		) {
			const resolvedTargets = context.messageAnalysis.resolvedTargets
				.map((target) => target.path)
				.slice(0, 3);
			const resolvedTargetHint =
				resolvedTargets.length > 0
					? ` 已解析目标路径：${resolvedTargets.join('、')}。`
					: '';
			return `当请求涉及 Obsidian 库内容时，不要声称你无法访问文件系统。应优先调用可用工具（例如 execute_task 或 Vault/Search 工具）读取、搜索、列目录或比较相关内容，然后再给出答案。${resolvedTargetHint}`;
		}
		return undefined;
	}

	private buildClarification(result: IntentResult, context: RequestContext): NonNullable<IntentResult['routing']['clarification']> {
		const ambiguousResolution = context.messageAnalysis.pathResolutions.find(
			(resolution) => resolution.status === 'ambiguous'
		);
		if (ambiguousResolution) {
			const options = ambiguousResolution.candidates.slice(0, 3);
			return {
				questions: [
					{
						question: `我找到了多个可能的目标，你指的是哪一个？`,
						...(options.length > 0 ? { options } : {}),
						defaultAssumption: options[0] ?? '使用最接近当前上下文的候选路径。',
					},
				],
				reason: '目标路径有多个候选，需要你确认具体对象。',
			};
		}

		if (context.messageAnalysis.ambiguityReasons.includes('time_alias_unresolved')) {
			const todayCandidates = context.messageAnalysis.pathResolutions.find(
				(resolution) => resolution.referenceType === 'time_alias'
			)?.candidates ?? [];
			return {
				questions: [
					{
						question: '“今天的日记”没有唯一命中。你要指定日期，还是从候选笔记里选择一个？',
						...(todayCandidates.length > 0
							? { options: todayCandidates.slice(0, 3) }
							: { options: ['指定日期', '改成具体笔记名'] }),
						defaultAssumption: '请先指定日期。',
					},
				],
				reason: '时间别名没有解析到唯一笔记。',
			};
		}

		if (!context.messageAnalysis.hasClearAction) {
			const targetLabel =
				result.understanding.target.paths?.[0]
				?? context.activeFilePath
				?? '这份内容';
			return {
				questions: [
					{
						question: `你希望我对${targetLabel}做什么？`,
						options: ['总结', '分析', '改写'],
						defaultAssumption: `总结${targetLabel}。`,
					},
				],
				reason: '我还缺少明确的操作动作。',
			};
		}

		const unresolvedReference = context.messageAnalysis.pathResolutions.find(
			(resolution) => resolution.status === 'missing'
		);
		if (unresolvedReference) {
			return {
				questions: [
					{
						question: `我还没有定位到“${unresolvedReference.referenceRaw}”。你能提供更具体的路径或文件名吗？`,
						defaultAssumption: '请补充更具体的路径。',
					},
				],
				reason: '目标引用还没有解析到唯一对象。',
			};
		}

		const targetLabel =
			result.understanding.target.paths?.[0]
			?? context.activeFilePath
			?? '这份内容';
		return {
			questions: [
				{
					question: `你希望我对${targetLabel}做什么？`,
					options: ['总结', '分析', '改写'],
					defaultAssumption: `总结${targetLabel}。`,
				},
			],
			reason: '这个请求还缺少一个关键细节。',
		};
	}

	private shouldClarify(
		result: IntentResult,
		context: RequestContext,
		confidenceThreshold: number
	): boolean {
		const analysis = context.messageAnalysis;
		if (!analysis.hasClearAction) {
			return true;
		}
		if (analysis.targetStatus === 'ambiguous') {
			return true;
		}
		if (
			analysis.references.length > 0
			&& !analysis.hasUniqueResolvedTarget
			&& !this.isSearchOnly(context)
		) {
			return true;
		}
		if (
			result.routing.safetyFlags.isDestructive
			&& !analysis.hasUniqueResolvedTarget
		) {
			return true;
		}
		if (
			result.classification.confidence < confidenceThreshold
			&& (!analysis.hasClearAction || analysis.targetStatus === 'ambiguous')
		) {
			return true;
		}
		if (
			result.routing.executionMode === 'clarify_first'
			&& analysis.hasClearAction
			&& (analysis.hasUniqueResolvedTarget || this.isSearchOnly(context))
		) {
			return false;
		}
		return result.routing.executionMode === 'clarify_first'
			&& (!analysis.hasUniqueResolvedTarget && !this.isSearchOnly(context));
	}

	private isSearchOnly(context: RequestContext): boolean {
		const analysis = context.messageAnalysis;
		return (
			analysis.primaryAction === 'search'
			|| this.requiresDiscoveryBeforeExecution(context)
		);
	}

	private requiresDiscoveryBeforeExecution(context: RequestContext): boolean {
		const analysis = context.messageAnalysis;
		return (
			analysis.primaryAction !== 'search'
			&& analysis.preferredTarget === 'folder'
			&& analysis.resolvedTargets.some((target) => target.kind === 'folder')
			&& /里|中的?|下的/.test(context.userMessage)
			&& !analysis.references.some((reference) =>
				reference.type === 'wiki_link'
				|| reference.type === 'explicit_path'
				|| reference.type === 'natural_file'
			)
		);
	}

	private hasFolderTarget(context: RequestContext): boolean {
		return context.messageAnalysis.resolvedTargets.some((target) => target.kind === 'folder');
	}

	private hasNamedReference(context: RequestContext): boolean {
		return context.messageAnalysis.references.some((reference) =>
			reference.type === 'natural_file'
			|| reference.type === 'natural_folder'
			|| reference.type === 'explicit_path'
			|| reference.type === 'wiki_link'
		);
	}
}
