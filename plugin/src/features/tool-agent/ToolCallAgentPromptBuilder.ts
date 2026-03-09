import type { ToolDefinition } from './registry/types';
import type { ToolAgentPrompt, ToolAgentPromptInput, ToolAgentModelContext } from './types';

const formatParameterGuide = (tool: ToolDefinition): string => {
	const entries = Object.entries(tool.parameterGuide);
	if (entries.length === 0) {
		return 'No parameters.';
	}

	return entries
		.map(([name, guide]) => {
			const examples = guide.examples
				.slice(0, 2)
				.map((example) => `${JSON.stringify(example.value)} => ${example.description}`)
				.join(' | ');
			const mistakes = guide.commonMistakes?.slice(0, 2).join(' | ');
			return [
				`- ${name}: ${guide.description}`,
				`  tips: ${guide.tips.slice(0, 2).join(' | ')}`,
				examples ? `  examples: ${examples}` : '',
				mistakes ? `  mistakes: ${mistakes}` : '',
				guide.defaultBehavior ? `  default: ${guide.defaultBehavior}` : '',
			]
				.filter(Boolean)
				.join('\n');
		})
		.join('\n');
};

export class ToolCallAgentPromptBuilder {
	build(input: ToolAgentPromptInput): ToolAgentPrompt {
		const { request, selectedTools, externalTools = [] } = input;
		const toolContexts: ToolAgentModelContext[] = [
			...selectedTools.map(({ tool }) => ({
				tool,
				inputSchema: tool.inputSchema,
				enhancedDescription: this.buildEnhancedDescription(tool),
			})),
			...externalTools.map((tool) => {
				const externalDefinition: ToolDefinition = {
					name: tool.name,
					serverId: tool.serverId,
					serverName: tool.serverId,
					category: 'utility',
					summary: tool.description || 'External MCP tool.',
					coreCapabilities: ['Call the external MCP tool as documented by its server.'],
					limitations: ['Only raw server-provided metadata is available for this external tool.'],
					scenarios: {
						primary: ['Use when the task clearly matches this external tool.'],
						secondary: ['Fallback external integration.'],
						antiPatterns: ['Do not guess arguments when the external schema is unclear.'],
					},
					inputSchema: tool.inputSchema,
					parameterGuide: {},
					bestPractices: ['Validate required parameters carefully.'],
					commonCombinations: [],
					returnType: {
						description: 'External tool result serialized as text.',
						examples: [{ scenario: 'Generic external call', output: 'Server-defined result' }],
						errorCases: [
							{
								condition: 'Server rejects the request',
								errorMessage: 'External tool execution error',
								resolution: 'Adjust arguments to the server schema or ask for clarification.',
							},
						],
					},
					searchKeywords: [],
					intentPatterns: [],
				};
				return {
					tool: externalDefinition,
					inputSchema: tool.inputSchema,
					enhancedDescription: [
						tool.description || 'External MCP tool.',
						`Server: ${tool.serverId}`,
						'Note: only raw server metadata is available for this external tool.',
					].join('\n'),
				};
			}),
		];

		const constraintLines = [
			`readOnly=${request.constraints?.readOnly === true ? 'true' : 'false'}`,
			`maxToolCalls=${request.constraints?.maxToolCalls ?? 10}`,
			`timeoutMs=${request.constraints?.timeoutMs ?? 30000}`,
			`allowShell=${request.constraints?.allowShell === true ? 'true' : 'false'}`,
			`allowScript=${request.constraints?.allowScript === true ? 'true' : 'false'}`,
		];

		const systemPrompt = [
			'You are a specialized tool execution agent.',
			'Choose from the provided tools only, construct valid arguments, execute carefully, and stop when the task is complete.',
			'Rules:',
			'- Respect the provided constraints exactly.',
			'- Before each call, verify required arguments and avoid anti-patterns.',
			'- If a tool fails because of bad arguments, adjust once and retry at most one time.',
			'- If the task is ambiguous or a required target/path/value is missing, stop and return a clarification response instead of guessing.',
			'- When the task is done, return JSON only.',
			'- JSON format: {"status":"success|partial|failed|needs_clarification","summary":"...","data":...,"clarificationNeeded":"... or omitted"}',
			'Available tools:',
			...toolContexts.map((context) => {
				const tool = context.tool;
				return [
					`## ${tool.name} (${tool.serverName})`,
					`summary: ${tool.summary}`,
					`capabilities: ${tool.coreCapabilities.slice(0, 4).join(' | ')}`,
					`limitations: ${tool.limitations.slice(0, 4).join(' | ')}`,
					`antiPatterns: ${tool.scenarios.antiPatterns.slice(0, 3).join(' | ')}`,
					`bestPractices: ${tool.bestPractices.slice(0, 3).join(' | ')}`,
					'parameters:',
					formatParameterGuide(tool),
				].join('\n');
			}),
		].join('\n\n');

		const userPrompt = [
			`Task: ${request.task}`,
			`Constraints: ${constraintLines.join(', ')}`,
			request.hints?.likelyServerIds?.length ? `Likely/allowed servers: ${request.hints.likelyServerIds.join(', ')}` : '',
			request.hints?.suggestedTools?.length ? `Suggested tools: ${request.hints.suggestedTools.join(', ')}` : '',
			request.hints?.domain ? `Domain hint: ${request.hints.domain}` : '',
			request.context?.activeFilePath ? `Active file: ${request.context.activeFilePath}` : '',
			request.context?.selectedText ? `Selected text:\n${request.context.selectedText}` : '',
			request.context?.relevantPaths?.length ? `Relevant paths: ${request.context.relevantPaths.join(', ')}` : '',
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			systemPrompt,
			userPrompt,
			modelTools: toolContexts,
		};
	}

	private buildEnhancedDescription(tool: ToolDefinition): string {
		return [
			tool.summary,
			`Capabilities: ${tool.coreCapabilities.slice(0, 4).join(' | ')}`,
			`Limitations: ${tool.limitations.slice(0, 4).join(' | ')}`,
			`Primary scenarios: ${tool.scenarios.primary.slice(0, 3).join(' | ')}`,
			`Avoid: ${tool.scenarios.antiPatterns.slice(0, 3).join(' | ')}`,
			`Best practices: ${tool.bestPractices.slice(0, 3).join(' | ')}`,
		].join('\n');
	}
}
