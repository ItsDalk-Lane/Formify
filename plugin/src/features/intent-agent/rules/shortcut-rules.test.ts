import { ShortcutRules } from './shortcut-rules';
import type { RequestContext } from '../types';

const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
	userMessage: '你好',
	hasImages: false,
	imageCount: 0,
	triggerSource: 'chat_input',
	hasCustomSystemPrompt: false,
	...overrides,
});

describe('ShortcutRules', () => {
	it('routes greetings to direct_response', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(createContext({ userMessage: 'hello' }));

		expect(result?.classification.intentType).toBe('chitchat');
		expect(result?.routing.executionMode).toBe('direct_response');
	});

	it('routes continue requests with livePlan to tool_assisted continuation', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(
			createContext({
				userMessage: '继续',
				livePlan: {
					title: '实现 Intent Agent',
					nextTodoTask: '接入 ChatService',
					progress: {
						total: 2,
						done: 1,
						inProgress: 0,
						todo: 1,
					},
				},
			})
		);

		expect(result?.classification.intentType).toBe('continuation');
		expect(result?.routing.executionMode).toBe('tool_assisted');
		expect(result?.routing.contextPrep.needsPlanContext).toBe(true);
	});

	it('routes short selection-toolbar requests to clarify_first', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(
			createContext({
				userMessage: '帮我',
				triggerSource: 'selection_toolbar',
				selectedText: '这是一段待处理的选中文本',
			})
		);

		expect(result?.classification.intentType).toBe('clarification');
		expect(result?.routing.executionMode).toBe('clarify_first');
		expect(result?.routing.contextPrep.needsSelectedText).toBe(true);
	});
});
