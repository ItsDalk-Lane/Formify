import {
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	defineTool,
	englishAndChinese,
	guide,
	jsonBoolean,
	jsonInteger,
	jsonObject,
	jsonString,
	parameterExample,
} from './helpers';
import type { ToolDefinition } from './types';

export const thinkingToolDefinitions: ToolDefinition[] = [
	defineTool({
		name: 'sequentialthinking',
		serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
		serverName: BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
		category: 'thinking',
		summary: 'Advance a structured multi-step reasoning trace with support for revisions, branching, and continuation.',
		coreCapabilities: [
			'Record one reasoning step at a time with explicit numbering.',
			'Support revisions to prior thoughts and branch-based exploration.',
			'Allow the thinker to extend the total thought count dynamically.',
			'Return a compact state summary after each reasoning step.',
		],
		limitations: [
			'It records reasoning progress but does not execute external work by itself.',
			'Requires explicit thought payload structure rather than free-form prose alone.',
			'State is session-local to the current sequential thinking runtime.',
			'Overuse can waste tool calls when a direct decision is already clear.',
		],
		scenarios: {
			primary: [
				'Need explicit stepwise reasoning for a complex problem.',
				'Need to revise or branch from prior thoughts during analysis.',
				'Need a structured chain-of-thought scaffold before final action.',
			],
			secondary: [
				'Break down a large planning or debugging problem.',
				'Test alternative branches before committing to a conclusion.',
				'Keep a lightweight reasoning state across several analysis turns.',
			],
			antiPatterns: [
				'Do not use it for trivial one-step decisions.',
				'Do not confuse it with file, memory, or shell execution.',
				'Do not omit required numbering fields.',
			],
		},
		inputSchema: jsonObject(
			{
				thought: jsonString('Current reasoning step text.'),
				nextThoughtNeeded: jsonBoolean('Whether another reasoning step is needed.'),
				thoughtNumber: jsonInteger('Current thought index.', { minimum: 1 }),
				totalThoughts: jsonInteger('Expected total thought count.', { minimum: 1 }),
				isRevision: jsonBoolean('Whether this step revises a prior thought.'),
				revisesThought: jsonInteger('Prior thought index being revised.', { minimum: 1 }),
				branchFromThought: jsonInteger('Thought index this branch starts from.', { minimum: 1 }),
				branchId: jsonString('Branch identifier.'),
				needsMoreThoughts: jsonBoolean('Whether more thoughts are needed beyond the current total.'),
			},
			['thought', 'nextThoughtNeeded', 'thoughtNumber', 'totalThoughts']
		),
		parameterGuide: {
			thought: guide(
				'The current reasoning step content.',
				[
					parameterExample('Break the task into three major workstreams.', 'Normal analytical step.'),
					parameterExample('Previous assumption was wrong because the path is outdated.', 'Revision content.'),
				],
				[
					'Keep each thought focused on one reasoning move.',
					'Use plain text that a later step can build on.',
				]
			),
			nextThoughtNeeded: guide(
				'Whether the reasoning process should continue.',
				[
					parameterExample(true, 'Continue thinking after this step.'),
					parameterExample(false, 'Stop because the reasoning is complete.'),
				],
				[
					'Set to false only when the current branch is genuinely complete.',
				]
			),
			thoughtNumber: guide(
				'Current step number.',
				[
					parameterExample(1, 'First thought.'),
					parameterExample(4, 'Fourth thought in the sequence.'),
				],
				[
					'Increment for forward progress.',
					'Use revision/branch metadata when the flow is non-linear.',
				]
			),
			totalThoughts: guide(
				'Expected total number of thoughts for the current reasoning pass.',
				[
					parameterExample(5, 'Plan for five steps.'),
					parameterExample(8, 'Expand the plan when the problem is deeper than expected.'),
				],
				[
					'It can be increased later if the task turns out larger than expected.',
				]
			),
			isRevision: guide(
				'Marks the current thought as a revision.',
				[
					parameterExample(true, 'This thought revises an earlier one.'),
				],
				[
					'Pair it with `revisesThought` when revising history.',
				]
			),
			revisesThought: guide(
				'Which prior thought is being revised.',
				[
					parameterExample(2, 'Revise thought number 2.'),
				],
				[
					'Only meaningful when `isRevision=true`.',
				]
			),
			branchFromThought: guide(
				'Which prior thought this branch diverges from.',
				[
					parameterExample(3, 'Branch from thought 3.'),
				],
				[
					'Use together with `branchId` for branch tracking.',
				]
			),
			branchId: guide(
				'Identifier for the branch.',
				[
					parameterExample('alt-a', 'Alternative branch A.'),
				],
				[
					'Keep branch ids short and stable within the reasoning session.',
				]
			),
			needsMoreThoughts: guide(
				'Signal that the planned total was too small.',
				[
					parameterExample(true, 'Reasoning needs more steps than initially expected.'),
				],
				[
					'Use it when you are near the end but still need more analysis.',
				]
			),
		},
		bestPractices: [
			'Use it for genuinely complex reasoning where explicit structure helps.',
			'Keep each step incremental and auditable.',
			'Revise or branch explicitly instead of overloading one thought with conflicting reasoning.',
		],
		performanceTips: [
			'Avoid unnecessary sequential thinking calls once the solution is clear.',
			'Use focused thought text to keep the reasoning trace useful.',
		],
		safetyNotes: [
			'Reasoning-only tool; it does not read or mutate user data directly.',
		],
		commonCombinations: [
			{
				tools: ['sequentialthinking', 'write_plan'],
				pattern: 'Reason then plan',
				example: 'Use explicit reasoning to decompose the task before updating the live plan.',
			},
			{
				tools: ['sequentialthinking', 'query_vault'],
				pattern: 'Reason then query',
				example: 'Think through the search strategy before running a structured Vault query.',
			},
		],
		prerequisites: [
			'Choose it only when explicit reasoning structure adds value over direct action.',
		],
		followUps: [
			'Use the resulting reasoning state to drive plan updates or direct tool execution.',
		],
		returnType: {
			description: 'Returns JSON summarizing the current reasoning state, branch ids, history length, and recent thoughts.',
			examples: [
				{
					scenario: 'Normal intermediate thought',
					output:
						'{"thoughtNumber":2,"totalThoughts":5,"nextThoughtNeeded":true,"branches":[],"thoughtHistoryLength":2,"currentThought":"Need to inspect provider differences","recentThoughts":["Map the architecture","Need to inspect provider differences"]}',
				},
			],
			errorCases: [
				{
					condition: 'Required fields are missing',
					errorMessage: 'Validation error for thought payload.',
					resolution: 'Provide `thought`, `nextThoughtNeeded`, `thoughtNumber`, and `totalThoughts`.',
				},
				{
					condition: 'A numeric field is below 1',
					errorMessage: 'Integer minimum validation failed.',
					resolution: 'Use 1-based numbering for thought indices.',
				},
				{
					condition: 'Internal runtime error occurs',
					errorMessage: '{"error":"...","status":"failed"}',
					resolution: 'Retry with a smaller, valid payload or reset the reasoning flow.',
				},
			],
		},
		searchKeywords: englishAndChinese('sequential thinking', 'reasoning steps', '顺序思考', '分步推理', '思维链'),
		intentPatterns: englishAndChinese('think step by step', 'use structured reasoning', '一步一步思考', '分步推理这个问题'),
	}),
];
