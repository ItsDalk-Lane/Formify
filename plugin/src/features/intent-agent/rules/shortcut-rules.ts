import { TriggerSourceRules, type IntentRuleCandidate } from './trigger-source-rules';
import type {
	IntentDomain,
	IntentResult,
	IntentType,
	MessageAction,
	RequestContext,
} from '../types';

const GREETING_PATTERN =
	/^(你好|hi|hello|hey|嗨|哈喽|早上好|晚上好|在吗|你是谁|你能做什么)[\s?？!！。.]*$/i;
const CONTINUE_PATTERN = /^(继续|下一步|next|continue|接着|go on)[\s?？!！。.]*$/i;
const MEMORY_STORE_PATTERN = /(记住|remember|别忘了|记录一下|帮我记|don't forget)/i;

const actionToIntentType = (
	action: MessageAction | undefined,
	context: RequestContext,
	targetType: IntentResult['understanding']['target']['type']
): IntentType => {
	if (action === 'compare') {
		return 'compare';
	}
	if (action === 'modify') {
		return targetType === 'selected_text' ? 'transform_text' : 'modify_file';
	}
	if (action === 'generate') {
		return 'generate_text';
	}
	if (action === 'read') {
		return context.messageAnalysis.resolvedTargets.some((target) => target.kind === 'folder')
			? 'read_directory'
			: 'read_file';
	}
	if (action === 'search') {
		if (/#[^\s]+|标签|tag/i.test(context.userMessage)) {
			return 'find_by_tag';
		}
		return context.messageAnalysis.references.length > 0 ? 'find_by_name' : 'find_by_content';
	}
	return 'analyze_content';
};

const actionToDomain = (
	action: MessageAction | undefined,
	context: RequestContext,
	targetType: IntentResult['understanding']['target']['type']
): IntentDomain => {
	if (action === 'remember') {
		return 'knowledge_mgmt';
	}
	if (action === 'search') {
		return 'vault_search';
	}
	if (action === 'modify' || action === 'generate') {
		return targetType === 'specific_files' ? 'vault_write' : 'generation';
	}
	if (action === 'read') {
		return requiresDiscoveryBeforeExecution(context) ? 'vault_search' : 'vault_read';
	}
	return 'reasoning';
};

const defaultToolConstraints = (
	domain: IntentDomain,
	targetType: IntentResult['understanding']['target']['type']
): IntentResult['routing']['constraints'] => ({
	readOnly: domain !== 'vault_write',
	allowShell: false,
	allowScript: false,
	maxToolCalls: targetType === 'selected_text' ? 3 : 6,
});

const buildToolAssistedCandidate = (
	context: RequestContext,
	score: number,
	target: IntentResult['understanding']['target']
): IntentRuleCandidate => {
	const domain = actionToDomain(context.messageAnalysis.primaryAction, context, target.type);
	const intentType = actionToIntentType(context.messageAnalysis.primaryAction, context, target.type);
	const affectsMultipleFiles =
		target.type === 'vault_wide'
		|| target.paths?.length !== 1
		|| context.messageAnalysis.resolvedTargets.some((candidate) => candidate.kind === 'folder');

	return {
		score,
		result: {
			understanding: {
				normalizedRequest: context.userMessage.trim(),
				target,
				...(buildResolvedReferences(context)),
			},
			classification: {
				domain,
				intentType,
				confidence: Math.min(0.99, score / 100),
				isCompound: context.messageAnalysis.isCompound,
				subIntents: buildSubIntents(context),
				complexity: context.messageAnalysis.isCompound ? 'moderate' : 'simple',
			},
			routing: {
				executionMode: 'tool_assisted',
				toolHints: {
					likelyServerIds: [],
					domain,
					intentType,
					complexity: context.messageAnalysis.isCompound ? 'moderate' : 'simple',
				},
				contextPrep: {
					needsActiveFileContent: target.type === 'active_file',
					needsSelectedText: target.type === 'selected_text',
					...(target.paths?.length ? { needsFileRead: target.paths } : {}),
					needsMemoryLoad: false,
					needsPlanContext: false,
				},
				constraints: defaultToolConstraints(domain, target.type),
				safetyFlags: {
					isDestructive: false,
					affectsMultipleFiles,
					requiresConfirmation: false,
				},
			},
		},
	};
};

const buildClarificationCandidate = (
	context: RequestContext,
	score: number
): IntentRuleCandidate => {
	const ambiguousResolution = context.messageAnalysis.pathResolutions.find(
		(resolution) => resolution.status === 'ambiguous'
	);
	const unresolvedReference = context.messageAnalysis.pathResolutions.find(
		(resolution) => resolution.status === 'missing'
	);
	const clarification =
		ambiguousResolution
			? {
				questions: [
					{
						question: '我找到了多个可能的目标，你指的是哪一个？',
						options: ambiguousResolution.candidates.slice(0, 3),
						defaultAssumption: ambiguousResolution.candidates[0] ?? '使用最接近当前上下文的候选路径。',
					},
				],
				reason: '目标路径存在多个候选。',
			}
			: !context.messageAnalysis.hasClearAction
				? {
					questions: [
						{
							question: '你希望我执行什么操作？',
							options: ['总结', '分析', '改写'],
							defaultAssumption: '总结目标内容。',
						},
					],
					reason: '动作还不明确。',
				}
				: {
					questions: [
						{
							question: `我还没有定位到“${unresolvedReference?.referenceRaw ?? '目标内容'}”。你能提供更具体的路径或名称吗？`,
							defaultAssumption: '请补充更具体的路径。',
						},
					],
					reason: '目标还没有解析到唯一对象。',
				};

	return {
		score,
		result: {
			understanding: {
				normalizedRequest: context.userMessage.trim(),
				target: {
					type: context.messageAnalysis.resolvedSpecialTarget === 'selected_text'
						? 'selected_text'
						: context.messageAnalysis.resolvedSpecialTarget === 'active_file'
							? 'active_file'
							: context.messageAnalysis.resolvedTargets.length > 0
								? 'specific_files'
								: 'vault_wide',
					...(context.messageAnalysis.resolvedTargets.length > 0
						? { paths: context.messageAnalysis.resolvedTargets.map((target) => target.path) }
						: {}),
				},
				missingInfo: [clarification.reason],
				...(buildResolvedReferences(context)),
			},
			classification: {
				domain: 'conversation',
				intentType: 'clarification',
				confidence: Math.min(0.95, score / 100),
				isCompound: false,
				complexity: 'simple',
			},
			routing: {
				executionMode: 'clarify_first',
				contextPrep: {
					needsActiveFileContent: false,
					needsSelectedText: context.messageAnalysis.resolvedSpecialTarget === 'selected_text',
					needsMemoryLoad: false,
					needsPlanContext: false,
				},
				constraints: {
					readOnly: true,
					allowShell: false,
					allowScript: false,
					maxToolCalls: 0,
				},
				safetyFlags: {
					isDestructive: false,
					affectsMultipleFiles: false,
					requiresConfirmation: false,
				},
				clarification,
			},
		},
	};
};

const buildResolvedReferences = (context: RequestContext): Partial<IntentResult['understanding']> => {
	const resolvedReferences = context.messageAnalysis.pathResolutions
		.filter((resolution) => resolution.status === 'unique' && resolution.candidates[0])
		.reduce<Record<string, string>>((acc, resolution) => {
			acc[resolution.referenceRaw] = resolution.candidates[0];
			return acc;
		}, {});
	return Object.keys(resolvedReferences).length > 0 ? { resolvedReferences } : {};
};

const buildSubIntents = (
	context: RequestContext
): IntentResult['classification']['subIntents'] | undefined => {
	if (!context.messageAnalysis.isCompound) {
		return undefined;
	}
	const subIntents = context.messageAnalysis.normalizedActions.map((action) => ({
		domain: actionToDomain(action, context, 'vault_wide'),
		intentType: actionToIntentType(action, context, 'vault_wide'),
	}));
	return subIntents.length > 0 ? subIntents : undefined;
};

const requiresDiscoveryBeforeExecution = (context: RequestContext): boolean =>
	context.messageAnalysis.primaryAction !== 'search'
	&& context.messageAnalysis.preferredTarget === 'folder'
	&& context.messageAnalysis.resolvedTargets.some((target) => target.kind === 'folder')
	&& /里|中的?|下的/.test(context.userMessage)
	&& !context.messageAnalysis.references.some((reference) =>
		reference.type === 'wiki_link'
		|| reference.type === 'explicit_path'
		|| reference.type === 'natural_file'
	);

export class ShortcutRules {
	constructor(
		private readonly triggerSourceRules = new TriggerSourceRules()
	) {}

	evaluate(context: RequestContext): IntentResult | null {
		const candidates = [
			...this.triggerSourceRules.getCandidates(context),
			...this.buildCandidates(context),
		].sort((left, right) => right.score - left.score);
		if (candidates.length === 0) {
			return null;
		}
		const [best, secondBest] = candidates;
		if (!best || best.score < 70) {
			return null;
		}
		if (secondBest && best.score - secondBest.score <= 4 && best.result.routing.executionMode !== secondBest.result.routing.executionMode) {
			return null;
		}
		return best.result;
	}

	private buildCandidates(context: RequestContext): IntentRuleCandidate[] {
		const candidates: IntentRuleCandidate[] = [];
		const analysis = context.messageAnalysis;

		if (
			context.hasImages
			&& !(context.currentModelCapabilities ?? []).includes('Image Vision')
		) {
			candidates.push({
				score: 99,
				result: {
					understanding: {
						normalizedRequest: 'The user attached images, but the current model cannot inspect them.',
						target: {
							type: 'external',
						},
						missingInfo: ['需要切换到支持视觉的模型，或忽略图片继续。'],
					},
					classification: {
						domain: 'conversation',
						intentType: 'clarification',
						confidence: 0.98,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'clarify_first',
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 0,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
						clarification: {
							questions: [
								{
									question: '当前模型无法查看图片。你要忽略图片继续，还是切换到支持视觉的模型？',
									options: ['忽略图片继续', '切换视觉模型'],
									defaultAssumption: '忽略图片继续。',
								},
							],
							reason: '图片输入需要视觉能力。',
						},
					},
				},
			});
		}

		if (GREETING_PATTERN.test(context.userMessage.trim())) {
			candidates.push({
				score: 98,
				result: {
					understanding: {
						normalizedRequest: 'The user is greeting or asking a general chat question.',
						target: {
							type: 'none',
						},
					},
					classification: {
						domain: 'conversation',
						intentType: 'chitchat',
						confidence: 0.99,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'direct_response',
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 0,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
					},
				},
			});
		}

		if (
			context.livePlan?.nextTodoTask
			&& CONTINUE_PATTERN.test(context.userMessage.trim())
		) {
			candidates.push({
				score: 96,
				result: {
					understanding: {
						normalizedRequest: `Continue the active plan "${context.livePlan.title}" with the next task "${context.livePlan.nextTodoTask}".`,
						target: {
							type: 'vault_wide',
						},
						resolvedReferences: {
							继续: `Continue plan task "${context.livePlan.nextTodoTask}"`,
						},
					},
					classification: {
						domain: 'vault_write',
						intentType: 'continuation',
						confidence: 0.95,
						isCompound: false,
						complexity: 'moderate',
					},
					routing: {
						executionMode: 'tool_assisted',
						toolHints: {
							likelyServerIds: [],
							domain: 'vault_write',
							intentType: 'continuation',
							complexity: 'moderate',
						},
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: true,
						},
						constraints: {
							readOnly: false,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 10,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: true,
							requiresConfirmation: false,
						},
					},
				},
			});
		}

		if (MEMORY_STORE_PATTERN.test(context.userMessage) || analysis.primaryAction === 'remember') {
			candidates.push({
				score: 90,
				result: {
					understanding: {
						normalizedRequest: `Store the user's stated preference or memory: ${context.userMessage.trim()}`,
						target: {
							type: 'memory',
						},
					},
					classification: {
						domain: 'knowledge_mgmt',
						intentType: 'memory_store',
						confidence: 0.9,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'tool_assisted',
						toolHints: {
							likelyServerIds: [],
							suggestedTools: ['create_entities', 'add_observations'],
							domain: 'knowledge_mgmt',
							intentType: 'memory_store',
							complexity: 'simple',
						},
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: true,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: false,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 5,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
					},
				},
			});
		}

		if (
			analysis.hasClearAction
			&& analysis.targetStatus === 'ambiguous'
		) {
			candidates.push(buildClarificationCandidate(context, 88));
		}

		if (
			analysis.hasClearAction
			&& analysis.references.length > 0
			&& !analysis.hasUniqueResolvedTarget
			&& !this.isSearchStyleRequest(context)
		) {
			candidates.push(buildClarificationCandidate(context, 80));
		}

		if (
			analysis.hasClearAction
			&& analysis.hasUniqueResolvedTarget
			&& !this.isSearchStyleRequest(context)
		) {
			const targetType =
				analysis.resolvedSpecialTarget === 'selected_text'
					? 'selected_text'
					: analysis.resolvedSpecialTarget === 'active_file'
						? 'active_file'
						: 'specific_files';
			candidates.push(
				buildToolAssistedCandidate(context, 87, {
					type: targetType,
					...(analysis.resolvedTargets.length > 0
						? { paths: analysis.resolvedTargets.map((target) => target.path) }
						: {}),
					...(analysis.resolvedSpecialTarget === 'selected_text' && context.selectedText
						? { contentHint: context.selectedText.trim().slice(0, 50) }
						: {}),
				})
			);
		}

		if (this.isSearchStyleRequest(context)) {
			const discoveryRequired = requiresDiscoveryBeforeExecution(context);
			const domain =
				discoveryRequired
					? 'vault_search'
					: analysis.primaryAction && analysis.primaryAction !== 'search'
					? actionToDomain(analysis.primaryAction, context, 'vault_wide')
					: 'vault_search';
			const intentType =
				discoveryRequired
					? actionToIntentType('search', context, 'vault_wide')
					: analysis.primaryAction && analysis.primaryAction !== 'search'
					? actionToIntentType(analysis.primaryAction, context, 'vault_wide')
					: actionToIntentType('search', context, 'vault_wide');
			candidates.push({
				score: 84,
				result: {
					understanding: {
						normalizedRequest: context.userMessage.trim(),
						target: {
							type: 'vault_wide',
						},
						...(buildResolvedReferences(context)),
					},
					classification: {
						domain,
						intentType,
						confidence: 0.84,
						isCompound: analysis.isCompound,
						subIntents: buildSubIntents(context),
						complexity: analysis.isCompound ? 'moderate' : 'simple',
					},
					routing: {
						executionMode: 'tool_assisted',
						toolHints: {
							likelyServerIds: [],
							domain,
							intentType,
							complexity: analysis.isCompound ? 'moderate' : 'simple',
						},
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 6,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: true,
							requiresConfirmation: false,
						},
					},
				},
			});
		}

		return candidates;
	}

	private isSearchStyleRequest(context: RequestContext): boolean {
		return (
			context.messageAnalysis.primaryAction === 'search'
			|| requiresDiscoveryBeforeExecution(context)
		);
	}
}
