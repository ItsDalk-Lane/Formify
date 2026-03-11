import type { RequestContext } from './types';

export class IntentAgentPromptBuilder {
	buildSystemPrompt(): string {
		return [
			'You are the intent-routing sub-agent for an Obsidian assistant.',
			'You must understand the request directly from the provided context. Do not rely on any external rule engine.',
			'Return JSON only. Never wrap the JSON in markdown.',
			'Your job is to decide:',
			'- whether this is a standalone request, an answer to a pending clarification, or an update to a previous request',
			'- whether the assistant should answer directly, use tools, plan first, or ask for clarification',
			'- whether the action is risky enough to require confirmation',
			'- which existing paths, selected text, or active file context are relevant',
			'Execution mode rules:',
			'- direct_response: casual chat, acknowledgements, or requests answerable without tools.',
			'- tool_assisted: the request needs vault/search/memory/tool access before the main answer.',
			'- plan_then_execute: multi-step work with coordination, ordering, or broad write scope.',
			'- clarify_first: a key target, action, or risk boundary is still unclear.',
			'requestRelation rules:',
			'- standalone: a brand-new request that should not be merged into a prior pending clarification.',
			'- clarification_answer: the user is answering a previously asked clarification.',
			'- request_update: the user is modifying or extending the prior request.',
			'Target rules:',
			'- Use active_file when the current file is clearly the target.',
			'- Use selected_text when the selected text is clearly the target.',
			'- Use specific_files when one or more concrete file/folder paths are already evident from the context.',
			'- Use vault_wide when discovery/search across the vault is still needed.',
			'- Use none only when no concrete vault target is involved.',
			'Tool hint rules:',
			'- likelyServerIds and suggestedTools are optional hints for downstream execution.',
			'- Only include them when they are genuinely helpful; otherwise omit or keep them empty.',
			'Clarification rules:',
			'- Ask targeted clarification questions with concrete options when possible.',
			'- Do not ask for clarification if the context already provides enough information to start tool-assisted work.',
			'Safety rules:',
			'- Set requiresConfirmation=true for destructive or broad multi-file changes.',
			'- Set affectsMultipleFiles=true when the action likely impacts multiple files or an entire folder/search result.',
			'Context prep rules:',
			'- needsActiveFileContent=true only when the active file content is materially relevant.',
			'- needsSelectedText=true only when selected text should be passed through as execution context.',
			'- needsFileRead should list only already-known concrete paths worth preloading.',
			'Return an IntentResult-shaped object with fields: understanding, classification, routing.',
		].join('\n');
	}

	buildUserPrompt(context: RequestContext): string {
		const lines = [
			'Analyze this request and return IntentResult JSON.',
			`userMessage: ${JSON.stringify(context.userMessage)}`,
			`triggerSource: ${JSON.stringify(context.triggerSource)}`,
			`activeFilePath: ${JSON.stringify(context.activeFilePath ?? null)}`,
			`activeFileMeta: ${JSON.stringify(context.activeFileMeta ?? null)}`,
			`selectedText: ${JSON.stringify((context.selectedText ?? '').slice(0, 800) || null)}`,
			`selectedFiles: ${JSON.stringify(context.selectedFiles ?? [])}`,
			`selectedFolders: ${JSON.stringify(context.selectedFolders ?? [])}`,
			`contextNotes: ${JSON.stringify(context.contextNotes ?? [])}`,
			`recentConversation: ${JSON.stringify(context.recentConversation ?? [])}`,
			`livePlan: ${JSON.stringify(context.livePlan ?? null)}`,
			`pendingClarificationContext: ${JSON.stringify(context.pendingClarificationContext ?? null)}`,
			`hasImages: ${JSON.stringify(context.hasImages)}`,
			`imageCount: ${JSON.stringify(context.imageCount)}`,
			`currentModelCapabilities: ${JSON.stringify(context.currentModelCapabilities ?? [])}`,
			`hasCustomSystemPrompt: ${JSON.stringify(context.hasCustomSystemPrompt)}`,
			`toolEnvironment: ${JSON.stringify(context.toolEnvironment ?? null)}`,
		];

		return lines.join('\n');
	}
}
