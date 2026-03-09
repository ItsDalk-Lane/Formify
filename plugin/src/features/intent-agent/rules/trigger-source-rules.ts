import type { IntentResult, RequestContext } from '../types';

const TRANSFORM_PATTERN =
	/(翻译|translate|改写|rewrite|润色|polish|总结|summarize)/i;
const ANALYZE_PATTERN = /(总结|摘要|分析|概括|summarize|analyze)/i;

const contentHintFromSelectedText = (selectedText: string | undefined): string | undefined => {
	if (!selectedText) {
		return undefined;
	}
	return selectedText.trim().slice(0, 50) || undefined;
};

export class TriggerSourceRules {
	evaluate(context: RequestContext): IntentResult | null {
		if (
			context.triggerSource === 'selection_toolbar'
			&& context.selectedText
			&& TRANSFORM_PATTERN.test(context.userMessage)
		) {
			return {
				understanding: {
					normalizedRequest: `Transform the selected text according to the user's instruction: ${context.userMessage.trim()}`,
					target: {
						type: 'selected_text',
						contentHint: contentHintFromSelectedText(context.selectedText),
					},
				},
				classification: {
					domain: 'generation',
					intentType: 'transform_text',
					confidence: 0.95,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'tool_assisted',
					toolHints: {
						likelyServerIds: [],
						domain: 'generation',
						intentType: 'transform_text',
						complexity: 'simple',
					},
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
						maxToolCalls: 3,
					},
					promptAugmentation:
						'The user wants a direct transformation of the selected text. Return the transformed text with no extra framing.',
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			};
		}

		if (
			context.triggerSource === 'selection_toolbar'
			&& context.selectedText
			&& context.userMessage.trim().length <= 5
		) {
			return {
				understanding: {
					normalizedRequest:
						'The user opened chat from a text selection but did not specify the operation.',
					target: {
						type: 'selected_text',
						contentHint: contentHintFromSelectedText(context.selectedText),
					},
					missingInfo: ['What operation should be applied to the selected text?'],
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
								question: 'What should I do with the selected text?',
								options: ['Translate it', 'Polish it', 'Summarize it'],
								defaultAssumption: 'Polish the selected text.',
							},
						],
						reason: 'The selection exists, but the requested operation is not specific enough.',
					},
				},
			};
		}

		if (
			context.triggerSource === 'at_trigger'
			&& context.activeFilePath
			&& ANALYZE_PATTERN.test(context.userMessage)
		) {
			return {
				understanding: {
					normalizedRequest: `Analyze the active file according to the user's request: ${context.userMessage.trim()}`,
					target: {
						type: 'active_file',
						paths: [context.activeFilePath],
					},
				},
				classification: {
					domain: 'reasoning',
					intentType: 'analyze_content',
					confidence: 0.9,
					isCompound: false,
					complexity: 'moderate',
				},
				routing: {
					executionMode: 'tool_assisted',
					toolHints: {
						likelyServerIds: [],
						domain: 'reasoning',
						intentType: 'analyze_content',
						complexity: 'moderate',
					},
					contextPrep: {
						needsActiveFileContent: true,
						needsSelectedText: false,
						needsMemoryLoad: false,
						needsPlanContext: false,
					},
					constraints: {
						readOnly: true,
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
			};
		}

		return null;
	}
}

