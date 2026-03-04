import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, TFile } from 'obsidian';
import { z } from 'zod';
import {
	BUILTIN_MEMORY_CLIENT_NAME,
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_MEMORY_SERVER_VERSION,
} from './constants';
import { registerTextTool } from './runtime/register-tool';
import { BuiltinToolRegistry } from './runtime/tool-registry';
import {
	assertVaultPath,
	ensureParentFolderExists,
	normalizeVaultPath,
} from './tools/helpers';

export interface MemoryBuiltinSettings {
	filePath: string;
}

export interface Entity {
	name: string;
	entityType: string;
	observations: string[];
}

export interface Relation {
	from: string;
	to: string;
	relationType: string;
}

export interface KnowledgeGraph {
	entities: Entity[];
	relations: Relation[];
}

export interface MemoryBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown>; serverId: string }>>;
	close: () => Promise<void>;
}

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

class KnowledgeGraphManager {
	private mutationQueue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly memoryFilePath: string
	) {}

	private parseGraphLine(
		line: string,
		lineNumber: number
	): { type: 'entity'; value: Entity } | { type: 'relation'; value: Relation } | null {
		let item: Record<string, unknown>;
		try {
			item = JSON.parse(line) as Record<string, unknown>;
		} catch (error) {
			throw new Error(
				`Memory 数据损坏: 第 ${lineNumber} 行不是合法 JSON (${toErrorMessage(error)})`
			);
		}

		if (item.type === 'entity') {
			return {
				type: 'entity',
				value: {
					name: String(item.name ?? ''),
					entityType: String(item.entityType ?? ''),
					observations: Array.isArray(item.observations)
						? item.observations.map((entry) => String(entry))
						: [],
				},
			};
		}

		if (item.type === 'relation') {
			return {
				type: 'relation',
				value: {
					from: String(item.from ?? ''),
					to: String(item.to ?? ''),
					relationType: String(item.relationType ?? ''),
				},
			};
		}

		return null;
	}

	private async loadGraph(): Promise<KnowledgeGraph> {
		const data = await this.readGraphText();
		if (!data.trim()) {
			return { entities: [], relations: [] };
		}
		const lines = data
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		const graph: KnowledgeGraph = {
			entities: [],
			relations: [],
		};

		for (const [index, line] of lines.entries()) {
			const parsed = this.parseGraphLine(line, index + 1);
			if (!parsed) {
				continue;
			}
			if (parsed.type === 'entity') {
				graph.entities.push(parsed.value);
				continue;
			}
			graph.relations.push(parsed.value);
		}

		return graph;
	}

	private async readGraphText(): Promise<string> {
		const target = this.app.vault.getAbstractFileByPath(this.memoryFilePath);
		if (!target) return '';
		if (!(target instanceof TFile)) {
			throw new Error(`Memory 存储路径不是文件: ${this.memoryFilePath}`);
		}
		return await this.app.vault.cachedRead(target);
	}

	private async saveGraph(graph: KnowledgeGraph): Promise<void> {
		const lines = [
			...graph.entities.map((entity) =>
				JSON.stringify({
					type: 'entity',
					name: entity.name,
					entityType: entity.entityType,
					observations: entity.observations,
				})
			),
			...graph.relations.map((relation) =>
				JSON.stringify({
					type: 'relation',
					from: relation.from,
					to: relation.to,
					relationType: relation.relationType,
				})
			),
		];
		const content = lines.join('\n');
		await ensureParentFolderExists(this.app, this.memoryFilePath);
		const target = this.app.vault.getAbstractFileByPath(this.memoryFilePath);
		if (!target) {
			await this.app.vault.create(this.memoryFilePath, content);
			return;
		}
		if (!(target instanceof TFile)) {
			throw new Error(`Memory 存储路径不是文件: ${this.memoryFilePath}`);
		}
		await this.app.vault.modify(target, content);
	}

	private async runMutation<T>(
		mutate: (graph: KnowledgeGraph) => Promise<T> | T
	): Promise<T> {
		const run = this.mutationQueue.then(async () => {
			const graph = await this.loadGraph();
			const result = await mutate(graph);
			await this.saveGraph(graph);
			return result;
		});
		this.mutationQueue = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	private async waitForMutations(): Promise<void> {
		await this.mutationQueue;
	}

	async createEntities(entities: Entity[]): Promise<Entity[]> {
		return await this.runMutation((graph) => {
			const newEntities = entities.filter(
				(entity) =>
					!graph.entities.some(
						(existingEntity) => existingEntity.name === entity.name
					)
			);
			graph.entities.push(...newEntities);
			return newEntities;
		});
	}

	async createRelations(relations: Relation[]): Promise<Relation[]> {
		return await this.runMutation((graph) => {
			const newRelations = relations.filter(
				(relation) =>
					!graph.relations.some(
						(existingRelation) =>
							existingRelation.from === relation.from &&
							existingRelation.to === relation.to &&
							existingRelation.relationType === relation.relationType
					)
			);
			graph.relations.push(...newRelations);
			return newRelations;
		});
	}

	async addObservations(
		observations: Array<{ entityName: string; contents: string[] }>
	): Promise<Array<{ entityName: string; addedObservations: string[] }>> {
		return await this.runMutation((graph) => {
			return observations.map((entry) => {
				const entity = graph.entities.find((item) => item.name === entry.entityName);
				if (!entity) {
					throw new Error(`Entity with name ${entry.entityName} not found`);
				}
				const newObservations = entry.contents.filter(
					(content) => !entity.observations.includes(content)
				);
				entity.observations.push(...newObservations);
				return {
					entityName: entry.entityName,
					addedObservations: newObservations,
				};
			});
		});
	}

	async deleteEntities(entityNames: string[]): Promise<void> {
		await this.runMutation((graph) => {
			graph.entities = graph.entities.filter(
				(entity) => !entityNames.includes(entity.name)
			);
			graph.relations = graph.relations.filter(
				(relation) =>
					!entityNames.includes(relation.from) &&
					!entityNames.includes(relation.to)
			);
		});
	}

	async deleteObservations(
		deletions: Array<{ entityName: string; observations: string[] }>
	): Promise<void> {
		await this.runMutation((graph) => {
			for (const deletion of deletions) {
				const entity = graph.entities.find(
					(item) => item.name === deletion.entityName
				);
				if (!entity) {
					continue;
				}
				entity.observations = entity.observations.filter(
					(observation) => !deletion.observations.includes(observation)
				);
			}
		});
	}

	async deleteRelations(relations: Relation[]): Promise<void> {
		await this.runMutation((graph) => {
			graph.relations = graph.relations.filter(
				(relation) =>
					!relations.some(
						(deletedRelation) =>
							relation.from === deletedRelation.from &&
							relation.to === deletedRelation.to &&
							relation.relationType === deletedRelation.relationType
					)
			);
		});
	}

	async readGraph(): Promise<KnowledgeGraph> {
		await this.waitForMutations();
		return await this.loadGraph();
	}

	async searchNodes(query: string): Promise<KnowledgeGraph> {
		await this.waitForMutations();
		const graph = await this.loadGraph();
		const normalizedQuery = query.toLowerCase();
		const filteredEntities = graph.entities.filter(
			(entity) =>
				entity.name.toLowerCase().includes(normalizedQuery) ||
				entity.entityType.toLowerCase().includes(normalizedQuery) ||
				entity.observations.some((observation) =>
					observation.toLowerCase().includes(normalizedQuery)
				)
		);
		const filteredEntityNames = new Set(
			filteredEntities.map((entity) => entity.name)
		);
		const filteredRelations = graph.relations.filter(
			(relation) =>
				filteredEntityNames.has(relation.from) &&
				filteredEntityNames.has(relation.to)
		);
		return {
			entities: filteredEntities,
			relations: filteredRelations,
		};
	}

	async openNodes(names: string[]): Promise<KnowledgeGraph> {
		await this.waitForMutations();
		const graph = await this.loadGraph();
		const filteredEntities = graph.entities.filter((entity) =>
			names.includes(entity.name)
		);
		const filteredEntityNames = new Set(
			filteredEntities.map((entity) => entity.name)
		);
		const filteredRelations = graph.relations.filter(
			(relation) =>
				filteredEntityNames.has(relation.from) &&
				filteredEntityNames.has(relation.to)
		);
		return {
			entities: filteredEntities,
			relations: filteredRelations,
		};
	}
}

