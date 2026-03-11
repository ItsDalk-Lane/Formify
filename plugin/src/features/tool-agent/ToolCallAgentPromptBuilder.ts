import type {
	ToolAgentPrompt,
	ToolAgentPromptInput,
} from './types';

const formatTool = (tool: ToolAgentPrompt['modelTools'][number]): string => [
	`## ${tool.name} (${tool.serverId})`,
	`description: ${tool.description || 'No description provided.'}`,
	`inputSchema: ${JSON.stringify(tool.inputSchema)}`,
].join('\n');

export class ToolCallAgentPromptBuilder {
	build(input: ToolAgentPromptInput): ToolAgentPrompt {
		const { request, tools } = input;
		const constraintLines = [
			`readOnly=${request.constraints?.readOnly === true ? 'true' : 'false'}`,
			`maxToolCalls=${request.constraints?.maxToolCalls ?? 10}`,
			`timeoutMs=${request.constraints?.timeoutMs ?? 30000}`,
			`allowShell=${request.constraints?.allowShell === true ? 'true' : 'false'}`,
			`allowScript=${request.constraints?.allowScript === true ? 'true' : 'false'}`,
		];

		const systemPrompt = [
			'You are the tool-execution sub-agent for an Obsidian assistant.',
			'Use only the provided tools. Construct valid arguments, execute carefully, and stop when the task is complete.',
			'Return JSON only. Never wrap the JSON in markdown.',
			'Rules:',
			'- Respect the provided constraints exactly.',
			'- Prefer the smallest correct sequence of tool calls.',
			'- If the task needs reading/search before writing, do the read/search first.',
			'- If a tool call fails because of bad arguments, adjust once and retry at most one time.',
			'- If a key path, target, or value is missing, return needs_clarification instead of guessing.',
			'- Do not claim you lack vault/tool access when a relevant provided tool exists.',
			'- Stop calling tools once you can produce the final answer or a clear partial result.',
			'- JSON format: {"status":"success|partial|failed|needs_clarification","summary":"...","data":...,"clarificationNeeded":"... or omitted"}',
			'Available tools:',
			...tools.map(formatTool),
		].join('\n\n');

		const userPrompt = [
			`Task: ${request.task}`,
			`Constraints: ${constraintLines.join(', ')}`,
			request.context?.normalizedIntent
				? `Normalized intent: ${request.context.normalizedIntent}`
				: '',
			request.context?.activeFilePath
				? `Active file: ${request.context.activeFilePath}`
				: '',
			request.context?.selectedText
				? `Selected text:\n${request.context.selectedText}`
				: '',
			request.context?.relevantPaths?.length
				? `Relevant paths: ${request.context.relevantPaths.join(', ')}`
				: '',
			request.context?.recentConversation?.length
				? `Recent conversation: ${JSON.stringify(request.context.recentConversation)}`
				: '',
		].filter(Boolean).join('\n\n');

		return {
			systemPrompt,
			userPrompt,
			modelTools: tools,
		};
	}
}
