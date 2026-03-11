import { IntentResultValidator } from './IntentResultValidator';
import type { MessageAnalysis, RequestContext } from './types';

const createMessageAnalysis = (
	overrides: Partial<MessageAnalysis> = {}
): MessageAnalysis => ({
	normalizedActions: [],
	preparatoryActions: [],
	isCompound: false,
	references: [],
	pathResolutions: [],
	resolvedTargets: [],
	preferredTarget: 'none',
	targetStatus: 'none',
	hasClearAction: false,
	hasUniqueResolvedTarget: false,
	ambiguityReasons: [],
	summary: 'actions=none; target=none; status=none',
	...overrides,
});

const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
	userMessage: '帮我总结当前文件',
	hasImages: false,
	imageCount: 0,
	triggerSource: 'chat_input',
	messageAnalysis: createMessageAnalysis(),
	hasCustomSystemPrompt: false,
	...overrides,
});

describe('IntentResultValidator', () => {
	it('forces direct_response intents to drop tool hints and tool loops', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '打个招呼',
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
					toolHints: {
						likelyServerIds: ['__builtin__:vault-tools'],
						domain: 'conversation',
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
						maxToolCalls: 4,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			},
			createContext(),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.executionMode).toBe('direct_response');
		expect(result.routing.toolHints).toBeUndefined();
		expect(result.routing.constraints.maxToolCalls).toBe(0);
	});

	it('adds default tool hints for tool-assisted requests', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '搜索标签 project',
					target: {
						type: 'vault_wide',
					},
				},
				classification: {
					domain: 'vault_search',
					intentType: 'find_by_tag',
					confidence: 0.9,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'tool_assisted',
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
						maxToolCalls: 4,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			},
			createContext({
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['search'],
					primaryAction: 'search',
					hasClearAction: true,
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.toolHints?.domain).toBe('vault_search');
		expect(result.routing.toolHints?.intentType).toBe('find_by_tag');
		expect(result.routing.toolHints?.likelyServerIds).toContain('__builtin__:vault-tools');
		expect(result.routing.toolHints?.suggestedTools).toContain('search_tags');
	});

	it('adds vault access hints for reasoning requests over resolved files', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '读取 projects/roadmap.md 并告诉我重点',
					target: {
						type: 'specific_files',
						paths: ['Projects/roadmap.md'],
					},
				},
				classification: {
					domain: 'reasoning',
					intentType: 'analyze_content',
					confidence: 0.88,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'tool_assisted',
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
						maxToolCalls: 4,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			},
			createContext({
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['read', 'analyze'],
					primaryAction: 'analyze',
					preparatoryActions: ['read'],
					hasClearAction: true,
					isCompound: true,
					resolvedTargets: [{ path: 'Projects/roadmap.md', kind: 'file' }],
					preferredTarget: 'file',
					targetStatus: 'unique',
					hasUniqueResolvedTarget: true,
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.toolHints?.likelyServerIds).toContain('__builtin__:vault-tools');
		expect(result.routing.toolHints?.suggestedTools).toContain('read_file');
		expect(result.routing.promptAugmentation).toContain('不要声称你无法访问文件系统');
		expect(result.routing.promptAugmentation).toContain('Projects/roadmap.md');
	});

	it('adds search and vault hints for compound search-plus-compare requests', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '搜索 project 标签并比较最近两篇',
					target: {
						type: 'vault_wide',
					},
				},
				classification: {
					domain: 'reasoning',
					intentType: 'compare',
					confidence: 0.84,
					isCompound: true,
					complexity: 'moderate',
				},
				routing: {
					executionMode: 'tool_assisted',
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
			createContext({
				userMessage: '搜索 project 标签并比较最近两篇',
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['search', 'compare'],
					primaryAction: 'compare',
					preparatoryActions: ['search'],
					hasClearAction: true,
					isCompound: true,
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.toolHints?.likelyServerIds).toContain('builtin.obsidian-search');
		expect(result.routing.toolHints?.likelyServerIds).toContain('__builtin__:vault-tools');
		expect(result.routing.toolHints?.likelyServerIds).toContain('__builtin__:mcp-sequentialthinking');
		expect(result.routing.toolHints?.suggestedTools).toEqual(
			expect.arrayContaining(['search_tags', 'read_file', 'sequentialthinking'])
		);
	});

	it('uses the configured confidence threshold instead of a hard-coded 0.5', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '处理一下',
					target: {
						type: 'active_file',
					},
				},
				classification: {
					domain: 'reasoning',
					intentType: 'analyze_content',
					confidence: 0.55,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'tool_assisted',
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
						maxToolCalls: 3,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			},
			createContext({
				activeFilePath: 'notes/today.md',
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['summarize'],
					primaryAction: 'summarize',
					hasClearAction: true,
					resolvedSpecialTarget: 'active_file',
					preferredTarget: 'active_file',
					targetStatus: 'special',
					hasUniqueResolvedTarget: true,
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.executionMode).toBe('tool_assisted');
		expect(result.classification.confidence).toBeGreaterThanOrEqual(0.6);
	});

	it('generates targeted clarification for ambiguous folder candidates', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{
				understanding: {
					normalizedRequest: '总结 000 文件夹',
					target: {
						type: 'specific_files',
					},
				},
				classification: {
					domain: 'reasoning',
					intentType: 'analyze_content',
					confidence: 0.82,
					isCompound: false,
					complexity: 'simple',
				},
				routing: {
					executionMode: 'tool_assisted',
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
						maxToolCalls: 4,
					},
					safetyFlags: {
						isDestructive: false,
						affectsMultipleFiles: false,
						requiresConfirmation: false,
					},
				},
			},
			createContext({
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['summarize'],
					primaryAction: 'summarize',
					hasClearAction: true,
					references: [
						{
							raw: '000',
							type: 'natural_folder',
							normalized: '000',
							preferredKind: 'folder',
						},
					],
					pathResolutions: [
						{
							referenceRaw: '000',
							referenceType: 'natural_folder',
							preferredKind: 'folder',
							status: 'ambiguous',
							candidates: ['Projects/000', 'Archive/000'],
						},
					],
					preferredTarget: 'folder',
					targetStatus: 'ambiguous',
					ambiguityReasons: ['multiple_target_candidates'],
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.executionMode).toBe('clarify_first');
		expect(result.routing.clarification?.questions[0]?.options).toEqual(['Projects/000', 'Archive/000']);
	});

	it('still asks for clarification when the action is missing', () => {
		const validator = new IntentResultValidator();
		const result = validator.validate(
			{},
			createContext({
				activeFilePath: 'notes/today.md',
				messageAnalysis: createMessageAnalysis({
					resolvedSpecialTarget: 'active_file',
					preferredTarget: 'active_file',
					targetStatus: 'special',
					hasUniqueResolvedTarget: true,
				}),
			}),
			{ confidenceThreshold: 0.6 }
		);

		expect(result.routing.executionMode).toBe('clarify_first');
		expect(result.routing.clarification?.reason).toContain('动作');
	});
});
