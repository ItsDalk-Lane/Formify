import { IntentAgent } from './IntentAgent';
import type { RequestContext } from './types';

const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
	userMessage: '帮我总结当前文件',
	hasImages: false,
	imageCount: 0,
	triggerSource: 'chat_input',
	hasCustomSystemPrompt: false,
	...overrides,
});

describe('IntentAgent', () => {
	it('normalizes prompt-driven intent output without validator fallback', async () => {
		const runner = {
			run: jest.fn().mockResolvedValue({
				content: JSON.stringify({
					understanding: {
						normalizedRequest: '总结当前文件',
						target: {
							type: 'active_file',
							paths: ['Notes/today.md'],
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
						requestRelation: 'request_update',
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
							maxToolCalls: 4,
						},
						safetyFlags: {
							isDestructive: false,
							affectsMultipleFiles: false,
							requiresConfirmation: false,
						},
					},
				}),
				messages: [],
			}),
		};

		const agent = new IntentAgent({
			getSettings: () => ({
				enabled: true,
				modelTag: 'intent-model',
				timeoutMs: 1500,
			}),
			resolveProviderByTag: () => null,
			getVendorByName: () => undefined,
			runner: runner as any,
		});

		const result = await agent.recognize(createContext({
			activeFilePath: 'Notes/today.md',
		}));

		expect(result.understanding.target.paths).toEqual(['Notes/today.md']);
		expect(result.routing.requestRelation).toBe('request_update');
		expect(result.routing.executionMode).toBe('tool_assisted');
		expect(runner.run).toHaveBeenCalledTimes(1);
	});
});
