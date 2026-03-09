import {
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	defineTool,
	enumSchema,
	englishAndChinese,
	guide,
	jsonBoolean,
	jsonInteger,
	jsonObject,
	jsonString,
	parameterExample,
} from './helpers';
import type { ToolDefinition } from './types';

const serverId = BUILTIN_OBSIDIAN_SEARCH_SERVER_ID;
const serverName = BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME;

const commonSearchProperties = {
	maxResults: jsonInteger('Maximum number of matched files to return.', {
		minimum: 1,
	}),
	sortBy: enumSchema('Sort order.', [
		'path-asc',
		'path-desc',
		'mtime-new',
		'mtime-old',
		'ctime-new',
		'ctime-old',
	]),
	contextLines: jsonInteger('Number of context lines around each textual match.', {
		minimum: 0,
	}),
	explain: jsonBoolean('Whether to include a natural-language explanation of the parsed query.'),
};

const commonSearchGuides = {
	maxResults: guide(
		'Upper bound for matched files in the response.',
		[
			parameterExample(10, 'Tight result set for focused inspection.'),
			parameterExample(50, 'Broader search when exploring.'),
		],
		[
			'Lower values keep the tool loop compact.',
			'Raise the value only when you actually need broader recall.',
		],
		{
			defaultBehavior: 'Defaults to the built-in search engine limit.',
		}
	),
	sortBy: guide(
		'How result files are ordered.',
		[
			parameterExample('mtime-new', 'Show recently modified files first.'),
			parameterExample('path-asc', 'Sort deterministically by path.'),
		],
		[
			'Use modification time when freshness matters.',
			'Use path order when you want deterministic scanning.',
		],
		{
			defaultBehavior: 'Defaults to `mtime-new`.',
		}
	),
	contextLines: guide(
		'How many surrounding lines to include around a content hit.',
		[
			parameterExample(0, 'Only the matched line or exact hit.'),
			parameterExample(2, 'Include nearby context for interpretation.'),
		],
		[
			'Set to 0 for compact result payloads.',
			'Increase only when textual context is important.',
		],
		{
			defaultBehavior: 'Defaults to the built-in search engine context line count.',
		}
	),
	explain: guide(
		'Whether to include a natural-language explanation of query parsing.',
		[
			parameterExample(false, 'Fast normal search.'),
			parameterExample(true, 'Debug how a complex query is interpreted.'),
		],
		[
			'Useful when debugging operator-heavy search expressions.',
		],
		{
			defaultBehavior: 'Defaults to `false`.',
		}
	),
};

const searchReturnType = {
	description:
		'Returns a search result object with the normalized query, matched files, match totals, truncation flag, and optional explanation.',
	examples: [
		{
			scenario: 'Regular content search',
			output:
				'{"query":"content:(roadmap)","results":[{"path":"projects/roadmap.md","matches":[...]}],"totalFiles":1,"totalMatches":3,"truncated":false}',
		},
		{
			scenario: 'Truncated broad search',
			output:
				'{"query":"file:(project)","results":[...],"totalFiles":50,"totalMatches":120,"truncated":true}',
		},
	],
	errorCases: [
		{
			condition: 'Query syntax is invalid',
			errorMessage: 'Search parser error or invalid operator usage.',
			resolution: 'Simplify the query or use a narrower dedicated search tool.',
		},
		{
			condition: 'Regex or property comparator is invalid',
			errorMessage: 'Invalid search expression component.',
			resolution: 'Fix the regex/comparator and retry.',
		},
		{
			condition: 'The search is too broad and gets truncated',
			errorMessage: 'Search result is truncated.',
			resolution: 'Narrow the scope, lower maxResults, or switch to a more specific search tool.',
		},
	],
};

