import { IntentResultValidator } from './IntentResultValidator';
import type { RequestContext } from './types';

const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
	userMessage: '帮我总结当前文件',
	hasImages: false,
	imageCount: 0,
	triggerSource: 'chat_input',
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
			createContext()
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
			createContext()
		);

		expect(result.routing.toolHints?.domain).toBe('vault_search');
		expect(result.routing.toolHints?.intentType).toBe('find_by_tag');
		expect(result.routing.toolHints?.likelyServerIds).toContain('__builtin__:vault-tools');
	});

	it('falls back to clarify_first when confidence is too low', () => {
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
					confidence: 0.2,
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
			createContext({ activeFilePath: 'notes/today.md' })
		);

		expect(result.routing.executionMode).toBe('clarify_first');
		expect(result.routing.constraints.maxToolCalls).toBe(0);
		expect(result.routing.clarification?.questions.length).toBeGreaterThan(0);
	});
});
