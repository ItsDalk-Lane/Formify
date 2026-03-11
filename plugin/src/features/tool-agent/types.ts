import type { BaseOptions } from 'src/features/tars/providers';

export const TOOL_AGENT_SERVER_ID = '__builtin__:tool-agent';
export const TOOL_AGENT_TOOL_NAME = 'execute_task';

export interface ToolAgentRequest {
	task: string;
	constraints?: {
		readOnly?: boolean;
		maxToolCalls?: number;
		timeoutMs?: number;
		allowShell?: boolean;
		allowScript?: boolean;
	};
	context?: {
		activeFilePath?: string;
		selectedText?: string;
		relevantPaths?: string[];
		recentConversation?: Array<{
			role: 'user' | 'assistant';
			summary: string;
		}>;
		normalizedIntent?: string;
	};
	/**
	 * Internal-only runtime hooks used by the host integration layer.
	 * These fields are not exposed to the main model schema.
	 */
	runtime?: {
		callTool?: (
			serverId: string,
			toolName: string,
			args: Record<string, unknown>
		) => Promise<string>;
	};
}

export interface ToolExecutionStep {
	stepIndex: number;
	toolName: string;
	serverId: string;
	arguments: Record<string, unknown>;
	result: string;
	status: 'success' | 'failed';
	error?: string;
	durationMs: number;
}

export interface ToolAgentResponse {
	status: 'success' | 'partial' | 'failed' | 'needs_clarification';
	summary: string;
	data?: unknown;
	trace: ToolExecutionStep[];
	clarificationNeeded?: string;
	metrics: {
		toolCallCount: number;
		totalTokens: number;
		durationMs: number;
	};
}

export interface ProcessedResult {
	rawResult: string;
	contentForModel: string;
	structuredData?: unknown;
	wasTruncated: boolean;
	truncationNote?: string;
}

export interface SafetyCheckResult {
	allowed: boolean;
	reason?: string;
	suggestion?: string;
}

export interface ToolAgentModelContext {
	name: string;
	serverId: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ToolAgentPromptInput {
	request: ToolAgentRequest;
	tools: ToolAgentModelContext[];
}

export interface ToolAgentPrompt {
	systemPrompt: string;
	userPrompt: string;
	modelTools: ToolAgentModelContext[];
}

export interface ToolAgentSettings {
	modelTag: string;
	defaultConstraints: {
		maxToolCalls: number;
		timeoutMs: number;
		allowShell: boolean;
		allowScript: boolean;
	};
	enabled: boolean;
}

export const DEFAULT_TOOL_AGENT_SETTINGS: ToolAgentSettings = {
	modelTag: '',
	defaultConstraints: {
		maxToolCalls: 10,
		timeoutMs: 30000,
		allowShell: false,
		allowScript: false,
	},
	enabled: false,
};

export interface ToolAgentRuntimeTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface ToolAgentProviderResolverResult {
	tag: string;
	vendorName: string;
	options: BaseOptions;
}
