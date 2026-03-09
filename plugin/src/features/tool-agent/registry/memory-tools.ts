import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	defineTool,
	englishAndChinese,
	guide,
	jsonArray,
	jsonObject,
	jsonString,
	parameterExample,
} from './helpers';
import type { ToolDefinition } from './types';

const serverId = BUILTIN_MEMORY_SERVER_ID;
const serverName = BUILTIN_MEMORY_SERVER_NAME;

const entitySchema = jsonObject(
	{
		name: jsonString('Entity name.'),
		entityType: jsonString('Entity type.'),
		observations: jsonArray('Initial observations for the entity.', jsonString('Observation text.')),
	},
	['name', 'entityType', 'observations']
);

const relationSchema = jsonObject(
	{
		from: jsonString('Source entity name.'),
		relationType: jsonString('Active-voice relation label.'),
		to: jsonString('Target entity name.'),
	},
	['from', 'relationType', 'to']
);

const graphReturn = {
	description: 'Returns a knowledge-graph object with `entities` and `relations` arrays.',
	examples: [
		{
			scenario: 'Small graph fragment',
			output:
				'{"entities":[{"name":"Formify","entityType":"project","observations":["Obsidian plugin"]}],"relations":[{"from":"Formify","relationType":"uses","to":"MCP"}]}',
		},
	],
	errorCases: [
		{
			condition: 'Underlying memory file is corrupted',
			errorMessage: 'Memory 数据损坏',
			resolution: 'Repair or replace the memory store file before retrying.',
		},
		{
			condition: 'A referenced entity is missing during a mutation',
			errorMessage: 'Entity with name ... not found',
			resolution: 'Create the entity first or correct the entity name.',
		},
		{
			condition: 'The memory store path is invalid',
			errorMessage: 'Memory 存储路径不是文件',
			resolution: 'Fix the memory file path configuration.',
		},
	],
};

