import {
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	defineTool,
	englishAndChinese,
	guide,
	jsonArray,
	jsonInteger,
	jsonObject,
	jsonString,
	parameterExample,
} from './helpers';
import type { ToolDefinition } from './types';

const serverId = BUILTIN_TOOL_SEARCH_SERVER_ID;
const serverName = BUILTIN_TOOL_SEARCH_SERVER_NAME;

export const toolSearchToolDefinitions: ToolDefinition[] = [
	defineTool({
		name: 'find_tool',
		serverId,
		serverName,
		category: 'utility',
		summary: 'Search the legacy Tool Search catalog for the best matching tool candidates for a task.',
		coreCapabilities: [
			'Return ranked tool candidates for a natural-language task description.',
			'Filter by server ids or categories when supplied.',
			'Expose decision guidance, parameter summaries, and one inline example.',
			'Serve as a fallback discovery layer when the new registry-based selector is unavailable.',
		],
		limitations: [
			'Returns recommendations, not full execution.',
			'Depends on legacy tool-library metadata quality.',
			'Less expressive than the new Tool Registry design.',
			'Not intended to remain in the main-model context once Tool Call Agent is enabled.',
		],
		scenarios: {
			primary: [
				'Fallback tool discovery when the dedicated selector is disabled or unavailable.',
				'Manual advanced-user exploration of legacy tool search.',
				'Compatibility path for the old two-phase controller.',
			],
			secondary: [
				'Debug legacy tool ranking.',
				'Inspect what the old system would have selected.',
				'Constrain recommendations to certain servers or categories.',
			],
			antiPatterns: [
				'Do not use it when the new Tool Registry already gives a direct tool choice.',
				'Do not expect it to execute multi-step tasks by itself.',
				'Do not use it as a substitute for reading real tool definitions after selection.',
			],
		},
		inputSchema: jsonObject(
			{
				task: jsonString('Task description.'),
				serverIds: jsonArray('Optional server id filters.', jsonString('Server id.')),
				categories: jsonArray('Optional category filters.', jsonString('Category name.')),
				limit: jsonInteger('Maximum number of candidate tools.', {
					minimum: 1,
					maximum: 20,
				}),
			},
			['task']
		),
		parameterGuide: {
			task: guide(
				'Natural-language task description for tool discovery.',
				[
					parameterExample('Find notes about release planning and summarize them.', 'Search for a reading-oriented workflow.'),
				],
				[
					'Describe the goal, target, and action clearly.',
				]
			),
			serverIds: guide(
				'Optional list of server ids to restrict discovery.',
				[
					parameterExample(['__builtin__:vault-tools'], 'Only search Vault tools.'),
				],
				[
					'Useful when the caller already knows the execution domain.',
				]
			),
			categories: guide(
				'Optional legacy category filters.',
				[
					parameterExample(['search'], 'Only search search-oriented tools.'),
				],
				[
					'Use sparingly; overly narrow category filters can hide the right tool.',
				]
			),
			limit: guide(
				'Maximum number of recommendations to return.',
				[
					parameterExample(3, 'Normal top-three recommendations.'),
					parameterExample(5, 'Wider candidate list for comparison.'),
				],
				[
					'Keep the limit low unless you are debugging the ranking.',
				],
				{
					defaultBehavior: 'Defaults to 3.',
				}
			),
		},
		bestPractices: [
			'Use it only as a fallback or legacy compatibility path.',
			'Follow it with `get_tool_info` or direct execution once a tool is chosen.',
		],
		performanceTips: [
			'Low limits keep the legacy search payload concise.',
		],
		safetyNotes: [
			'Discovery-only tool; no mutations occur.',
		],
		commonCombinations: [
			{
				tools: ['find_tool', 'get_tool_info'],
				pattern: 'Legacy discover then inspect',
				example: 'Find candidate tools first, then inspect the chosen tool in detail.',
			},
		],
		prerequisites: [
			'Prefer the new registry-backed selector when available.',
		],
		followUps: [
			'Use `get_tool_info` or the real tool after choosing a candidate.',
		],
		returnType: {
			description: 'Returns a formatted text ranking of legacy tool matches.',
			examples: [
				{
					scenario: 'Top tool list',
					output: '# Tool Search\n\n以下是与“读取日报”最匹配的工具：\n\n## 1. read_file\n...',
				},
			],
			errorCases: [
				{
					condition: 'No tools match the task',
					errorMessage: '未找到与“...”匹配的工具。',
					resolution: 'Rewrite the task or use a broader search description.',
				},
				{
					condition: 'Legacy tool library is unavailable',
					errorMessage: 'ToolLibraryManager not initialized.',
					resolution: 'Reinitialize the legacy tool library or use the new registry.',
				},
				{
					condition: 'The query is empty',
					errorMessage: 'Validation error for required task string.',
					resolution: 'Provide a non-empty task description.',
				},
			],
		},
		searchKeywords: englishAndChinese('find tool', 'legacy tool search', '查工具', '找工具', '工具搜索'),
		intentPatterns: englishAndChinese('which tool should I use', 'find the right tool', '应该用哪个工具', '帮我找工具'),
	}),
	defineTool({
		name: 'get_tool_info',
		serverId,
		serverName,
		category: 'utility',
		summary: 'Fetch the full legacy Tool Search documentation for one named tool.',
		coreCapabilities: [
			'Return the detailed legacy Markdown/tool-library view for a specific tool.',
			'Expose parameters, examples, and supplemental notes.',
			'Provide a fallback tool-doc lookup path.',
			'Help inspect a legacy tool after candidate selection.',
		],
		limitations: [
			'Requires the exact tool name.',
			'Depends on legacy tool-library metadata rather than the new registry.',
			'Does not execute the tool.',
			'Documentation quality is limited by the old seed format.',
		],
		scenarios: {
			primary: [
				'Need full legacy documentation for a chosen tool.',
				'Need to inspect parameter expectations before manual execution.',
				'Need fallback docs when the new registry is unavailable.',
			],
			secondary: [
				'Debug old tool descriptions.',
				'Compare legacy metadata against the new ToolDefinition.',
				'Inspect a tool after `find_tool` recommends it.',
			],
			antiPatterns: [
				'Do not use it as a replacement for the real tool execution.',
				'Do not use it when the tool name is still unknown.',
				'Do not prefer it over the new registry in the normal Tool Call Agent path.',
			],
		},
		inputSchema: jsonObject(
			{
				name: jsonString('Exact tool name to inspect.'),
			},
			['name']
		),
		parameterGuide: {
			name: guide(
				'Exact tool name.',
				[
					parameterExample('read_file', 'Inspect the legacy docs for read_file.'),
				],
				[
					'Use the exact registered name, preferably from `find_tool` output.',
				]
			),
		},
		bestPractices: [
			'Use it after `find_tool`, not before discovery.',
			'Treat it as a fallback documentation source rather than the new source of truth.',
		],
		performanceTips: [
			'Only request docs for the tool you actually intend to inspect.',
		],
		safetyNotes: [
			'Read-only documentation lookup.',
		],
		commonCombinations: [
			{
				tools: ['find_tool', 'get_tool_info'],
				pattern: 'Legacy discovery flow',
				example: 'Find candidate tools, then open the docs for the best one.',
			},
		],
		prerequisites: [
			'Know the tool name, ideally from `find_tool` output.',
		],
		followUps: [
			'Execute the actual tool after confirming the docs.',
		],
		returnType: {
			description: 'Returns a formatted legacy documentation block for the tool.',
			examples: [
				{
					scenario: 'Known tool',
					output: '# read_file\n- 服务器：...\n## 参数说明\n...',
				},
			],
			errorCases: [
				{
					condition: 'Unknown tool name',
					errorMessage: '未找到工具：...',
					resolution: 'Call `find_tool` first or correct the tool name.',
				},
				{
					condition: 'Legacy library entry missing',
					errorMessage: 'Tool not found in legacy library.',
					resolution: 'Rebuild the tool library or use the new registry.',
				},
				{
					condition: 'Name is empty',
					errorMessage: 'Validation error for required name string.',
					resolution: 'Provide a concrete tool name.',
				},
			],
		},
		searchKeywords: englishAndChinese('get tool info', 'tool docs', '获取工具信息', '工具文档', '查看工具说明'),
		intentPatterns: englishAndChinese('show tool info', 'open the tool docs', '查看工具详情', '打开工具说明'),
	}),
	defineTool({
		name: 'list_tools',
		serverId,
		serverName,
		category: 'utility',
		summary: 'List the legacy Tool Search catalog, optionally filtered by server ids or categories.',
		coreCapabilities: [
			'List the legacy tool catalog grouped by server and category.',
			'Support optional server-id and category filters.',
			'Provide a fallback browsing path for advanced users.',
			'Expose what the old two-phase system considered available.',
		],
		limitations: [
			'Lists legacy catalog entries, not the new registry only.',
			'Documentation and category granularity follow the old format.',
			'Does not score or recommend tools by task.',
			'Does not execute tools.',
		],
		scenarios: {
			primary: [
				'Need to browse the old catalog manually.',
				'Need to inspect which tools belong to a certain server or category.',
				'Need a fallback tool inventory view.',
			],
			secondary: [
				'Debug legacy grouping and metadata.',
				'Compare legacy catalog coverage against the new registry.',
				'Explore all tools under one domain manually.',
			],
			antiPatterns: [
				'Do not use it when you already have a concrete task; `find_tool` is better.',
				'Do not treat it as the primary main-model interface after Tool Call Agent rollout.',
				'Do not expect execution or ranking.',
			],
		},
		inputSchema: jsonObject({
			serverIds: jsonArray('Optional server id filters.', jsonString('Server id.')),
			categories: jsonArray('Optional legacy category filters.', jsonString('Category name.')),
		}),
		parameterGuide: {
			serverIds: guide(
				'Optional server ids to restrict the list.',
				[
					parameterExample(['__builtin__:vault-tools'], 'List only Vault tools.'),
				],
				[
					'Leave empty to see the whole catalog.',
				]
			),
			categories: guide(
				'Optional legacy categories to restrict the list.',
				[
					parameterExample(['search'], 'List only search tools.'),
				],
				[
					'Use only when you already know the approximate tool family.',
				]
			),
		},
		bestPractices: [
			'Use this for manual browsing and debugging, not task execution.',
			'Prefer `find_tool` when the starting point is a task rather than a catalog exploration.',
		],
		performanceTips: [
			'Apply filters to keep the list readable when browsing legacy entries.',
		],
		safetyNotes: [
			'Read-only catalog view.',
		],
		commonCombinations: [
			{
				tools: ['list_tools', 'get_tool_info'],
				pattern: 'Browse then inspect',
				example: 'List the catalog, then inspect one tool in detail.',
			},
		],
		prerequisites: [
			'Prefer the new registry-driven selector for normal execution paths.',
		],
		followUps: [
			'Use `get_tool_info` or the actual tool after browsing.',
		],
		returnType: {
			description: 'Returns a formatted legacy catalog list grouped by server/category.',
			examples: [
				{
					scenario: 'Filtered list',
					output: '# Tool List\n\n## 内置 Vault 工具 / file\n- `read_file`：...',
				},
			],
			errorCases: [
				{
					condition: 'No entries match the filters',
					errorMessage: '未找到符合筛选条件的工具。',
					resolution: 'Remove or relax the filters.',
				},
				{
					condition: 'Legacy library is unavailable',
					errorMessage: 'Tool library could not be read.',
					resolution: 'Reinitialize the legacy library or use the new registry.',
				},
				{
					condition: 'Filters are too narrow',
					errorMessage: 'List is empty.',
					resolution: 'Try browsing by server only or no filters.',
				},
			],
		},
		searchKeywords: englishAndChinese('list tools', 'tool catalog', '列出工具', '工具清单', '浏览工具库'),
		intentPatterns: englishAndChinese('show all tools', 'browse the tool catalog', '列出所有工具', '浏览工具列表'),
	}),
];
