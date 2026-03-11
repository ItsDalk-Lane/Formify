import type {
	BaseOptions,
	Message,
	McpCallToolFnForProvider,
	McpToolDefinitionForProvider,
	Vendor,
} from 'src/features/tars/providers';

export interface ResolvedSubAgentProvider {
	tag: string;
	vendorName: string;
	options: BaseOptions;
}

export interface SubAgentRunnerDependencies {
	resolveProviderByTag: (tag: string) => ResolvedSubAgentProvider | null;
	getVendorByName: (vendorName: string) => Vendor | undefined;
}

export interface SubAgentRunOptions {
	modelTag: string;
	timeoutMs: number;
	systemPrompt: string;
	userPrompt: string;
	enableReasoning?: boolean;
	enableThinking?: boolean;
	enableWebSearch?: boolean;
	mcpTools?: McpToolDefinitionForProvider[];
	mcpCallTool?: McpCallToolFnForProvider;
	mcpMaxToolCallLoops?: number;
}

export interface SubAgentRunResult {
	content: string;
	messages: Message[];
}