const EntitySchema = z.object({
	name: z.string().describe('实体名称'),
	entityType: z.string().describe('实体类型'),
	observations: z
		.array(z.string())
		.describe('与该实体关联的观察内容数组'),
});

const RelationSchema = z.object({
	from: z
		.string()
		.describe('关系起点实体名称'),
	to: z.string().describe('关系终点实体名称'),
	relationType: z.string().describe('关系类型'),
});

const createEntitiesSchema = z.object({
	entities: z.array(EntitySchema),
});

const createRelationsSchema = z.object({
	relations: z.array(RelationSchema),
});

const addObservationsSchema = z.object({
	observations: z.array(
		z.object({
			entityName: z
				.string()
				.describe('要添加观察内容的实体名称'),
			contents: z
				.array(z.string())
				.describe('要新增的观察内容数组'),
		})
	),
});

const deleteEntitiesSchema = z.object({
	entityNames: z.array(z.string()).describe('要删除的实体名称数组'),
});

const deleteObservationsSchema = z.object({
	deletions: z.array(
		z.object({
			entityName: z
				.string()
				.describe('包含目标观察内容的实体名称'),
			observations: z
				.array(z.string())
				.describe('要删除的观察内容数组'),
		})
	),
});

const deleteRelationsSchema = z.object({
	relations: z.array(RelationSchema).describe('要删除的关系数组'),
});

