import type { RequestContext } from './types';

export class IntentAgentPromptBuilder {
	buildSystemPrompt(): string {
		return [
			'You are the intent recognition engine for an Obsidian assistant.',
			'Classify the user request and return JSON only. Never wrap the JSON in markdown.',
			'Execution modes:',
			'- direct_response: no vault/tool context is needed.',
			'- tool_assisted: read/search/reason with vault or tools before answering.',
			'- plan_then_execute: genuinely complex multi-step work that should be planned first.',
			'- clarify_first: only when a critical action or target is still missing or ambiguous.',
			'Domains:',
			'- vault_read: list/read/open known files or folders.',
			'- vault_write: create, modify, move, or batch-update files.',
			'- vault_search: locate files, folders, tags, or metadata when the target is not yet resolved.',
			'- knowledge_mgmt: memory store/recall/update.',
			'- generation: rewrite, transform, or generate text/code.',
			'- reasoning: summarize, analyze, compare, explain, or synthesize resolved content.',
			'- conversation: casual chat, acknowledgement, or clarification.',
			'Target rules:',
			'- target.type=selected_text when the request clearly points at selected text.',
			'- target.type=active_file when the request clearly points at the current file.',
			'- target.type=specific_files when messageAnalysis or context already resolved concrete file/folder paths.',
			'- target.type=vault_wide when the user wants discovery/search across the vault.',
			'Confidence rules:',
			'- High confidence when action is clear and messageAnalysis already resolved a unique target.',
			'- Medium confidence when action is clear but you still need search/tool steps.',
			'- Low confidence only when action is unclear, target is ambiguous, or destructive scope is unclear.',
			'Clarification rules:',
			'- If there are multiple target candidates, ask a targeted disambiguation question with concrete options.',
			'- If action is missing, ask only about the action.',
			'- Do not ask generic questions when messageAnalysis already provides strong target evidence.',
			'Return strict JSON with understanding, classification, and routing fields.',
			'Example 1:',
			'Input: "给我总结 000 号文件夹中所有文件的内容" with messageAnalysis showing one unique folder path.',
			'Output intent: domain=reasoning, target.type=specific_files, executionMode=tool_assisted, isCompound=true.',
			'Example 2:',
			'Input: "帮我看看上一级目录里的日报" with messageAnalysis resolving parent folder but not the final file.',
			'Output intent: domain=vault_search, executionMode=tool_assisted, use search/listing before analysis.',
			'Example 3:',
			'Input: "搜索 project 标签并比较最近两篇".',
			'Output intent: domain=reasoning, executionMode=tool_assisted, isCompound=true, subIntents include search + compare.',
			'Example 4:',
			'Input references a folder name with two candidate folders.',
			'Output intent: executionMode=clarify_first with concrete candidate paths in clarification.options.',
		].join('\n');
	}

	buildUserPrompt(context: RequestContext): string {
		const lines = [
			'Analyze this request and return intent JSON.',
			`userMessage: ${JSON.stringify(context.userMessage)}`,
			`messageAnalysis: ${JSON.stringify(context.messageAnalysis)}`,
			`triggerSource: ${JSON.stringify(context.triggerSource)}`,
			`activeFilePath: ${JSON.stringify(context.activeFilePath ?? null)}`,
			`selectedText: ${JSON.stringify((context.selectedText ?? '').slice(0, 200) || null)}`,
			`selectedFiles: ${JSON.stringify(context.selectedFiles ?? [])}`,
			`selectedFolders: ${JSON.stringify(context.selectedFolders ?? [])}`,
			`contextNotes: ${JSON.stringify(context.contextNotes ?? [])}`,
			`livePlan: ${JSON.stringify(context.livePlan ?? null)}`,
			`recentConversation: ${JSON.stringify(context.recentConversation ?? [])}`,
			`pendingClarificationContext: ${JSON.stringify(context.pendingClarificationContext ?? null)}`,
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