const createScopedSearchTool = (config: {
	name: string;
	summary: string;
	operatorSummary: string;
	scopeDescription: string;
	primary: string[];
	secondary: string[];
	antiPatterns: string[];
	queryExamples: Array<{ value: string; description: string }>;
	searchKeywords: string[];
	intentPatterns: string[];
	commonCombinations: ToolDefinition['commonCombinations'];
}): ToolDefinition =>
	defineTool({
		name: config.name,
		serverId,
		serverName,
		category: 'search',
		summary: config.summary,
		coreCapabilities: [
			config.scopeDescription,
			'Support sorting, result limiting, and optional explanation output.',
			'Integrate with the Obsidian search engine instead of manual file scanning.',
			'Return structured hits that can drive follow-up file inspection.',
		],
		limitations: [
			'Requires a query string rather than vague natural-language intent.',
			'Returns search hits, not final task completion by itself.',
			'May be overly broad if used instead of a more specific scope-aware tool.',
			'Does not mutate files or folders.',
		],
		scenarios: {
			primary: config.primary,
			secondary: config.secondary,
			antiPatterns: config.antiPatterns,
		},
		inputSchema: jsonObject(
			{
				query: jsonString('Search query or subquery.'),
				...commonSearchProperties,
			},
			['query']
		),
		parameterGuide: {
			query: guide(
				config.operatorSummary,
				config.queryExamples.map((item) => parameterExample(item.value, item.description)),
				[
					'Use a focused query and let the scope-specific tool handle the correct operator.',
					'Switch to `advanced_search` when you truly need full search syntax control.',
				],
				{
					commonMistakes: [
						'Using a broad generic query when a more specific search tool exists.',
						'Expecting search hits to include full file bodies automatically.',
					],
				}
			),
			...commonSearchGuides,
		},
		bestPractices: [
			'Pick the narrowest scope-aware search tool that matches the intent.',
			'Use search results to decide what to read or open next instead of guessing paths.',
			'Ask for `explain=true` only when debugging a complex query.',
		],
		performanceTips: [
			'Narrow scopes reduce result noise and token-heavy payloads.',
			'Use result limiting aggressively before opening or reading many files.',
		],
		safetyNotes: [
			'Read-only search tool.',
			'Result payloads can become large and should be truncated before feeding back into the model.',
		],
		commonCombinations: config.commonCombinations,
		prerequisites: [
			'Know whether you are searching names, paths, tags, tasks, properties, or body content.',
		],
		followUps: [
			'Use `read_file` or `open_file` on selected paths after search.',
			'Use `write_file` only after inspecting and confirming the correct target note.',
		],
		returnType: searchReturnType,
		searchKeywords: englishAndChinese(...config.searchKeywords),
		intentPatterns: englishAndChinese(...config.intentPatterns),
	});

