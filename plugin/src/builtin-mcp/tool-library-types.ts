export interface ToolLibraryParameter {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

export interface ToolLibraryExample {
	title: string;
	args: Record<string, unknown>;
	summary: string;
}

export interface ToolLibraryMetadata {
	name: string;
	serverId: string;
	serverName: string;
	category: string;
	keywords: string[];
	scenarios: string[];
	decisionGuide: string[];
	capabilities: string[];
	parameters: ToolLibraryParameter[];
	examples: ToolLibraryExample[];
}

export interface ToolLibraryEntry {
	filePath: string;
	body: string;
	metadata: ToolLibraryMetadata;
	summary: string;
}

export interface ToolLibraryCatalogDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
	serverName: string;
}

export interface ToolLibrarySeed {
	name: string;
	serverId: string;
	serverName: string;
	category: string;
	keywords: string[];
	scenarios: string[];
	decisionGuide: string[];
	capabilities: string[];
	examples: ToolLibraryExample[];
	body: string;
}

export interface ToolLibrarySearchOptions {
	task: string;
	serverIds?: string[];
	categories?: string[];
	limit?: number;
}

export interface ToolLibrarySearchResult {
	entry: ToolLibraryEntry;
	score: number;
	exactKeywordMatches: string[];
	partialKeywordMatches: string[];
	scenarioMatches: string[];
}
