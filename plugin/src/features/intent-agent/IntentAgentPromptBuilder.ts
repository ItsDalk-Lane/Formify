import type { RequestContext } from './types';

export class IntentAgentPromptBuilder {
	buildSystemPrompt(): string {
		return [
			'You are the intent recognition engine for an Obsidian assistant.',
			'Classify the user request and return JSON only.',
			'Execution modes:',
			'- direct_response: answer without tools',
			'- tool_assisted: answer with tool help',
			'- plan_then_execute: complex multi-step task, plan first',
			'- clarify_first: ask for missing critical detail first',
			'Domains:',
			'- vault_read, vault_write, vault_search, knowledge_mgmt, generation, reasoning, conversation',
			'Rules:',
			'- If the user does not need the vault, memory, or external context, prefer direct_response.',
			'- If the request mutates files, set readOnly=false.',
			'- If the request is destructive or batch-affecting, set requiresConfirmation=true.',
			'- selection_toolbar with selectedText strongly implies target.type=selected_text.',
			'- at_trigger with activeFilePath strongly implies target.type=active_file.',
			'- If confidence is low or key details are missing, use clarify_first.',
			'Return strict JSON with understanding, classification, and routing fields.',
		].join('\n');
	}

	buildUserPrompt(context: RequestContext): string {
		const lines = [
			'Analyze this request and return intent JSON.',
			`userMessage: ${JSON.stringify(context.userMessage)}`,
			`triggerSource: ${JSON.stringify(context.triggerSource)}`,
			`activeFilePath: ${JSON.stringify(context.activeFilePath ?? null)}`,
			`selectedText: ${JSON.stringify((context.selectedText ?? '').slice(0, 200) || null)}`,
			`selectedFiles: ${JSON.stringify(context.selectedFiles ?? [])}`,
			`selectedFolders: ${JSON.stringify(context.selectedFolders ?? [])}`,
			`contextNotes: ${JSON.stringify(context.contextNotes ?? [])}`,
			`livePlan: ${JSON.stringify(context.livePlan ?? null)}`,
			`recentConversation: ${JSON.stringify((context.recentConversation ?? []).slice(-3))}`,
			`hasImages: ${JSON.stringify(context.hasImages)}`,
			`imageCount: ${JSON.stringify(context.imageCount)}`,
			`currentModelCapabilities: ${JSON.stringify(context.currentModelCapabilities ?? [])}`,
			`hasCustomSystemPrompt: ${JSON.stringify(context.hasCustomSystemPrompt)}`,
		];

		if (context.activeFileMeta) {
			lines.push(`activeFileMeta: ${JSON.stringify(context.activeFileMeta)}`);
		}

		return lines.join('\n');
	}
}