export const memoryToolDefinitions: ToolDefinition[] = [
	defineTool({
		name: 'create_entities',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Create one or more new knowledge-graph entities with initial observations.',
		coreCapabilities: [
			'Create multiple entities in one call.',
			'Assign a stable entity name and type.',
			'Attach initial observations during creation.',
			'Skip duplicates that already exist by name.',
		],
		limitations: [
			'Does not create relations between entities.',
			'Will not overwrite existing entities with the same name.',
			'Requires explicit entity names and types.',
			'Best suited for stable long-term memory, not ephemeral scratch notes.',
		],
		scenarios: {
			primary: [
				'Need to remember a new person, project, concept, or artifact.',
				'Need to establish graph nodes before adding relations.',
				'Need persistent structured memory beyond the current chat turn.',
			],
			secondary: [
				'Batch-create several project entities after discovery.',
				'Bootstrap a graph from extracted facts.',
				'Create a node and seed it with one or two known observations.',
			],
			antiPatterns: [
				'Do not use it for relation edges only.',
				'Do not use it to update an entity that already exists; add observations instead.',
				'Do not store volatile one-off text that does not deserve persistent memory.',
			],
		},
		inputSchema: jsonObject(
			{
				entities: jsonArray('Entities to create.', entitySchema),
			},
			['entities']
		),
		parameterGuide: {
			entities: guide(
				'Array of entity objects to create.',
				[
					parameterExample(
						[
							{
								name: 'Formify',
								entityType: 'project',
								observations: ['Obsidian plugin'],
							},
						],
						'Create one project entity.'
					),
				],
				[
					'Choose stable canonical names because relations will reference them later.',
					'Keep observations factual and durable rather than conversational.',
				],
				{
					commonMistakes: [
						'Creating duplicate entities with slightly different names.',
						'Using observations to encode relations that should be separate edges.',
					],
				}
			),
		},
		bestPractices: [
			'Create entities before creating relations that point to them.',
			'Use a consistent naming scheme for long-lived graph hygiene.',
			'Store only facts worth persisting across sessions.',
		],
		performanceTips: [
			'Batch related entities in one call when they are discovered together.',
		],
		safetyNotes: [
			'Persistent memory mutation; block it in read-only mode when memory writes are disallowed.',
		],
		commonCombinations: [
			{
				tools: ['create_entities', 'create_relations'],
				pattern: 'Create nodes then wire edges',
				example: 'Create project and owner entities, then link them with a relation.',
			},
			{
				tools: ['create_entities', 'add_observations'],
				pattern: 'Create then enrich',
				example: 'Create a concept node first, then add more facts after later discovery.',
			},
		],
		prerequisites: [
			'Confirm that the object is worth long-term graph memory and does not already exist.',
		],
		followUps: [
			'Use `create_relations` to connect the new entities to the rest of the graph.',
			'Use `add_observations` for later factual updates.',
		],
		returnType: {
			description: 'Returns the subset of entities that were actually created.',
			examples: [
				{
					scenario: 'New entity created',
					output:
						'[{"name":"Formify","entityType":"project","observations":["Obsidian plugin"]}]',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('create entities', 'memory entity', '创建实体', '知识图谱节点', '记忆实体'),
		intentPatterns: englishAndChinese('remember this project', 'create memory entities', '创建记忆实体', '记住这个对象'),
	}),
	defineTool({
		name: 'create_relations',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Create one or more relations between existing knowledge-graph entities.',
		coreCapabilities: [
			'Create multiple directed relations in one call.',
			'Represent graph edges in explicit active-voice form.',
			'Avoid duplicate relation insertion.',
			'Build structure on top of previously created entities.',
		],
		limitations: [
			'Assumes entities already exist conceptually and by name.',
			'Does not create missing entities automatically.',
			'Relation quality depends on consistent entity naming.',
			'Not intended for free-form factual notes better stored as observations.',
		],
		scenarios: {
			primary: [
				'Need to capture how two entities are connected.',
				'Need graph edges after entity creation.',
				'Need structured memory that supports later traversal or retrieval.',
			],
			secondary: [
				'Record ownership, dependency, authorship, or membership edges.',
				'Link new knowledge to existing graph nodes.',
				'Represent a project-to-component relationship cleanly.',
			],
			antiPatterns: [
				'Do not use it for standalone facts that lack a second entity.',
				'Do not encode relations as observations when a graph edge is clearer.',
				'Do not rely on fuzzy or inconsistent entity names.',
			],
		},
		inputSchema: jsonObject(
			{
				relations: jsonArray('Relations to create.', relationSchema),
			},
			['relations']
		),
		parameterGuide: {
			relations: guide(
				'Array of graph edges to create.',
				[
					parameterExample(
						[
							{ from: 'Formify', relationType: 'uses', to: 'MCP' },
						],
						'Create one directed relation.'
					),
				],
				[
					'Use active-voice relation labels like `uses`, `belongs_to`, or `maintained_by`.',
					'Keep entity names identical to previously created canonical names.',
				]
			),
		},
		bestPractices: [
			'Create entities first, then add relations with stable names.',
			'Keep relation labels semantically crisp and reusable.',
			'Prefer relations for structure and observations for free-form facts.',
		],
		performanceTips: [
			'Batch related edges in one mutation call.',
		],
		safetyNotes: [
			'Persistent memory mutation; block in read-only mode when graph writes are disallowed.',
		],
		commonCombinations: [
			{
				tools: ['create_entities', 'create_relations'],
				pattern: 'Graph bootstrapping',
				example: 'Create entities and connect them in one short workflow.',
			},
			{
				tools: ['search_nodes', 'create_relations'],
				pattern: 'Check existing graph then add edges',
				example: 'Search the graph to confirm names, then create the relation.',
			},
		],
		prerequisites: [
			'Ensure the involved entity names are already established and canonical.',
		],
		followUps: [
			'Use `read_graph` or `open_nodes` to verify the resulting subgraph.',
		],
		returnType: {
			description: 'Returns the subset of relations that were newly created.',
			examples: [
				{
					scenario: 'New relation created',
					output: '[{"from":"Formify","relationType":"uses","to":"MCP"}]',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('create relations', 'graph edge', '创建关系', '图谱关系', '知识边'),
		intentPatterns: englishAndChinese('connect these entities', 'create a relation', '建立关系', '把两个实体连起来'),
	}),
	defineTool({
		name: 'add_observations',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Append new observations to existing entities without recreating the entity.',
		coreCapabilities: [
			'Add multiple observations to multiple existing entities.',
			'Skip duplicate observations that are already stored.',
			'Preserve entity identity while enriching factual memory.',
			'Handle free-form factual text that does not fit a graph edge.',
		],
		limitations: [
			'Requires the entity to already exist.',
			'Does not create entities automatically.',
			'Does not replace or delete existing observations.',
			'Not ideal for information that should be modeled as relations.',
		],
		scenarios: {
			primary: [
				'Need to enrich an existing entity with new facts.',
				'Need free-form factual memory that is not a relation.',
				'Need to update a project/person/concept node over time.',
			],
			secondary: [
				'Attach newly learned preferences or capabilities to a remembered entity.',
				'Store stable background facts after a tool workflow.',
				'Accumulate evidence on an existing node.',
			],
			antiPatterns: [
				'Do not use it if the entity does not exist yet.',
				'Do not use observations when a structured relation is the better representation.',
				'Do not add redundant near-duplicates with inconsistent phrasing.',
			],
		},
		inputSchema: jsonObject(
			{
				observations: jsonArray(
					'Observation additions grouped by entity.',
					jsonObject(
						{
							entityName: jsonString('Existing entity name.'),
							contents: jsonArray('Observation texts to add.', jsonString('Observation text.')),
						},
						['entityName', 'contents']
					)
				),
			},
			['observations']
		),
		parameterGuide: {
			observations: guide(
				'Grouped observation additions.',
				[
					parameterExample(
						[
							{
								entityName: 'Formify',
								contents: ['Supports built-in MCP tools'],
							},
						],
						'Add one new fact to an existing entity.'
					),
				],
				[
					'Use the exact canonical entity name.',
					'Keep each observation atomic and durable.',
				]
			),
		},
		bestPractices: [
			'Use observations for factual enrichment, not structural graph edges.',
			'Keep observations concise and deduplicated.',
			'Prefer one fact per string for later retrieval clarity.',
		],
		performanceTips: [
			'Batch multiple observation additions for the same entity in one call.',
		],
		safetyNotes: [
			'Persistent memory mutation; respect read-only policy.',
		],
		commonCombinations: [
			{
				tools: ['create_entities', 'add_observations'],
				pattern: 'Create then enrich',
				example: 'Create an entity, then add details discovered later.',
			},
			{
				tools: ['search_nodes', 'add_observations'],
				pattern: 'Search then update',
				example: 'Search the graph to confirm the target entity name before adding facts.',
			},
		],
		prerequisites: [
			'Ensure the entity already exists by canonical name.',
		],
		followUps: [
			'Use `open_nodes` to inspect the updated entity.',
		],
		returnType: {
			description: 'Returns the added observations grouped by entity.',
			examples: [
				{
					scenario: 'Observation added',
					output:
						'[{"entityName":"Formify","addedObservations":["Supports built-in MCP tools"]}]',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('add observations', 'memory facts', '添加观察', '补充事实', '记忆更新'),
		intentPatterns: englishAndChinese('add facts to this entity', 'remember this about', '补充这个实体的信息', '记住这个事实'),
	}),
	defineTool({
		name: 'delete_entities',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Delete entities and any relations attached to them from the knowledge graph.',
		coreCapabilities: [
			'Delete multiple entities in one call.',
			'Remove relations connected to deleted entities automatically.',
			'Clean up wrong or stale graph nodes.',
			'Support graph hygiene when canonical naming changes.',
		],
		limitations: [
			'Destructive and irreversible within the memory store.',
			'Deletes all relations that reference the entity, not just selected ones.',
			'Does not offer preview mode.',
			'Requires exact entity names.',
		],
		scenarios: {
			primary: [
				'Need to remove incorrect or obsolete entities.',
				'Need to clean graph pollution from bad ingestion.',
				'Need to replace an entity with a corrected canonical one.',
			],
			secondary: [
				'Delete temporary nodes after consolidation.',
				'Remove stale entities that no longer belong in long-term memory.',
				'Prune graph branches after renaming.',
			],
			antiPatterns: [
				'Do not use it when only one observation is wrong.',
				'Do not use it when only one relation needs deletion.',
				'Do not delete entities casually when history continuity matters.',
			],
		},
		inputSchema: jsonObject(
			{
				entityNames: jsonArray('Entity names to delete.', jsonString('Entity name.')),
			},
			['entityNames']
		),
		parameterGuide: {
			entityNames: guide(
				'Exact entity names to remove.',
				[
					parameterExample(['Temporary Project'], 'Delete one mistaken entity.'),
				],
				[
					'Confirm the entity truly should disappear along with its attached relations.',
				]
			),
		},
		bestPractices: [
			'Use this only for full-node removal, not minor cleanup.',
			'Inspect the node first with `open_nodes` when the blast radius is unclear.',
			'Replace with corrected entities before deleting the wrong ones if continuity matters.',
		],
		performanceTips: [
			'Delete related stale entities in one batch when cleaning a bad import.',
		],
		safetyNotes: [
			'Destructive persistent memory mutation; always block in read-only mode.',
		],
		commonCombinations: [
			{
				tools: ['open_nodes', 'delete_entities'],
				pattern: 'Inspect then delete',
				example: 'Open a node first, confirm it is wrong, then delete it.',
			},
		],
		prerequisites: [
			'Ensure entity-level deletion is truly intended.',
		],
		followUps: [
			'Use `read_graph` or `search_nodes` to verify the graph after cleanup.',
		],
		returnType: {
			description: 'Returns a success string after deletion.',
			examples: [
				{
					scenario: 'Delete completed',
					output: 'Entities deleted successfully',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('delete entities', 'remove memory node', '删除实体', '移除记忆节点', '图谱清理'),
		intentPatterns: englishAndChinese('delete this entity', 'remove from memory', '删除这个实体', '从记忆里移除'),
	}),
	defineTool({
		name: 'delete_observations',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Delete specific observations from existing entities while keeping the entities themselves.',
		coreCapabilities: [
			'Remove selected observations without deleting the entity.',
			'Update multiple entities in one call.',
			'Enable fine-grained factual cleanup.',
			'Preserve graph structure while correcting facts.',
		],
		limitations: [
			'Only removes exact matching observation strings.',
			'Does not delete relations.',
			'No fuzzy matching; the strings must match stored observations.',
			'Does not remove the entity even if all observations disappear.',
		],
		scenarios: {
			primary: [
				'Need to remove one or more incorrect facts from an entity.',
				'Need fine-grained memory cleanup.',
				'Need to preserve the entity while correcting its details.',
			],
			secondary: [
				'Remove outdated capabilities or preferences.',
				'Clean up noisy observations after consolidation.',
				'Undo a mistaken observation addition.',
			],
			antiPatterns: [
				'Do not use it for relation edges.',
				'Do not use it when the whole entity should disappear.',
				'Do not expect approximate text matching.',
			],
		},
		inputSchema: jsonObject(
			{
				deletions: jsonArray(
					'Observation deletions grouped by entity.',
					jsonObject(
						{
							entityName: jsonString('Existing entity name.'),
							observations: jsonArray('Observation strings to remove.', jsonString('Observation text.')),
						},
						['entityName', 'observations']
					)
				),
			},
			['deletions']
		),
		parameterGuide: {
			deletions: guide(
				'Grouped observation removals.',
				[
					parameterExample(
						[
							{
								entityName: 'Formify',
								observations: ['Supports legacy API X'],
							},
						],
						'Remove one outdated fact.'
					),
				],
				[
					'Use exact stored observation text when possible.',
					'Inspect the entity first if you are unsure of the current observation wording.',
				]
			),
		},
		bestPractices: [
			'Inspect the entity before deletion if wording might differ.',
			'Use this instead of deleting the whole entity for small corrections.',
			'Keep observation strings stable to make future cleanup easier.',
		],
		performanceTips: [
			'Batch observation cleanups for the same entity together.',
		],
		safetyNotes: [
			'Persistent memory mutation; respect read-only policy.',
		],
		commonCombinations: [
			{
				tools: ['open_nodes', 'delete_observations'],
				pattern: 'Inspect then prune facts',
				example: 'Open the node, confirm the stored facts, then remove the wrong ones.',
			},
		],
		prerequisites: [
			'Know the exact observation text or inspect it first.',
		],
		followUps: [
			'Use `open_nodes` to verify the entity afterward.',
		],
		returnType: {
			description: 'Returns a success string after observation deletion.',
			examples: [
				{
					scenario: 'Deletion succeeded',
					output: 'Observations deleted successfully',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('delete observations', 'remove facts', '删除观察', '删除事实', '细粒度记忆清理'),
		intentPatterns: englishAndChinese('remove this fact', 'delete observation from entity', '删掉这个事实', '删除实体上的观察'),
	}),
	defineTool({
		name: 'delete_relations',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Delete specific graph relations while keeping the connected entities.',
		coreCapabilities: [
			'Delete multiple edges in one call.',
			'Preserve the endpoint entities.',
			'Support precise structural cleanup.',
			'Match relations by exact `from`, `relationType`, and `to` triple.',
		],
		limitations: [
			'Requires exact relation triples.',
			'Does not affect entity observations.',
			'Does not delete entities themselves.',
			'No fuzzy relation matching.',
		],
		scenarios: {
			primary: [
				'Need to remove an incorrect relation between existing entities.',
				'Need to keep entities but change graph structure.',
				'Need to clean up outdated dependency or ownership edges.',
			],
			secondary: [
				'Refine graph structure after canonicalization.',
				'Undo a mistaken structural link.',
				'Replace one relation label with a corrected one.',
			],
			antiPatterns: [
				'Do not use it for observation cleanup.',
				'Do not use it when the whole entity should be removed.',
				'Do not rely on approximate names or relation labels.',
			],
		},
		inputSchema: jsonObject(
			{
				relations: jsonArray('Relations to delete.', relationSchema),
			},
			['relations']
		),
		parameterGuide: {
			relations: guide(
				'Exact relation triples to remove.',
				[
					parameterExample(
						[
							{ from: 'Formify', relationType: 'depends_on', to: 'Old API' },
						],
						'Delete one outdated dependency edge.'
					),
				],
				[
					'Inspect the current subgraph first if exact labels are uncertain.',
				]
			),
		},
		bestPractices: [
			'Delete only the wrong edge instead of recreating the whole graph.',
			'Use exact canonical entity names and relation labels.',
			'Inspect before deleting when graph structure matters.',
		],
		performanceTips: [
			'Batch multiple related edge deletions in one cleanup pass.',
		],
		safetyNotes: [
			'Persistent memory mutation; respect read-only policy.',
		],
		commonCombinations: [
			{
				tools: ['open_nodes', 'delete_relations'],
				pattern: 'Inspect then remove edge',
				example: 'Open the entities, verify the edge, then delete it precisely.',
			},
			{
				tools: ['delete_relations', 'create_relations'],
				pattern: 'Replace structure',
				example: 'Delete an outdated relation and create the corrected one.',
			},
		],
		prerequisites: [
			'Know the exact relation triple to remove.',
		],
		followUps: [
			'Use `open_nodes` or `read_graph` to verify the graph shape after removal.',
		],
		returnType: {
			description: 'Returns a success string after relation deletion.',
			examples: [
				{
					scenario: 'Deletion succeeded',
					output: 'Relations deleted successfully',
				},
			],
			errorCases: graphReturn.errorCases,
		},
		searchKeywords: englishAndChinese('delete relations', 'remove edge', '删除关系', '移除边', '图谱关系清理'),
		intentPatterns: englishAndChinese('remove this relation', 'delete the graph edge', '删除这条关系', '移除实体之间的连线'),
	}),
	defineTool({
		name: 'read_graph',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Read the entire knowledge graph as the current memory snapshot.',
		coreCapabilities: [
			'Return all entities and relations in the graph.',
			'Provide a full snapshot for audits or exports.',
			'Wait for pending mutations before reading.',
			'Serve as the broadest graph-inspection tool.',
		],
		limitations: [
			'Can return large payloads on big graphs.',
			'Not filtered or targeted; use narrower tools when you only need a subset.',
			'Read-only and does not mutate memory.',
			'No built-in ranking or semantic focus.',
		],
		scenarios: {
			primary: [
				'Need the full memory snapshot.',
				'Need to audit graph state after several mutations.',
				'Need an export-like view for summary or debugging.',
			],
			secondary: [
				'Estimate graph size before targeted cleanup.',
				'Capture the current memory store for diagnostics.',
				'Compare graph state before and after a batch mutation workflow.',
			],
			antiPatterns: [
				'Do not use it when you only need a few entities.',
				'Do not use it as the first choice on large graphs if a query target is already known.',
				'Do not expect relevance ordering.',
			],
		},
		inputSchema: jsonObject({}),
		parameterGuide: {},
		bestPractices: [
			'Use `search_nodes` or `open_nodes` when you do not need the whole graph.',
			'Prefer this tool for audits and debugging rather than routine targeted lookups.',
		],
		performanceTips: [
			'Reserve full graph reads for snapshots and diagnostics.',
		],
		safetyNotes: [
			'Read-only graph inspection tool.',
		],
		commonCombinations: [
			{
				tools: ['read_graph', 'search_nodes'],
				pattern: 'Audit then narrow',
				example: 'Read the whole graph for context, then search within it for a topic.',
			},
		],
		prerequisites: [
			'Use this only when the full memory snapshot is truly needed.',
		],
		followUps: [
			'Use targeted graph tools for follow-up edits or inspection.',
		],
		returnType: graphReturn,
		searchKeywords: englishAndChinese('read graph', 'full memory graph', '读取图谱', '完整记忆图', '查看全部记忆'),
		intentPatterns: englishAndChinese('show the whole graph', 'read full memory', '查看整个知识图谱', '读取全部记忆'),
	}),
	defineTool({
		name: 'search_nodes',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Search entities by name, type, or observation text and return the matching subgraph.',
		coreCapabilities: [
			'Search entity names, types, and observations by keyword.',
			'Return matching entities plus relations between the matched entities.',
			'Provide a targeted view without loading the full graph.',
			'Support memory discovery before updates or cleanup.',
		],
		limitations: [
			'Keyword match is substring-based, not semantic embedding search.',
			'Only relations between matched entities are returned.',
			'Does not mutate graph state.',
			'Results depend on exact or near-exact text overlap.',
		],
		scenarios: {
			primary: [
				'Need to find whether memory already contains a topic or entity.',
				'Need a targeted subgraph before updates.',
				'Need to discover canonical entity names before mutation.',
			],
			secondary: [
				'Search for remembered user preferences or project notes.',
				'Find related graph fragments for summarization.',
				'Confirm the existence of an entity before creating a duplicate.',
			],
			antiPatterns: [
				'Do not use it when exact node names are already known; `open_nodes` is more precise.',
				'Do not expect semantic similarity ranking.',
				'Do not use it as a whole-graph export.',
			],
		},
		inputSchema: jsonObject(
			{
				query: jsonString('Search keyword for names, types, or observations.'),
			},
			['query']
		),
		parameterGuide: {
			query: guide(
				'Substring search query for graph content.',
				[
					parameterExample('Formify', 'Search by entity name.'),
					parameterExample('preference', 'Search by observation text or entity type context.'),
				],
				[
					'Use canonical names when known.',
					'Search broadly first, then use `open_nodes` for exact inspection.',
				]
			),
		},
		bestPractices: [
			'Search before creating entities to avoid duplicates.',
			'Use it as the graph equivalent of a discovery search.',
			'Promote exact names from the result into later mutation calls.',
		],
		performanceTips: [
			'Targeted search is cheaper and easier to reason about than full graph reads.',
		],
		safetyNotes: [
			'Read-only graph discovery tool.',
		],
		commonCombinations: [
			{
				tools: ['search_nodes', 'add_observations'],
				pattern: 'Find then update memory',
				example: 'Search for the target entity, then add new facts to it.',
			},
			{
				tools: ['search_nodes', 'create_entities'],
				pattern: 'Check for duplicates before creation',
				example: 'Search memory first, then create a new entity only if no match exists.',
			},
		],
		prerequisites: [
			'Use a meaningful keyword that likely appears in the entity name, type, or stored facts.',
		],
		followUps: [
			'Use `open_nodes` with exact names for precise inspection after discovery.',
		],
		returnType: graphReturn,
		searchKeywords: englishAndChinese('search nodes', 'memory search', '搜索节点', '搜索记忆', '图谱检索'),
		intentPatterns: englishAndChinese('search memory for', 'find this in the graph', '在记忆里搜索', '查图谱里有没有'),
	}),
	defineTool({
		name: 'open_nodes',
		serverId,
		serverName,
		category: 'memory',
		summary: 'Open an exact set of entities by name and return only those entities plus relations between them.',
		coreCapabilities: [
			'Fetch exact named entities from the graph.',
			'Return the relations that exist between the requested entities.',
			'Provide precise subgraph inspection after discovery.',
			'Avoid broad graph scans when names are already known.',
		],
		limitations: [
			'Requires exact entity names.',
			'Does not search observation text or fuzzy variations.',
			'Only returns relations whose endpoints are both in the requested set.',
			'Read-only inspection only.',
		],
		scenarios: {
			primary: [
				'Need exact inspection of one or more known entities.',
				'Need to confirm current entity state before editing.',
				'Need a precise subgraph rather than a broad keyword search.',
			],
			secondary: [
				'Inspect several related entities together.',
				'Validate graph structure before deleting or replacing relations.',
				'Show the current stored facts for known entities.',
			],
			antiPatterns: [
				'Do not use it when names are unknown; search first.',
				'Do not expect fuzzy lookup behavior.',
				'Do not use it for whole-graph export.',
			],
		},
		inputSchema: jsonObject(
			{
				names: jsonArray('Exact entity names to open.', jsonString('Entity name.')),
			},
			['names']
		),
		parameterGuide: {
			names: guide(
				'Exact entity names to fetch.',
				[
					parameterExample(['Formify', 'MCP'], 'Open two related nodes together.'),
				],
				[
					'Use canonical names from `search_nodes` results.',
					'Include multiple entities when you want to inspect their connecting edges.',
				]
			),
		},
		bestPractices: [
			'Search first, then open by exact names.',
			'Inspect nodes before destructive graph mutations.',
			'Use multiple names together when relationship context matters.',
		],
		performanceTips: [
			'Exact node opens are cheaper and cleaner than full graph reads.',
		],
		safetyNotes: [
			'Read-only graph inspection tool.',
		],
		commonCombinations: [
			{
				tools: ['search_nodes', 'open_nodes'],
				pattern: 'Discover then inspect exactly',
				example: 'Search for canonical names, then open the exact nodes you care about.',
			},
			{
				tools: ['open_nodes', 'delete_relations'],
				pattern: 'Inspect then edit structure',
				example: 'Open the involved nodes before removing the wrong edge.',
			},
		],
		prerequisites: [
			'Know the exact entity names or search for them first.',
		],
		followUps: [
			'Use memory mutation tools after inspection if cleanup or enrichment is needed.',
		],
		returnType: graphReturn,
		searchKeywords: englishAndChinese('open nodes', 'exact graph nodes', '打开节点', '精确读取实体', '查看指定节点'),
		intentPatterns: englishAndChinese('open these nodes', 'show this entity exactly', '打开这些节点', '精确查看这个实体'),
	}),
];
