import type {
	IntentDomain,
	IntentResult,
	IntentType,
	MessageAction,
	RequestContext,
} from '../types';

export interface IntentRuleCandidate {
	score: number;
	result: IntentResult;
}

const contentHintFromSelectedText = (selectedText: string | undefined): string | undefined => {
	if (!selectedText) {
		return undefined;
	}
	return selectedText.trim().slice(0, 50) || undefined;
};

const actionToDomain = (
	action: MessageAction | undefined,
	targetType: IntentResult['understanding']['target']['type']
): IntentDomain => {
	if (action === 'modify' || action === 'generate') {
		return targetType === 'active_file' ? 'vault_write' : 'generation';
	}
	if (action === 'read') {
		return 'vault_read';
	}
	return 'reasoning';
};

const actionToIntentType = (
	action: MessageAction | undefined,
	targetType: IntentResult['understanding']['target']['type']
): IntentType => {
	if (action === 'modify') {
		return targetType === 'selected_text' ? 'transform_text' : 'modify_file';
	}
	if (action === 'generate') {
		return 'generate_text';
	}
	if (action === 'read') {
		return targetType === 'selected_text' ? 'read_file' : 'read_file';
	}
	if (action === 'compare') {
		return 'compare';
	}
	return 'analyze_content';
};

const buildToolAssistedCandidate = (
	context: RequestContext,
	score: number,
	target: IntentResult['understanding']['target'],
	targetType: IntentResult['understanding']['target']['type']
): IntentRuleCandidate => {
	const domain = actionToDomain(context.messageAnalysis.primaryAction, targetType);
	return {
		score,
		result: {
			understanding: {
				normalizedRequest: context.userMessage.trim(),
				target,
			},
			classification: {
				domain,
				intentType: actionToIntentType(context.messageAnalysis.primaryAction, targetType),
				confidence: Math.min(0.99, score / 100),
				isCompound: context.messageAnalysis.isCompound,
				complexity: context.messageAnalysis.isCompound ? 'moderate' : 'simple',
			},
			routing: {
				executionMode: 'tool_assisted',
				toolHints: {
					likelyServerIds: [],
					domain,
					intentType: actionToIntentType(context.messageAnalysis.primaryAction, targetType),
					complexity: context.messageAnalysis.isCompound ? 'moderate' : 'simple',
				},
				contextPrep: {
					needsActiveFileContent: targetType === 'active_file',
					needsSelectedText: targetType === 'selected_text',
					needsMemoryLoad: false,
					needsPlanContext: false,
				},
				constraints: {
					readOnly: domain !== 'vault_write',
					allowShell: false,
					allowScript: false,
					maxToolCalls: targetType === 'selected_text' ? 3 : 5,
				},
				...(target.paths?.length ? { promptAugmentation: `Prioritize the resolved target paths: ${target.paths.join(', ')}` } : {}),
				safetyFlags: {
					isDestructive: false,
					affectsMultipleFiles: false,
					requiresConfirmation: false,
				},
			},
		},
	};
};

export class TriggerSourceRules {
	getCandidates(context: RequestContext): IntentRuleCandidate[] {
		const candidates: IntentRuleCandidate[] = [];
		const analysis = context.messageAnalysis;

		if (
			context.selectedText
			&& (context.triggerSource === 'selection_toolbar' || analysis.resolvedSpecialTarget === 'selected_text')
		) {
			if (analysis.hasClearAction) {
				candidates.push(
					buildToolAssistedCandidate(
						context,
						context.triggerSource === 'selection_toolbar' ? 94 : 86,
						{
							type: 'selected_text',
							contentHint: contentHintFromSelectedText(context.selectedText),
						},
						'selected_text'
					)
				);
			} else if (context.triggerSource === 'selection_toolbar') {
				candidates.push({
					score: 84,
					result: {
						understanding: {
							normalizedRequest: 'The user opened chat from a text selection but did not specify the operation.',
							target: {
								type: 'selected_text',
								contentHint: contentHintFromSelectedText(context.selectedText),
							},
							missingInfo: ['请说明要对选中文本执行什么操作。'],
						},
						classification: {
							domain: 'conversation',
							intentType: 'clarification',
							confidence: 0.9,
							isCompound: false,
							complexity: 'simple',
						},
						routing: {
							executionMode: 'clarify_first',
							contextPrep: {
								needsActiveFileContent: false,
								needsSelectedText: true,
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
										question: '你希望我对选中文本做什么？',
										options: ['总结', '分析', '改写'],
										defaultAssumption: '总结选中文本。',
									},
								],
								reason: '选中文本已经确定，但动作还不明确。',
							},
						},
					},
				});
			}
		}

		if (
			context.activeFilePath
			&& (context.triggerSource === 'at_trigger' || analysis.resolvedSpecialTarget === 'active_file')
			&& analysis.hasClearAction
			&& analysis.resolvedTargets.length === 0
		) {
			candidates.push(
				buildToolAssistedCandidate(
					context,
					context.triggerSource === 'at_trigger' ? 90 : 82,
					{
						type: 'active_file',
						paths: [context.activeFilePath],
					},
					'active_file'
				)
			);
		}

		return candidates;
	}

	evaluate(context: RequestContext): IntentResult | null {
		const best = this.getCandidates(context).sort((left, right) => right.score - left.score)[0];
		return best?.result ?? null;
	}
}
