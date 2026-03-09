import { TriggerSourceRules } from './trigger-source-rules';
import type { IntentResult, RequestContext } from '../types';

const GREETING_PATTERN =
	/^(你好|hi|hello|hey|嗨|哈喽|早上好|晚上好|在吗|你是谁|你能做什么)[\s?？!！。.]*$/i;
const CONTINUE_PATTERN = /^(继续|下一步|next|continue|接着|go on)[\s?？!！。.]*$/i;
const MEMORY_STORE_PATTERN = /(记住|remember|别忘了|记录一下|帮我记|don't forget)/i;
const SEARCH_PATTERN = /^(搜索|搜一下|找一下|查找|search|find|look for|帮我找)/i;
const WRITE_VERB_PATTERN = /(写|生成|创建|总结|分析|对比|整理|归纳|比较)/i;
const PATH_PATTERN = /(\[\[[^\]]+\]\]|(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+)/g;

const extractExplicitPaths = (message: string): string[] => {
	const matches = message.match(PATH_PATTERN) ?? [];
	return Array.from(
		new Set(
			matches
				.map((item) => item.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim())
				.filter(Boolean)
		)
	);
};

export class ShortcutRules {
	constructor(
		private readonly triggerSourceRules = new TriggerSourceRules()
	) {}

	evaluate(context: RequestContext): IntentResult | null {
		const triggerRule = this.triggerSourceRules.evaluate(context);
		if (triggerRule) {
			return this.applyExplicitPaths(triggerRule, context);
		}

		if (
			context.hasImages
			&& !(context.currentModelCapabilities ?? []).includes('Image Vision')
		) {
			return {
				understanding: {
					normalizedRequest: 'The user attached images, but the current model cannot inspect them.',
					target: {
						type: 'external',
					},
					missingInfo: ['A vision-capable model is required for image analysis.'],
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
								question: 'The current model cannot inspect images. Should I continue without the images or switch to a vision-capable model?',
								options: ['Continue without images', 'Switch to a vision model'],
								defaultAssumption: 'Continue without the images.',
							},
						],
						reason: 'Image inputs need a model with Image Vision capability.',
					},
				},
			};
		}

		if (GREETING_PATTERN.test(context.userMessage.trim())) {
			return this.applyExplicitPaths(
				{
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
				context
			);
		}

		if (
			context.livePlan?.nextTodoTask
			&& CONTINUE_PATTERN.test(context.userMessage.trim())
		) {
			return {
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
			};
		}

		if (MEMORY_STORE_PATTERN.test(context.userMessage)) {
			return this.applyExplicitPaths(
				{
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
				context
			);
		}

		if (SEARCH_PATTERN.test(context.userMessage) && !WRITE_VERB_PATTERN.test(context.userMessage)) {
			return this.applyExplicitPaths(
				{
					understanding: {
						normalizedRequest: `Search the vault for information matching: ${context.userMessage.trim()}`,
						target: {
							type: 'vault_wide',
						},
					},
					classification: {
						domain: 'vault_search',
						intentType: 'find_by_content',
						confidence: 0.85,
						isCompound: false,
						complexity: 'simple',
					},
					routing: {
						executionMode: 'tool_assisted',
						toolHints: {
							likelyServerIds: [],
							domain: 'vault_search',
							intentType: 'find_by_content',
							complexity: 'simple',
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
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
					},
				},
				context
			);
		}

		if (
			((context.selectedFiles?.length ?? 0) > 0 || (context.selectedFolders?.length ?? 0) > 0)
			&& WRITE_VERB_PATTERN.test(context.userMessage)
		) {
			return this.applyExplicitPaths(
				{
					understanding: {
						normalizedRequest: `Work on the explicitly attached files or folders according to: ${context.userMessage.trim()}`,
						target: {
							type: 'specific_files',
							paths: [
								...(context.selectedFiles ?? []),
								...(context.selectedFolders ?? []),
							],
						},
					},
					classification: {
						domain: 'generation',
						intentType: 'generate_text',
						confidence: 0.8,
						isCompound: false,
						complexity: 'moderate',
					},
					routing: {
						executionMode: 'tool_assisted',
						toolHints: {
							likelyServerIds: [],
							domain: 'generation',
							intentType: 'generate_text',
							complexity: 'moderate',
						},
						contextPrep: {
							needsActiveFileContent: false,
							needsSelectedText: false,
							needsMemoryLoad: false,
							needsPlanContext: false,
							needsFileRead: [
								...(context.selectedFiles ?? []),
								...(context.selectedFolders ?? []),
							],
						},
						constraints: {
							readOnly: true,
							allowShell: false,
							allowScript: false,
							maxToolCalls: 8,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: (context.selectedFiles?.length ?? 0) + (context.selectedFolders?.length ?? 0) > 1,
							requiresConfirmation: false,
						},
					},
				},
				context
			);
		}

		return null;
	}

	private applyExplicitPaths(result: IntentResult, context: RequestContext): IntentResult {
		const explicitPaths = extractExplicitPaths(context.userMessage);
		if (explicitPaths.length === 0) {
			return result;
		}

		return {
			...result,
			understanding: {
				...result.understanding,
				target: {
					...result.understanding.target,
					type: 'specific_files',
					paths: Array.from(
						new Set([...(result.understanding.target.paths ?? []), ...explicitPaths])
					),
				},
			},
		};
	}
}

