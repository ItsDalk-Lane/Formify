import type { BaseOptions } from 'src/features/tars/providers';
import type { McpToolMode } from 'src/features/chat/types/chat';

export type IntentTriggerSource =
	| 'chat_input'
	| 'selection_toolbar'
	| 'at_trigger'
	| 'quick_action'
	| 'command_palette';

export type TargetType =
	| 'active_file'
	| 'selected_text'
	| 'specific_files'
	| 'vault_wide'
	| 'external'
	| 'conversation'
	| 'memory'
	| 'none';

export type IntentDomain =
	| 'vault_read'
	| 'vault_write'
	| 'vault_search'
	| 'knowledge_mgmt'
	| 'generation'
	| 'reasoning'
	| 'conversation';

export type IntentType =
	| 'read_file'
	| 'read_directory'
	| 'read_metadata'
	| 'open_navigate'
	| 'create_file'
	| 'modify_file'
	| 'reorganize'
	| 'batch_operation'
	| 'find_by_name'
	| 'find_by_content'
	| 'find_by_tag'
	| 'find_by_property'
	| 'find_by_task'
	| 'complex_query'
	| 'memory_store'
	| 'memory_recall'
	| 'memory_update'
	| 'memory_explore'
	| 'generate_text'
	| 'transform_text'
	| 'generate_code'
	| 'generate_plan'
	| 'analyze_content'
	| 'compare'
	| 'explain'
	| 'decision_support'
	| 'chitchat'
	| 'clarification'
	| 'feedback'
	| 'continuation';

export type IntentComplexity = 'simple' | 'moderate' | 'complex';

export type ExecutionMode =
	| 'direct_response'
	| 'tool_assisted'
	| 'plan_then_execute'
	| 'clarify_first';

export type IntentRequestRelation =
	| 'standalone'
	| 'clarification_answer'
	| 'request_update';

export interface ConversationSummary {
	role: 'user' | 'assistant';
	summary: string;
	hadToolCalls: boolean;
	toolNames?: string[];
}

export interface ClarificationQuestion {
	question: string;
	options?: string[];
	defaultAssumption: string;
}

export interface PendingClarificationContext {
	originalUserMessage: string;
	normalizedRequest: string;
	reason: string;
	questions: ClarificationQuestion[];
	currentReply: string;
}

export interface RequestContext {
	userMessage: string;
	hasImages: boolean;
	imageCount: number;
	triggerSource: IntentTriggerSource;
	activeFilePath?: string;
	activeFileMeta?: {
		title?: string;
		tags?: string[];
		properties?: Record<string, unknown>;
	};
	selectedText?: string;
	selectedTextLength?: number;
	selectedFiles?: string[];
	selectedFolders?: string[];
	contextNotes?: string[];
	recentConversation?: ConversationSummary[];
	livePlan?: {
		title: string;
		currentTask?: string;
		nextTodoTask?: string;
		progress: {
			total: number;
			done: number;
			inProgress: number;
			todo: number;
		};
	};
	pendingClarificationContext?: PendingClarificationContext;
	hasCustomSystemPrompt: boolean;
	currentModelCapabilities?: string[];
	toolEnvironment?: {
		mcpToolMode: McpToolMode;
		toolAgentEnabled: boolean;
		hasAnyAvailableTool: boolean;
		enabledServerIds?: string[];
	};
}

export interface IntentResult {
	understanding: {
		normalizedRequest: string;
		target: {
			type: TargetType;
			paths?: string[];
			contentHint?: string;
		};
		resolvedReferences?: Record<string, string>;
		missingInfo?: string[];
	};
	classification: {
		domain: IntentDomain;
		intentType: IntentType;
		confidence: number;
		isCompound: boolean;
		subIntents?: Array<{
			domain: IntentDomain;
			intentType: IntentType;
		}>;
		complexity: IntentComplexity;
	};
	routing: {
		executionMode: ExecutionMode;
		requestRelation?: IntentRequestRelation;
		toolHints?: {
			likelyServerIds: string[];
			suggestedTools?: string[];
			domain: IntentDomain;
			intentType?: IntentType;
			complexity?: IntentComplexity;
		};
		contextPrep: {
			needsActiveFileContent: boolean;
			needsSelectedText: boolean;
			needsFileRead?: string[];
			needsMemoryLoad: boolean;
			needsPlanContext: boolean;
		};
		constraints: {
			readOnly: boolean;
			allowShell: boolean;
			allowScript: boolean;
			maxToolCalls: number;
		};
		promptAugmentation?: string;
		safetyFlags: {
			isDestructive: boolean;
			affectsMultipleFiles: boolean;
			requiresConfirmation: boolean;
		};
		clarification?: {
			questions: ClarificationQuestion[];
			reason: string;
		};
	};
}

export interface IntentAgentSettings {
	modelTag: string;
	enabled: boolean;
	timeoutMs: number;
}

export const DEFAULT_INTENT_AGENT_SETTINGS: IntentAgentSettings = {
	modelTag: '',
	enabled: false,
	timeoutMs: 3000,
};

export interface IntentAgentProviderResolverResult {
	tag: string;
	vendorName: string;
	options: BaseOptions;
}
