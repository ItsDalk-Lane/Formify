export type JSONSchema = Record<string, unknown>;

export type ToolCategory =
	| 'file_read'
	| 'file_write'
	| 'file_manage'
	| 'navigation'
	| 'search'
	| 'query'
	| 'script'
	| 'memory'
	| 'planning'
	| 'thinking'
	| 'utility'
	| 'agent';

export interface ParameterExample {
	value: unknown;
	description: string;
}

export interface ToolParameterGuideEntry {
	description: string;
	examples: ParameterExample[];
	tips: string[];
	commonMistakes?: string[];
	defaultBehavior?: string;
}

export interface ToolReturnExample {
	scenario: string;
	output: string;
}

export interface ToolErrorCase {
	condition: string;
	errorMessage: string;
	resolution: string;
}

export interface ToolCombination {
	tools: string[];
	pattern: string;
	example: string;
}

export interface ToolDefinition {
	name: string;
	serverId: string;
	serverName: string;
	category: ToolCategory;
	summary: string;
	coreCapabilities: string[];
	limitations: string[];
	scenarios: {
		primary: string[];
		secondary: string[];
		antiPatterns: string[];
	};
	inputSchema: JSONSchema;
	parameterGuide: Record<string, ToolParameterGuideEntry>;
	bestPractices: string[];
	performanceTips?: string[];
	safetyNotes?: string[];
	commonCombinations: ToolCombination[];
	prerequisites?: string[];
	followUps?: string[];
	returnType: {
		description: string;
		schema?: JSONSchema;
		examples: ToolReturnExample[];
		errorCases: ToolErrorCase[];
	};
	searchKeywords: string[];
	intentPatterns: string[];
}

export interface ToolSelectionResult {
	tool: ToolDefinition;
	relevanceScore: number;
}
