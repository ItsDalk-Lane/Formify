import type {
	JSONSchema,
	ParameterExample,
	ToolCategory,
	ToolDefinition,
	ToolParameterGuideEntry,
} from './types';

type ToolBase = Pick<
	ToolDefinition,
	| 'name'
	| 'serverId'
	| 'serverName'
	| 'category'
	| 'summary'
	| 'coreCapabilities'
	| 'limitations'
	| 'scenarios'
	| 'inputSchema'
	| 'parameterGuide'
	| 'bestPractices'
	| 'performanceTips'
	| 'safetyNotes'
	| 'commonCombinations'
	| 'prerequisites'
	| 'followUps'
	| 'returnType'
	| 'searchKeywords'
	| 'intentPatterns'
>;

export const jsonString = (description: string): JSONSchema => ({
	type: 'string',
	description,
});

export const jsonNumber = (
	description: string,
	extra?: Record<string, unknown>
): JSONSchema => ({
	type: 'number',
	description,
	...(extra ?? {}),
});

export const jsonInteger = (
	description: string,
	extra?: Record<string, unknown>
): JSONSchema => ({
	type: 'integer',
	description,
	...(extra ?? {}),
});

export const jsonBoolean = (description: string): JSONSchema => ({
	type: 'boolean',
	description,
});

export const jsonArray = (
	description: string,
	items: JSONSchema
): JSONSchema => ({
	type: 'array',
	description,
	items,
});

export const jsonObject = (
	properties: Record<string, JSONSchema>,
	required: string[] = []
): JSONSchema => ({
	type: 'object',
	properties,
	...(required.length > 0 ? { required } : {}),
});

export const enumSchema = (
	description: string,
	values: string[]
): JSONSchema => ({
	type: 'string',
	description,
	enum: values,
});

export const parameterExample = (
	value: unknown,
	description: string
): ParameterExample => ({
	value,
	description,
});

export const guide = (
	description: string,
	examples: ParameterExample[],
	tips: string[],
	options?: {
		commonMistakes?: string[];
		defaultBehavior?: string;
	}
): ToolParameterGuideEntry => ({
	description,
	examples,
	tips,
	...(options?.commonMistakes ? { commonMistakes: options.commonMistakes } : {}),
	...(options?.defaultBehavior ? { defaultBehavior: options.defaultBehavior } : {}),
});

export const defineTool = (tool: ToolBase): ToolDefinition => ({
	...tool,
	performanceTips: tool.performanceTips ?? ['Prefer narrower scope before broad scans to reduce latency and noise.'],
	safetyNotes: tool.safetyNotes ?? ['Review tool output before using it as input to destructive follow-up actions.'],
});

export const englishAndChinese = (...values: string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
};

export const baseSearchKeywords = (
	name: string,
	category: ToolCategory,
	...extras: string[]
): string[] =>
	englishAndChinese(name, category, ...extras);