export const searchToolDefinitions: ToolDefinition[] = [
	createScopedSearchTool({
		name: 'search_files',
		summary: 'Search file names only, without matching body text.',
		operatorSummary: 'File-name query or subquery.',
		scopeDescription: 'Search only the `file:` scope, which focuses on note names and titles.',
		primary: [
			'User knows the title or filename but not the path.',
			'Need to find notes by naming convention.',
			'Need file-level discovery without body-text noise.',
		],
		secondary: [
			'Locate daily notes or templates by predictable filenames.',
			'Confirm whether a file name already exists before writing.',
			'Narrow a workspace before opening or moving a note.',
		],
		antiPatterns: [
			'Do not use it when the clue lives in note content rather than the title.',
			'Do not use it to search paths or folder names specifically.',
			'Do not expect task or tag semantics.',
		],
		queryExamples: [
			{ value: 'roadmap', description: 'Find notes with roadmap in the file name.' },
			{ value: '"release notes"', description: 'Find exact multi-word file names.' },
		],
		searchKeywords: ['search files', 'file name search', '按文件名查找', '文件名搜索', '标题搜索'],
		intentPatterns: ['find files by name', 'search the note title', '按标题找笔记', '按文件名搜索'],
		commonCombinations: [
			{
				tools: ['search_files', 'open_file'],
				pattern: 'Find by name then open',
				example: 'Search for a note title and open the chosen match in Obsidian.',
			},
			{
				tools: ['search_files', 'read_file'],
				pattern: 'Find by title then inspect',
				example: 'Find a candidate note by name and read it before editing.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_path',
		summary: 'Search complete file paths when directory structure is the main clue.',
		operatorSummary: 'Path-oriented query or subquery.',
		scopeDescription: 'Search only the `path:` scope, which matches full Vault-relative paths.',
		primary: [
			'User remembers a folder path fragment.',
			'Need to search by directory hierarchy instead of title.',
			'Need to target notes under a known path pattern.',
		],
		secondary: [
			'Find files under a client or project subtree.',
			'Disambiguate duplicate file names by directory.',
			'Verify that a destination path pattern exists before moving files.',
		],
		antiPatterns: [
			'Do not use it when only the note title is known.',
			'Do not use it for pure body text discovery.',
			'Do not expect folder-name-only semantics when `search_folder` is clearer.',
		],
		queryExamples: [
			{ value: 'projects/client-a', description: 'Find files under a client path.' },
			{ value: '"daily/2026"', description: 'Match a precise path fragment.' },
		],
		searchKeywords: ['search path', 'path search', '完整路径搜索', '路径片段', '目录层级搜索'],
		intentPatterns: ['find by path', 'search this folder path', '按路径找文件', '我记得目录结构'],
		commonCombinations: [
			{
				tools: ['search_path', 'move_file'],
				pattern: 'Resolve path then reorganize',
				example: 'Find the exact current path before moving the note elsewhere.',
			},
			{
				tools: ['search_path', 'list_directory'],
				pattern: 'Find subtree then browse',
				example: 'Search for a known path fragment, then list the direct folder contents.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_folder',
		summary: 'Search folder names and folder-related locations when the directory name is the clue.',
		operatorSummary: 'Folder-name query or subquery.',
		scopeDescription: 'Search only the `folder:` scope, which emphasizes directory names.',
		primary: [
			'User remembers the folder name but not the exact path.',
			'Need to locate a workspace area by directory name.',
			'Need folder-focused discovery before browsing direct contents.',
		],
		secondary: [
			'Find archive or inbox areas by name.',
			'Locate folders for subsequent listing or file creation.',
			'Disambiguate path searches that are really folder-oriented.',
		],
		antiPatterns: [
			'Do not use it for file titles.',
			'Do not use it when you already know the exact folder path; list it directly.',
			'Do not use it for body-text search.',
		],
		queryExamples: [
			{ value: 'archive', description: 'Find folders named archive.' },
			{ value: '"client a"', description: 'Find a folder with an exact multi-word name.' },
		],
		searchKeywords: ['search folder', 'folder search', '文件夹搜索', '目录名称', '找目录'],
		intentPatterns: ['find the folder', 'search folder names', '按目录名找', '找到这个文件夹'],
		commonCombinations: [
			{
				tools: ['search_folder', 'list_directory'],
				pattern: 'Find folder then browse',
				example: 'Search a folder name, then list its direct contents.',
			},
			{
				tools: ['search_folder', 'write_file'],
				pattern: 'Find folder then write',
				example: 'Locate the target folder before creating a note inside it.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_content',
		summary: 'Search note body text only, excluding file names and paths.',
		operatorSummary: 'Body-text query or subquery.',
		scopeDescription: 'Search only the `content:` scope, which targets note body text.',
		primary: [
			'User asks for notes that mention a phrase in the body.',
			'Need content discovery independent of note titles.',
			'Need to find the note that contains a specific sentence or term.',
		],
		secondary: [
			'Identify source notes before summarization.',
			'Find a paragraph or concept across many notes.',
			'Locate the right note before reading the full content.',
		],
		antiPatterns: [
			'Do not use it for title-only lookup.',
			'Do not use it for tag or task semantics when dedicated tools exist.',
			'Do not use it for path hierarchy clues.',
		],
		queryExamples: [
			{ value: 'release checklist', description: 'Find notes mentioning a phrase in body text.' },
			{ value: '/API\\s+limit/i', description: 'Regex search in content.' },
		],
		searchKeywords: ['search content', 'full text search', '正文搜索', '全文搜索', '内容检索'],
		intentPatterns: ['find notes mentioning', 'search inside note text', '正文里搜', '查内容包含什么'],
		commonCombinations: [
			{
				tools: ['search_content', 'read_file'],
				pattern: 'Find text then inspect note',
				example: 'Search body text, then read the best-matching note in full.',
			},
			{
				tools: ['search_content', 'write_plan'],
				pattern: 'Find evidence then plan',
				example: 'Search for all relevant notes before turning the work into a plan.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_tags',
		summary: 'Search files by tags using the dedicated tag scope.',
		operatorSummary: 'Tag search query or subquery.',
		scopeDescription: 'Search the `tag:` scope, which matches extracted note tags instead of raw body text.',
		primary: [
			'User explicitly refers to a tag or `#tag` filter.',
			'Need tag-based grouping or recall.',
			'Need notes organized by metadata-like tag semantics.',
		],
		secondary: [
			'Find all notes under a workflow tag.',
			'Locate tagged notes before reading or bulk processing them.',
			'Check whether a tag is actively used across the Vault.',
		],
		antiPatterns: [
			'Do not use it for raw body keywords that merely contain `#` characters.',
			'Do not use it for property filters.',
			'Do not use it when the user really means full content search.',
		],
		queryExamples: [
			{ value: '#project', description: 'Find notes with the project tag.' },
			{ value: 'meeting', description: 'Find notes tagged with meeting-like tags.' },
		],
		searchKeywords: ['search tags', 'tag search', '#tag', '标签搜索', '按标签查找'],
		intentPatterns: ['find notes tagged', 'search by tag', '按标签找笔记', '带这个标签的内容'],
		commonCombinations: [
			{
				tools: ['search_tags', 'read_file'],
				pattern: 'Find tagged note then inspect',
				example: 'Search by tag, then read the most relevant tagged note.',
			},
			{
				tools: ['search_tags', 'query_vault'],
				pattern: 'Tag discovery then metadata analysis',
				example: 'Use tag search for recall, then query metadata on the result set.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_line',
		summary: 'Require matching conditions to occur within the same line.',
		operatorSummary: 'Line-scoped query or subquery.',
		scopeDescription: 'Search the `line:` scope, which keeps matches constrained to one line.',
		primary: [
			'Need same-line co-occurrence in logs, CSV-like notes, or compact lists.',
			'Need to avoid false positives from cross-line matches.',
			'Need precise line-level recall for structured text.',
		],
		secondary: [
			'Search checklists or status lines.',
			'Match compact inline metadata patterns.',
			'Debug or audit one-line records across notes.',
		],
		antiPatterns: [
			'Do not use it for paragraph or section-level meaning.',
			'Do not expect heading-aware grouping.',
			'Do not use it when broad body search is sufficient.',
		],
		queryExamples: [
			{ value: 'status AND blocked', description: 'Require both tokens on one line.' },
			{ value: '"owner: alice"', description: 'Exact line-level phrase match.' },
		],
		searchKeywords: ['search line', 'same line search', '行级搜索', '同行匹配', '单行检索'],
		intentPatterns: ['same line', 'search one line', '同一行里找', '按行匹配'],
		commonCombinations: [
			{
				tools: ['search_line', 'read_file'],
				pattern: 'Pinpoint then inspect',
				example: 'Find an exact matching line, then read the file for full context.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_block',
		summary: 'Require matching conditions to occur within the same Markdown block.',
		operatorSummary: 'Block-scoped query or subquery.',
		scopeDescription: 'Search the `block:` scope, which groups content by Markdown blocks such as paragraphs or list items.',
		primary: [
			'Need block-level co-occurrence rather than same-line or whole-file matches.',
			'Need paragraph or list-item scoped matches.',
			'Need to avoid cross-block false positives.',
		],
		secondary: [
			'Search meeting bullet blocks.',
			'Find a paragraph that contains multiple concepts together.',
			'Search within list items or quote blocks.',
		],
		antiPatterns: [
			'Do not use it for whole-section semantics.',
			'Do not use it when one-line precision is required.',
			'Do not expect title or tag semantics.',
		],
		queryExamples: [
			{ value: 'risk AND mitigation', description: 'Both terms must appear in one block.' },
			{ value: '"deployment owner"', description: 'Exact phrase inside a Markdown block.' },
		],
		searchKeywords: ['search block', 'markdown block search', '块级搜索', '同一块', '段落搜索'],
		intentPatterns: ['same block', 'search this paragraph block', '同一块里找', '同一段里匹配'],
		commonCombinations: [
			{
				tools: ['search_block', 'read_file'],
				pattern: 'Block hit then inspect full note',
				example: 'Find a relevant paragraph block, then read the note around it.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'search_section',
		summary: 'Require matching conditions to occur within the same Markdown heading section.',
		operatorSummary: 'Section-scoped query or subquery.',
		scopeDescription: 'Search the `section:` scope, which groups matches under one heading section.',
		primary: [
			'Need co-occurrence within the same heading section.',
			'Need structural search over long Markdown notes.',
			'Need to avoid cross-section false positives.',
		],
		secondary: [
			'Find a section that mentions both risk and timeline.',
			'Locate related concepts inside the same chapter-like region.',
			'Search large specifications or meeting notes by section.',
		],
		antiPatterns: [
			'Do not use it for line-level precision.',
			'Do not use it when heading structure is irrelevant.',
			'Do not expect task or property semantics.',
		],
		queryExamples: [
			{ value: 'deadline AND owner', description: 'Both terms must occur in one section.' },
			{ value: '"release plan"', description: 'Find sections about release plans.' },
		],
		searchKeywords: ['search section', 'heading section search', '章节搜索', '标题下搜索', '同一章节'],
		intentPatterns: ['same section', 'under one heading', '同一章节里找', '同一标题下搜索'],
		commonCombinations: [
			{
				tools: ['search_section', 'read_file'],
				pattern: 'Section hit then full context',
				example: 'Locate the right section and then read the note for detailed editing.',
			},
		],
	}),
	defineTool({
		name: 'search_tasks',
		serverId,
		serverName,
		category: 'search',
		summary: 'Search Markdown tasks with optional status filtering for all, todo, or done tasks.',
		coreCapabilities: [
			'Search task text with `task`, `task-todo`, or `task-done` semantics.',
			'Filter results by all tasks, unfinished tasks, or completed tasks.',
			'Return structured search hits for task-driven workflows.',
			'Work better than plain content search when completion state matters.',
		],
		limitations: [
			'Focused on Markdown task semantics, not arbitrary checklist-like prose.',
			'Still requires a query string for the task text.',
			'Does not update task states by itself.',
			'Not the right tool for frontmatter properties or tags.',
		],
		scenarios: {
			primary: [
				'User asks for unfinished or completed tasks.',
				'Need task-aware discovery instead of plain content matching.',
				'Need to review todos related to a specific topic.',
			],
			secondary: [
				'Find completed implementation tasks before writing a summary.',
				'Locate stale todos across the Vault.',
				'Collect task evidence for a progress update.',
			],
			antiPatterns: [
				'Do not use it for non-task note content.',
				'Do not use it for tag or property filtering.',
				'Do not expect it to toggle task completion.',
			],
		},
		inputSchema: jsonObject(
			{
				query: jsonString('Task text query or subquery.'),
				taskStatus: enumSchema('Task status filter.', ['all', 'todo', 'done']),
				...commonSearchProperties,
			},
			['query']
		),
		parameterGuide: {
			query: guide(
				'Task text query.',
				[
					parameterExample('release', 'Find release-related tasks.'),
					parameterExample('"ship docs"', 'Find an exact task phrase.'),
				],
				[
					'Use task-specific text rather than the entire note topic when possible.',
				]
			),
			taskStatus: guide(
				'Whether to search all tasks, only unfinished tasks, or only finished tasks.',
				[
					parameterExample('todo', 'Find unfinished tasks only.'),
					parameterExample('done', 'Find completed tasks only.'),
				],
				[
					'Use `todo` for current worklists and `done` for retrospective reporting.',
				],
				{
					defaultBehavior: 'Defaults to `all`.',
				}
			),
			...commonSearchGuides,
		},
		bestPractices: [
			'Prefer this over generic content search whenever task status matters.',
			'Filter to `todo` for action lists and `done` for reporting.',
			'Use search hits to decide which note to read for full task context.',
		],
		performanceTips: [
			'Use status filters to reduce result set size quickly.',
		],
		safetyNotes: [
			'Read-only task discovery tool.',
		],
		commonCombinations: [
			{
				tools: ['search_tasks', 'read_file'],
				pattern: 'Find task then inspect note',
				example: 'Search unfinished tasks and read the note containing the most relevant task.',
			},
			{
				tools: ['search_tasks', 'write_plan'],
				pattern: 'Task evidence then planning',
				example: 'Search open tasks and turn them into a structured execution plan.',
			},
		],
		prerequisites: [
			'Use this only when the target is a Markdown task item rather than general prose.',
		],
		followUps: [
			'Use `read_file` for the containing note if broader context is needed.',
		],
		returnType: searchReturnType,
		searchKeywords: englishAndChinese('search tasks', 'todo search', '任务搜索', '待办搜索', '已完成任务'),
		intentPatterns: englishAndChinese('find todo items', 'search completed tasks', '查未完成任务', '找已完成待办'),
	}),
	defineTool({
		name: 'search_properties',
		serverId,
		serverName,
		category: 'search',
		summary: 'Search frontmatter properties with existence checks, equality, numeric comparisons, and null checks.',
		coreCapabilities: [
			'Search notes by frontmatter property existence.',
			'Compare property values using equality or numeric comparisons.',
			'Search for null property values explicitly.',
			'Provide a lighter-weight metadata filter than a full Vault DSL query.',
		],
		limitations: [
			'Only works on frontmatter-like properties, not arbitrary body text.',
			'Less expressive than `query_vault` for complex aggregations.',
			'Comparison values are passed as strings and interpreted by the search engine.',
			'Does not mutate properties.',
		],
		scenarios: {
			primary: [
				'Need to find notes with a specific frontmatter field or value.',
				'Need quick numeric or null property filtering.',
				'Need property search without writing a full DSL query.',
			],
			secondary: [
				'Locate notes missing an expected field.',
				'Find high-priority or highly rated notes by metadata.',
				'Build a targeted reading set from frontmatter filters.',
			],
			antiPatterns: [
				'Do not use it for body content or title search.',
				'Do not use it for multi-step aggregation logic where `query_vault` is clearer.',
				'Do not expect it to edit frontmatter values.',
			],
		},
		inputSchema: jsonObject(
			{
				property: jsonString('Frontmatter property name.'),
				value: jsonString('Optional property value; omitted means existence check.'),
				comparator: enumSchema('Comparison operator.', ['=', '>', '>=', '<', '<=', 'null']),
				...commonSearchProperties,
			},
			['property']
		),
		parameterGuide: {
			property: guide(
				'Frontmatter property key.',
				[
					parameterExample('status', 'Filter by workflow state.'),
					parameterExample('rating', 'Filter by a numeric field.'),
				],
				[
					'Use the exact frontmatter key name.',
				]
			),
			value: guide(
				'Property value to compare against.',
				[
					parameterExample('active', 'Exact value match.'),
					parameterExample('5', 'Numeric comparison value.'),
				],
				[
					'Omit it when you only care whether the property exists.',
					'Provide it when using comparison operators other than `null`.',
				]
			),
			comparator: guide(
				'Property comparison behavior.',
				[
					parameterExample('=', 'Exact equality.'),
					parameterExample('>=', 'Numeric greater-than-or-equal.'),
					parameterExample('null', 'Search empty or null values.'),
				],
				[
					'Leave it empty for a plain existence check.',
					'Use numeric operators only when the property value is comparable numerically.',
				]
			),
			...commonSearchGuides,
		},
		bestPractices: [
			'Use property search for quick metadata filters and `query_vault` for more complex logic.',
			'Be explicit about the comparator when numeric meaning matters.',
			'Follow property search with file reads only on the filtered result set.',
		],
		performanceTips: [
			'Property filters are a cheap way to shrink the candidate set before body-level work.',
		],
		safetyNotes: [
			'Read-only metadata filter.',
		],
		commonCombinations: [
			{
				tools: ['search_properties', 'read_file'],
				pattern: 'Metadata filter then inspect',
				example: 'Find notes with `status=active` and read the chosen ones.',
			},
			{
				tools: ['search_properties', 'query_vault'],
				pattern: 'Quick filter then deeper query',
				example: 'Use property search to validate field names before a full DSL query.',
			},
		],
		prerequisites: [
			'Know the frontmatter field name you want to filter on.',
		],
		followUps: [
			'Use `read_file` for the resulting notes if the body needs further analysis.',
		],
		returnType: searchReturnType,
		searchKeywords: englishAndChinese('search properties', 'frontmatter search', '属性搜索', '字段筛选', '元数据筛选'),
		intentPatterns: englishAndChinese('find notes where property equals', 'search frontmatter', '按属性筛选', '找 frontmatter 字段'),
	}),
	createScopedSearchTool({
		name: 'quick_search',
		summary: 'Run a general-purpose Obsidian search query without precommitting to a narrow scope.',
		operatorSummary: 'General search query supporting keywords, quotes, regex, and boolean operators.',
		scopeDescription: 'Search across the general search engine without forcing a special scope up front.',
		primary: [
			'Need a fast general search when the correct scope is not yet obvious.',
			'Need simple boolean, quoted, or regex search in one query.',
			'Need a broad exploratory search before narrowing down.',
		],
		secondary: [
			'Try a first-pass query before switching to a dedicated search tool.',
			'Quickly confirm whether a concept appears anywhere relevant.',
			'Run a generic lookup over mixed title/content cases.',
		],
		antiPatterns: [
			'Do not use it when a scope-specific search tool would be clearer and cheaper.',
			'Do not treat it as an advanced property or metadata query tool.',
			'Do not assume it understands vague prose better than structured queries.',
		],
		queryExamples: [
			{ value: 'release AND checklist', description: 'Boolean keyword search.' },
			{ value: '"post mortem"', description: 'Exact phrase search.' },
		],
		searchKeywords: ['quick search', 'general search', '快速搜索', '通用搜索', '关键词搜索'],
		intentPatterns: ['search quickly', 'look this up broadly', '快速搜一下', '通用查找'],
		commonCombinations: [
			{
				tools: ['quick_search', 'read_file'],
				pattern: 'Broad search then inspect',
				example: 'Run a general search, then read the most promising note.',
			},
			{
				tools: ['quick_search', 'advanced_search'],
				pattern: 'Explore then refine',
				example: 'Start with a broad search and graduate to advanced syntax when needed.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'advanced_search',
		summary: 'Run a full advanced Obsidian search expression when you need total control over operators and combinations.',
		operatorSummary: 'Full advanced search expression.',
		scopeDescription: 'Accept the full search syntax directly, without the helper tool constraining the operator scope.',
		primary: [
			'Need full manual control of Obsidian search syntax.',
			'Need complex operator composition beyond quick search.',
			'Already have a precise advanced query expression.',
		],
		secondary: [
			'Combine path, tag, property, and content operators in one expression.',
			'Debug or reproduce a known Obsidian query.',
			'Handle edge cases not well represented by scope-specific tools.',
		],
		antiPatterns: [
			'Do not use it when a simpler scope-specific tool is sufficient.',
			'Do not pass plain-language requests expecting automatic translation.',
			'Do not overuse it for simple keyword lookups.',
		],
		queryExamples: [
			{ value: 'path:(projects) AND tag:#active', description: 'Combine path and tag operators.' },
			{ value: 'content:(release) AND -tag:#archive', description: 'Mix scoped content and exclusion.' },
		],
		searchKeywords: ['advanced search', 'full query', '高级搜索', '复杂查询', '完整搜索语法'],
		intentPatterns: ['run this advanced query', 'use full search syntax', '执行高级搜索', '用完整语法查询'],
		commonCombinations: [
			{
				tools: ['advanced_search', 'read_file'],
				pattern: 'Expert query then inspect',
				example: 'Run a precise advanced query and read the best-matching files.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'file_only_search',
		summary: 'Search only file-side signals such as file names, paths, and folder names.',
		operatorSummary: 'File-side discovery query.',
		scopeDescription: 'Search a composed file-only scope that includes file names, paths, and folder names but excludes body text.',
		primary: [
			'Need to locate files without body-text noise.',
			'Need mixed name/path/folder discovery in one call.',
			'Need a broad file-location search rather than content search.',
		],
		secondary: [
			'Search for release documents by naming and folder conventions.',
			'Find structurally related files before reading them.',
			'Use as a higher-recall alternative to separate file/path/folder queries.',
		],
		antiPatterns: [
			'Do not use it when the evidence is inside note bodies.',
			'Do not use it for tags, tasks, or frontmatter filtering.',
			'Do not expect full-text behavior.',
		],
		queryExamples: [
			{ value: 'release notes', description: 'Find files by names or locations that suggest release notes.' },
			{ value: 'projects/client-a', description: 'Find files by structural clues only.' },
		],
		searchKeywords: ['file only search', 'location search', '仅文件搜索', '只搜文件', '文件侧搜索'],
		intentPatterns: ['find the file location', 'search names and folders only', '只搜文件名和路径', '按文件侧信息找'],
		commonCombinations: [
			{
				tools: ['file_only_search', 'open_file'],
				pattern: 'Locate then open',
				example: 'Use file-side search to locate the right note, then open it.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'content_only_search',
		summary: 'Search only content-oriented scopes such as body, line, block, and section, excluding file-side signals.',
		operatorSummary: 'Content-oriented discovery query.',
		scopeDescription: 'Search a composed content-only scope that excludes file names and folder/path signals.',
		primary: [
			'Need pure content recall without filename/path interference.',
			'Need a broader content-centric search across multiple content scopes.',
			'Need to rule out title/path false positives.',
		],
		secondary: [
			'Explore concept mentions regardless of note naming.',
			'Search documents whose titles are unreliable.',
			'Gather content evidence before reading a small subset of notes.',
		],
		antiPatterns: [
			'Do not use it when title or path signals are actually helpful.',
			'Do not use it for tag, task, or property semantics.',
			'Do not expect file-location hints in the scoring logic.',
		],
		queryExamples: [
			{ value: 'incident review', description: 'Search concept mentions in note text only.' },
			{ value: '/API\\s+limit/i', description: 'Regex over content-oriented scopes.' },
		],
		searchKeywords: ['content only search', 'body only search', '仅内容搜索', '只搜正文', '内容范围搜索'],
		intentPatterns: ['search only in content', 'ignore file names', '只在正文里搜', '不要匹配标题路径'],
		commonCombinations: [
			{
				tools: ['content_only_search', 'read_file'],
				pattern: 'Pure content recall then inspect',
				example: 'Search for concept mentions without filename noise, then read the relevant note.',
			},
		],
	}),
	createScopedSearchTool({
		name: 'tag_search',
		summary: 'A tag-focused alias workflow for users who think in terms of "tag search" rather than `search_tags`.',
		operatorSummary: 'Tag-focused query or subquery.',
		scopeDescription: 'Use the same tag-oriented semantics as `search_tags`, but keep the intent explicit for tag-centric workflows.',
		primary: [
			'Need a tool whose name matches tag-centric user language directly.',
			'Need explicit tag-oriented retrieval.',
			'Need compatibility with tag-search phrasing in prompts or hints.',
		],
		secondary: [
			'Serve as a tag-search alias in model reasoning.',
			'Support teams that consistently say "tag search" rather than "search tags".',
			'Clarify that the task is tag-based and not content-based.',
		],
		antiPatterns: [
			'Do not use it for non-tag search tasks.',
			'Do not assume it is meaningfully different from `search_tags` in execution semantics.',
			'Do not use it for frontmatter properties.',
		],
		queryExamples: [
			{ value: '#meeting', description: 'Find meeting-tagged notes.' },
			{ value: 'active', description: 'Find notes with active-like tags.' },
		],
		searchKeywords: ['tag search', '标签专用搜索', '按标签搜', '#tag'],
		intentPatterns: ['tag search', 'search by hashtag', '按标签搜索', '搜索这个 tag'],
		commonCombinations: [
			{
				tools: ['tag_search', 'read_file'],
				pattern: 'Tag recall then inspect',
				example: 'Search tagged notes, then read the most relevant one.',
			},
		],
	}),
];
