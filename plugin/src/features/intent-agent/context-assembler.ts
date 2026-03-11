import { MarkdownView, TFile } from 'obsidian';
import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_VAULT_SERVER_ID,
} from 'src/builtin-mcp/constants';
import type { App } from 'obsidian';
import { getEnabledCapabilities } from 'src/features/tars/providers/utils';
import { availableVendors } from 'src/features/tars/settings';
import type { ProviderSettings } from 'src/features/tars/providers';
import type { ChatMessage, ChatSession, SelectedFile, SelectedFolder } from 'src/features/chat/types/chat';
import type {
	ConversationSummary,
	IntentDomain,
	IntentTriggerSource,
	PendingClarificationContext,
	RequestContext,
} from './types';
import { MessageSemanticAnalyzer } from './message-analysis';

interface AssembleRequest {
	userMessage: string;
	session: ChatSession;
	latestUserMessage: ChatMessage;
	triggerSource: IntentTriggerSource;
	selectedFiles: SelectedFile[];
	selectedFolders: SelectedFolder[];
	contextNotes: string[];
	modelTag?: string | null;
	resolveProviderByTag: (tag?: string) => ProviderSettings | null;
	resolveOllamaCapabilities?: (modelTag: string) => Promise<{
		supported: boolean;
		shouldWarn: boolean;
		modelName: string;
	} | null>;
	activeFilePath?: string;
	selectedTextOverride?: string;
	pendingClarificationContext?: PendingClarificationContext;
}

const summarizeMessage = (message: ChatMessage): ConversationSummary => {
	const text = message.content.replace(/\s+/g, ' ').trim();
	const toolNames = (message.toolCalls ?? []).map((call) => call.name);
	return {
		role: message.role === 'assistant' ? 'assistant' : 'user',
		summary: text.slice(0, 100),
		hadToolCalls: toolNames.length > 0,
		...(toolNames.length > 0 ? { toolNames } : {}),
	};
};

const normalizeTags = (rawTags: unknown): string[] => {
	if (Array.isArray(rawTags)) {
		return rawTags
			.map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
			.filter(Boolean);
	}
	if (typeof rawTags === 'string' && rawTags.trim()) {
		return [rawTags.trim()];
	}
	return [];
};

const domainToDefaultServerIds = (domain: IntentDomain): string[] => {
	switch (domain) {
		case 'vault_read':
		case 'vault_write':
			return [BUILTIN_VAULT_SERVER_ID];
		case 'vault_search':
			return [BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_VAULT_SERVER_ID];
		case 'knowledge_mgmt':
			return [BUILTIN_MEMORY_SERVER_ID];
		case 'reasoning':
			return [BUILTIN_SEQUENTIAL_THINKING_SERVER_ID];
		default:
			return [];
	}
};

export class ContextAssembler {
	private readonly messageAnalyzer: MessageSemanticAnalyzer;

	constructor(private readonly app: App) {
		this.messageAnalyzer = new MessageSemanticAnalyzer(app);
	}

