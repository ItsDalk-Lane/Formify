import { ShortcutRules } from './shortcut-rules';
import type { MessageAnalysis, RequestContext } from '../types';

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
	userMessage: '你好',
	hasImages: false,
	imageCount: 0,
	triggerSource: 'chat_input',
	messageAnalysis: createMessageAnalysis(),
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
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['continue'],
					primaryAction: 'continue',
					hasClearAction: true,
				}),
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
				messageAnalysis: createMessageAnalysis({
					references: [
						{
							raw: '选中文本',
							type: 'selected_text',
							normalized: 'selected_text',
							preferredKind: 'selected_text',
						},
					],
					resolvedSpecialTarget: 'selected_text',
					preferredTarget: 'selected_text',
					targetStatus: 'special',
					hasUniqueResolvedTarget: true,
				}),
			})
		);

		expect(result?.classification.intentType).toBe('clarification');
		expect(result?.routing.executionMode).toBe('clarify_first');
		expect(result?.routing.contextPrep.needsSelectedText).toBe(true);
	});

	it('recognizes natural-language folder summary requests without selected folders', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(
			createContext({
				userMessage: '给我总结 000 号文件夹中所有文件的内容',
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['summarize'],
					primaryAction: 'summarize',
					hasClearAction: true,
					isCompound: true,
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
							status: 'unique',
							candidates: ['000'],
						},
					],
					resolvedTargets: [{ path: '000', kind: 'folder' }],
					preferredTarget: 'folder',
					targetStatus: 'unique',
					hasUniqueResolvedTarget: true,
				}),
			})
		);

		expect(result?.routing.executionMode).toBe('tool_assisted');
		expect(result?.classification.domain).toBe('reasoning');
		expect(result?.understanding.target.paths).toEqual(['000']);
	});

	it('marks search and summarize requests as compound', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(
			createContext({
				userMessage: '搜索 project 标签并比较最近两篇',
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['search', 'compare'],
					primaryAction: 'compare',
					preparatoryActions: ['search'],
					isCompound: true,
					hasClearAction: true,
				}),
			})
		);

		expect(result?.routing.executionMode).toBe('tool_assisted');
		expect(result?.classification.isCompound).toBe(true);
		expect(result?.classification.subIntents?.length).toBeGreaterThan(1);
	});

	it('treats trigger source as a scoring hint rather than a hard gate', () => {
		const rules = new ShortcutRules();
		const result = rules.evaluate(
			createContext({
				userMessage: '帮我总结当前文件',
				triggerSource: 'chat_input',
				activeFilePath: 'notes/today.md',
				messageAnalysis: createMessageAnalysis({
					normalizedActions: ['summarize'],
					primaryAction: 'summarize',
					hasClearAction: true,
					references: [
						{
							raw: '当前文件',
							type: 'active_file',
							normalized: 'notes/today.md',
							preferredKind: 'active_file',
						},
					],
					resolvedSpecialTarget: 'active_file',
					preferredTarget: 'active_file',
					targetStatus: 'special',
					hasUniqueResolvedTarget: true,
				}),
			})
		);

		expect(result?.routing.executionMode).toBe('tool_assisted');
		expect(result?.understanding.target.type).toBe('active_file');
	});
});