const readGraphSchema = z.object({});

const searchNodesSchema = z.object({
	query: z
		.string()
		.describe(
			'用于匹配实体名称、实体类型和观察内容的搜索关键词'
		),
});

const openNodesSchema = z.object({
	names: z.array(z.string()).describe('要读取的实体名称数组'),
});

const extractTextResult = (result: {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}): string => {
	const text = (result.content ?? [])
		.filter((item) => item.type === 'text' && typeof item.text === 'string')
		.map((item) => item.text as string)
		.join('\n');
	if (result.isError) {
		return `[工具执行错误] ${text}`;
	}
	return text;
};

function registerMemoryTools(
	server: McpServer,
	registry: BuiltinToolRegistry,
	manager: KnowledgeGraphManager
): void {
	registerTextTool(
		server,
		registry,
		'create_entities',
		'在知识图谱中创建多个新实体',
		createEntitiesSchema,
		async ({ entities }) => {
			return await manager.createEntities(entities);
		}
	);

	registerTextTool(
		server,
		registry,
		'create_relations',
		'在知识图谱中创建多个实体关系。关系建议使用主动语态',
		createRelationsSchema,
		async ({ relations }) => {
			return await manager.createRelations(relations);
		}
	);

	registerTextTool(
		server,
		registry,
		'add_observations',
		'为知识图谱中的现有实体添加新的观察内容',
		addObservationsSchema,
		async ({ observations }) => {
			return await manager.addObservations(observations);
		}
	);

	registerTextTool(
		server,
		registry,
		'delete_entities',
		'从知识图谱中删除多个实体及其关联关系',
		deleteEntitiesSchema,
		async ({ entityNames }) => {
			await manager.deleteEntities(entityNames);
			return 'Entities deleted successfully';
		}
	);

	registerTextTool(
		server,
		registry,
		'delete_observations',
		'从知识图谱实体中删除指定观察内容',
		deleteObservationsSchema,
		async ({ deletions }) => {
			await manager.deleteObservations(deletions);
			return 'Observations deleted successfully';
		}
	);

	registerTextTool(
		server,
		registry,
		'delete_relations',
		'从知识图谱中删除多个关系',
		deleteRelationsSchema,
		async ({ relations }) => {
			await manager.deleteRelations(relations);
			return 'Relations deleted successfully';
		}
	);

	registerTextTool(
		server,
		registry,
		'read_graph',
		'读取完整知识图谱',
		readGraphSchema,
		async () => {
			return await manager.readGraph();
		}
	);

	registerTextTool(
		server,
		registry,
		'search_nodes',
		'按关键词搜索知识图谱中的节点',
		searchNodesSchema,
		async ({ query }) => {
			return await manager.searchNodes(query);
		}
	);

	registerTextTool(
		server,
		registry,
		'open_nodes',
		'按名称打开知识图谱中的指定节点',
		openNodesSchema,
		async ({ names }) => {
			return await manager.openNodes(names);
		}
	);
}

export async function createMemoryBuiltinRuntime(
	app: App,
	settings: MemoryBuiltinSettings
): Promise<MemoryBuiltinRuntime> {
	const normalizedFilePath = normalizeVaultPath(settings.filePath);
	assertVaultPath(normalizedFilePath, 'memoryFilePath');

	const server = new McpServer({
		name: BUILTIN_MEMORY_SERVER_NAME,
		version: BUILTIN_MEMORY_SERVER_VERSION,
	});
	const registry = new BuiltinToolRegistry();
	const graphManager = new KnowledgeGraphManager(app, normalizedFilePath);
	registerMemoryTools(server, registry, graphManager);

	const [serverTransport, clientTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_MEMORY_CLIENT_NAME,
		version: BUILTIN_MEMORY_SERVER_VERSION,
	});
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);

	const close = async (): Promise<void> => {
		registry.clear();
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_MEMORY_SERVER_ID,
		serverName: BUILTIN_MEMORY_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return extractTextResult({
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				serverId: BUILTIN_MEMORY_SERVER_ID,
			}));
		},
		close,
	};
}

export async function createMemoryBuiltinClient(
	app: App,
	settings: MemoryBuiltinSettings
): Promise<Client> {
	const runtime = await createMemoryBuiltinRuntime(app, settings);
	return runtime.client;
}
