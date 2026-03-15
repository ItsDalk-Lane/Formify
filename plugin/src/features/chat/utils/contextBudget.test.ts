import { resolveContextBudget } from './contextBudget';

describe('contextBudget', () => {
	it('derives trigger and target from provider context length and configured output reserve', () => {
		const budget = resolveContextBudget({
			tag: 'test',
			vendor: 'UnknownVendor',
			options: {
				apiKey: '',
				baseURL: '',
				model: 'test-model',
				contextLength: 120000,
				parameters: {
					max_tokens: 12000,
				},
			},
		});

		expect(budget.contextLength).toBe(120000);
		expect(budget.reserveForOutput).toBe(12000);
		expect(budget.usableInputTokens).toBe(108000);
		expect(budget.triggerTokens).toBe(81000);
		expect(budget.targetTokens).toBe(48600);
	});

	it('falls back to the default reserve heuristic when output tokens are not configured', () => {
		const budget = resolveContextBudget({
			tag: 'test',
			vendor: 'UnknownVendor',
			options: {
				apiKey: '',
				baseURL: '',
				model: 'test-model',
				contextLength: 64000,
				parameters: {},
			},
		});

		expect(budget.reserveForOutput).toBe(16000);
		expect(budget.usableInputTokens).toBe(48000);
	});
});