	async assemble(input: AssembleRequest): Promise<RequestContext> {
		const latestMetadata = input.latestUserMessage.metadata ?? {};
		const selectedText =
			typeof input.selectedTextOverride === 'string'
				? input.selectedTextOverride
				: typeof latestMetadata.selectedText === 'string'
				? latestMetadata.selectedText
				: undefined;
		const provider = input.resolveProviderByTag(input.modelTag ?? undefined);
		const vendor = provider
			? availableVendors.find((item) => item.name === provider.vendor)
			: undefined;
		const currentModelCapabilities = vendor
			? getEnabledCapabilities(vendor, provider.options)
			: [];
		if (
			provider?.vendor === 'Ollama'
			&& input.modelTag
			&& input.resolveOllamaCapabilities
		) {
			const ollamaCapabilities = await input.resolveOllamaCapabilities(input.modelTag);
			if (ollamaCapabilities?.supported && !currentModelCapabilities.includes('Reasoning')) {
				currentModelCapabilities.push('Reasoning');
			}
		}

		const activeFilePath =
			input.activeFilePath
			?? this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path
			?? input.selectedFiles[0]?.path;
		const activeFile =
			activeFilePath
				? this.app.vault.getAbstractFileByPath(activeFilePath)
				: null;
		const activeFileMeta =
			activeFile instanceof TFile
				? this.buildActiveFileMeta(activeFile)
				: undefined;

		const recentConversation = input.session.messages
			.filter((message) =>
				(message.role === 'user' || message.role === 'assistant')
				&& !message.metadata?.hiddenFromModel
				&& message.id !== input.latestUserMessage.id
			)
			.slice(-6)
			.map(summarizeMessage);

		const livePlan = input.session.livePlan
			? {
				title: input.session.livePlan.title,
				currentTask:
					input.session.livePlan.tasks.find((task) => task.status === 'in_progress')?.name,
				nextTodoTask:
					input.session.livePlan.tasks.find((task) => task.status === 'todo')?.name,
				progress: {
					total: input.session.livePlan.summary.total,
					done: input.session.livePlan.summary.done,
					inProgress: input.session.livePlan.summary.inProgress,
					todo: input.session.livePlan.summary.todo,
				},
			}
			: undefined;

		const triggerSource =
			this.normalizeTriggerSource(input.triggerSource, selectedText, activeFilePath);
		const messageAnalysis = this.messageAnalyzer.analyze({
			userMessage: input.userMessage,
			activeFilePath,
			selectedText,
			selectedFiles: input.selectedFiles.map((file) => file.path),
			selectedFolders: input.selectedFolders.map((folder) => folder.path),
		});

		return {
			userMessage: input.userMessage,
			hasImages: (input.latestUserMessage.images?.length ?? 0) > 0,
			imageCount: input.latestUserMessage.images?.length ?? 0,
			triggerSource,
			...(activeFilePath ? { activeFilePath } : {}),
			...(activeFileMeta ? { activeFileMeta } : {}),
			...(selectedText ? { selectedText } : {}),
			...(selectedText ? { selectedTextLength: selectedText.length } : {}),
			...(input.selectedFiles.length > 0
				? { selectedFiles: input.selectedFiles.map((file) => file.path) }
				: {}),
			...(input.selectedFolders.length > 0
				? { selectedFolders: input.selectedFolders.map((folder) => folder.path) }
				: {}),
			...(input.contextNotes.length > 0 ? { contextNotes: [...input.contextNotes] } : {}),
			...(recentConversation.length > 0 ? { recentConversation } : {}),
			...(livePlan ? { livePlan } : {}),
			messageAnalysis,
			...(input.pendingClarificationContext
				? { pendingClarificationContext: input.pendingClarificationContext }
				: {}),
			hasCustomSystemPrompt: Boolean(input.session.enableTemplateAsSystemPrompt || input.session.systemPrompt),
			...(currentModelCapabilities.length > 0 ? { currentModelCapabilities } : {}),
		};
	}

	analyzeMessage(input: {
		userMessage: string;
		activeFilePath?: string;
		selectedText?: string;
		selectedFiles?: string[];
		selectedFolders?: string[];
	}) {
		return this.messageAnalyzer.analyze(input);
	}

	getDefaultServerIdsForDomain(domain: IntentDomain): string[] {
		return domainToDefaultServerIds(domain);
	}

	private buildActiveFileMeta(file: TFile): RequestContext['activeFileMeta'] {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
		return {
			title: frontmatter?.title && typeof frontmatter.title === 'string'
				? frontmatter.title
				: file.basename,
			tags: normalizeTags(frontmatter?.tags),
			properties: frontmatter ? { ...frontmatter } : {},
		};
	}

	private normalizeTriggerSource(
		triggerSource: IntentTriggerSource,
		selectedText: string | undefined,
		activeFilePath: string | undefined
	): IntentTriggerSource {
		if (triggerSource === 'chat_input' && selectedText) {
			return 'selection_toolbar';
		}
		if (triggerSource === 'chat_input' && activeFilePath && selectedText && selectedText.length > 200) {
			return 'at_trigger';
		}
		return triggerSource;
	}
}
