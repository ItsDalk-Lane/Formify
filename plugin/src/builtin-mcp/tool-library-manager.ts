import type { App, EventRef } from 'obsidian';
import { normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { createMemoryBuiltinRuntime } from './memory-mcp-server';
import { createObsidianSearchBuiltinRuntime } from './obsidian-search-mcp-server';
import { createSequentialThinkingBuiltinRuntime } from './sequentialthinking-mcp-server';
import { getToolLibrarySeed } from './tool-library-seeds';
import { TOOL_SEARCH_TOOL_CATALOG } from './tool-search-tool-definitions';
import type {
	ToolLibraryCatalogDefinition,
	ToolLibraryEntry,
	ToolLibraryExample,
	ToolLibraryMetadata,
	ToolLibraryParameter,
	ToolLibrarySearchOptions,
	ToolLibrarySearchResult,
} from './tool-library-types';
import { createVaultBuiltinRuntime } from './vault-mcp-server';
import { getToolLibraryPath, ensureAIDataFolders } from 'src/utils/AIPathManager';
import { DebugLogger } from 'src/utils/DebugLogger';

const FRONTMATTER_DELIMITER = '---';
const DEFAULT_RELOAD_DEBOUNCE_MS = 100;
const BOOTSTRAP_MEMORY_FILE_PATH = 'System/formify/mcp-memory.jsonl';

interface ToolLibraryManagerOptions {
	app: App;
	aiDataFolder: string;
	toolCatalogLoader?: () => Promise<ToolLibraryCatalogDefinition[]>;
	ensureStorageFolder?: (app: App, aiDataFolder: string) => Promise<void>;
	storagePathFactory?: (aiDataFolder: string) => string;
	reloadDebounceMs?: number;
}

type VaultFileLike = {
	path: string;
};

type RawToolMetadata = Partial<ToolLibraryMetadata> & Record<string, unknown>;

const isNonEmptyString = (value: unknown): value is string => {
	return typeof value === 'string' && value.trim().length > 0;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const basenameWithoutExtension = (path: string): string => {
	const matched = path.match(/([^/]+)\.md$/i);
	return matched?.[1] ?? path;
};

const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!isNonEmptyString(value)) {
			continue;
		}
		const trimmed = value.trim();
		const key = normalizeText(trimmed);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return uniqueStrings(
		value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
	);
};

const toParameters = (value: unknown): ToolLibraryParameter[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
		.map((item) => ({
			name: isNonEmptyString(item.name) ? item.name.trim() : '',
			type: isNonEmptyString(item.type) ? item.type.trim() : 'any',
			required: item.required === true,
			description: isNonEmptyString(item.description) ? item.description.trim() : '',
		}))
		.filter((item) => item.name.length > 0);
};

const toExamples = (value: unknown): ToolLibraryExample[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
		.map((item) => ({
			title: isNonEmptyString(item.title) ? item.title.trim() : '',
			args:
				item.args && typeof item.args === 'object' && !Array.isArray(item.args)
					? (item.args as Record<string, unknown>)
					: {},
			summary: isNonEmptyString(item.summary) ? item.summary.trim() : '',
		}))
		.filter((item) => item.title.length > 0);
};

const describeSchemaType = (schema: Record<string, unknown> | undefined): string => {
	if (!schema || typeof schema !== 'object') {
		return 'any';
	}

	const enumValues = Array.isArray(schema.enum)
		? schema.enum
				.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
				.map((item) => String(item))
		: [];
	if (enumValues.length > 0) {
		return `enum(${enumValues.join('|')})`;
	}

	const rawType = schema.type;
	if (Array.isArray(rawType)) {
		return rawType.filter((item): item is string => typeof item === 'string').join('|') || 'any';
	}
	if (typeof rawType === 'string') {
		return rawType;
	}
	return 'any';
};

const extractParametersFromSchema = (inputSchema: Record<string, unknown>): ToolLibraryParameter[] => {
	const required = new Set(
		Array.isArray(inputSchema.required)
			? inputSchema.required.filter((item): item is string => typeof item === 'string')
			: []
	);
	const properties =
		typeof inputSchema.properties === 'object' && inputSchema.properties !== null
			? (inputSchema.properties as Record<string, Record<string, unknown>>)
			: {};

	return Object.entries(properties).map(([name, propertySchema]) => ({
		name,
		type: describeSchemaType(propertySchema),
		required: required.has(name),
		description: isNonEmptyString(propertySchema.description)
			? propertySchema.description.trim()
			: '',
	}));
};

const extractSummary = (body: string, fallback: string): string => {
	const lines = body
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	for (const line of lines) {
		if (
			line.startsWith('#')
			|| line.startsWith('- ')
			|| line.startsWith('* ')
			|| line.startsWith('## ')
		) {
			continue;
		}
		return line;
	}
	return fallback;
};

const extractSearchTerms = (query: string): string[] => {
	const normalized = normalizeText(query);
	if (!normalized) {
		return [];
	}

	const terms = uniqueStrings(
		[
			normalized,
			...normalized
				.split(/[\s,，。；;、|/]+/g)
				.map((item) => item.trim())
				.filter(Boolean),
		]
	).map((item) => normalizeText(item));

	return terms.filter(Boolean);
};

const sortEntries = (entries: ToolLibraryEntry[]): ToolLibraryEntry[] => {
	return [...entries].sort((left, right) => {
		const server = left.metadata.serverName.localeCompare(right.metadata.serverName, 'zh-Hans-CN');
		if (server !== 0) return server;
		const category = left.metadata.category.localeCompare(right.metadata.category, 'zh-Hans-CN');
		if (category !== 0) return category;
		return left.metadata.name.localeCompare(right.metadata.name, 'en');
	});
};

const defaultEnsureStorageFolder = async (app: App, aiDataFolder: string): Promise<void> => {
	await ensureAIDataFolders(app, aiDataFolder);
};

async function loadBuiltinToolCatalog(app: App): Promise<ToolLibraryCatalogDefinition[]> {
	const runtimes: Array<{
		serverId: string;
		serverName: string;
		listTools: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown>; serverId: string }>>;
		close: () => Promise<void>;
	}> = [];

	for (const createRuntime of [
		() => createVaultBuiltinRuntime(app),
		() => createMemoryBuiltinRuntime(app, { filePath: BOOTSTRAP_MEMORY_FILE_PATH }),
		() => createObsidianSearchBuiltinRuntime(app),
		() =>
			createSequentialThinkingBuiltinRuntime(app, {
				disableThoughtLogging: true,
			}),
	]) {
		try {
			runtimes.push(await createRuntime());
		} catch (error) {
			DebugLogger.warn('[ToolLibraryManager] 读取内置工具目录时初始化 runtime 失败，已跳过', error);
		}
	}

	const catalog: ToolLibraryCatalogDefinition[] = [];
	try {
		for (const runtime of runtimes) {
			try {
				const tools = await runtime.listTools();
				catalog.push(
					...tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
						serverId: tool.serverId || runtime.serverId,
						serverName: runtime.serverName,
					}))
				);
			} catch (error) {
				DebugLogger.warn('[ToolLibraryManager] 读取 runtime 工具列表失败，已跳过', error);
			}
		}
	} finally {
		await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
	}

	const merged = [...catalog, ...TOOL_SEARCH_TOOL_CATALOG];
	const deduped = new Map<string, ToolLibraryCatalogDefinition>();
	for (const definition of merged) {
		deduped.set(definition.name, definition);
	}
	return Array.from(deduped.values());
}

export class ToolLibraryManager {
	private readonly app: App;
	private readonly toolCatalogLoader: () => Promise<ToolLibraryCatalogDefinition[]>;
	private readonly ensureStorageFolder: (app: App, aiDataFolder: string) => Promise<void>;
	private readonly storagePathFactory: (aiDataFolder: string) => string;
	private readonly reloadDebounceMs: number;
	private aiDataFolder: string;
	private storageFolderPath: string;
	private initializePromise: Promise<void> | null = null;
	private initialized = false;
	private reloadTimer: ReturnType<typeof setTimeout> | null = null;
	private eventRefs: EventRef[] = [];
	private catalogCache: ToolLibraryCatalogDefinition[] | null = null;
	private entries: ToolLibraryEntry[] = [];
	private readonly toolByName = new Map<string, ToolLibraryEntry>();
	private readonly keywordIndex = new Map<string, Set<string>>();
	private readonly scenarioIndex = new Map<string, Set<string>>();
	private readonly categoryIndex = new Map<string, Set<string>>();
	private readonly serverIndex = new Map<string, Set<string>>();

	constructor(options: ToolLibraryManagerOptions) {
		this.app = options.app;
		this.aiDataFolder = options.aiDataFolder;
		this.toolCatalogLoader =
			options.toolCatalogLoader ?? (async () => await loadBuiltinToolCatalog(options.app));
		this.ensureStorageFolder = options.ensureStorageFolder ?? defaultEnsureStorageFolder;
		this.storagePathFactory = options.storagePathFactory ?? getToolLibraryPath;
		this.reloadDebounceMs = options.reloadDebounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS;
		this.storageFolderPath = this.storagePathFactory(this.aiDataFolder);
	}

	async initialize(): Promise<void> {
		if (this.initializePromise) {
			await this.initializePromise;
			return;
		}
		if (this.initialized) {
			return;
		}

		this.initializePromise = (async () => {
			await this.ensureStorageFolder(this.app, this.aiDataFolder);
			await this.bootstrapMissingFiles();
			await this.reloadIndex();
			this.registerWatchers();
			this.initialized = true;
		})();

		try {
			await this.initializePromise;
		} finally {
			this.initializePromise = null;
		}
	}

	async updateAiDataFolder(aiDataFolder: string): Promise<void> {
		const normalized = normalizePath(aiDataFolder);
		if (!normalized || normalized === this.aiDataFolder) {
			return;
		}

		this.aiDataFolder = normalized;
		this.storageFolderPath = this.storagePathFactory(this.aiDataFolder);
		this.disposeWatchers();
		await this.ensureStorageFolder(this.app, this.aiDataFolder);
		await this.bootstrapMissingFiles();
		await this.reloadIndex();
		this.registerWatchers();
	}

	dispose(): void {
		if (this.reloadTimer) {
			clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
		this.disposeWatchers();
		this.initialized = false;
		this.initializePromise = null;
	}

	async listEntries(filters?: {
		serverIds?: string[];
		categories?: string[];
	}): Promise<ToolLibraryEntry[]> {
		await this.initialize();
		return sortEntries(this.filterEntries(filters));
	}

	async getEntry(name: string): Promise<ToolLibraryEntry | null> {
		await this.initialize();
		const normalized = normalizeText(name);
		return this.toolByName.get(normalized) ?? null;
	}

	async searchTools(options: ToolLibrarySearchOptions): Promise<ToolLibrarySearchResult[]> {
		await this.initialize();
		const normalizedQuery = normalizeText(options.task);
		if (!normalizedQuery) {
			return [];
		}

		const searchTerms = extractSearchTerms(normalizedQuery);
		const filteredEntries = this.filterEntries({
			serverIds: options.serverIds,
			categories: options.categories,
		});

		const results = filteredEntries
			.map((entry) => this.scoreEntry(entry, normalizedQuery, searchTerms))
			.filter((item): item is ToolLibrarySearchResult => item !== null)
			.sort((left, right) => {
				if (right.score !== left.score) return right.score - left.score;
				if (right.exactKeywordMatches.length !== left.exactKeywordMatches.length) {
					return right.exactKeywordMatches.length - left.exactKeywordMatches.length;
				}
				if (right.partialKeywordMatches.length !== left.partialKeywordMatches.length) {
					return right.partialKeywordMatches.length - left.partialKeywordMatches.length;
				}
				if (right.scenarioMatches.length !== left.scenarioMatches.length) {
					return right.scenarioMatches.length - left.scenarioMatches.length;
				}
				return left.entry.metadata.name.localeCompare(right.entry.metadata.name, 'en');
			});

		const limit = options.limit ?? 3;
		return results.slice(0, Math.max(1, limit));
	}

	formatFindToolResults(results: ToolLibrarySearchResult[], task: string): string {
		const normalizedTask = task.trim();
		if (results.length === 0) {
			return [
				'# Tool Search',
				`未找到与“${normalizedTask || '当前任务'}”匹配的工具。`,
				'建议：',
				'- 改写任务描述，明确对象、范围和目标动作。',
				'- 如果你想浏览工具全集，可调用 `list_tools`。',
			].join('\n');
		}

		const blocks = ['# Tool Search', `以下是与“${normalizedTask}”最匹配的工具：`];
		results.forEach((result, index) => {
			const { metadata } = result.entry;
			const reasons: string[] = [];
			if (result.exactKeywordMatches.length > 0) {
				reasons.push(`精确关键词：${result.exactKeywordMatches.join('、')}`);
			}
			if (result.partialKeywordMatches.length > 0) {
				reasons.push(`包含关键词：${result.partialKeywordMatches.join('、')}`);
			}
			if (result.scenarioMatches.length > 0) {
				reasons.push(`场景匹配：${result.scenarioMatches.join('、')}`);
			}

			blocks.push(
				[
					`## ${index + 1}. ${metadata.name}`,
					`- 服务器：${metadata.serverName} (${metadata.serverId})`,
					`- 分类：${metadata.category}`,
					`- 匹配分数：${result.score}`,
					`- 命中原因：${reasons.join('；') || '基础元数据匹配'}`,
					`- 适用场景：${metadata.scenarios.join('；') || '未提供'}`,
					`- 决策指南：${metadata.decisionGuide.join('；') || '未提供'}`,
					`- 参数摘要：${this.formatParameterSummary(metadata.parameters)}`,
					`- 示例：${this.formatInlineExample(metadata.examples[0])}`,
				].join('\n')
			);
		});

		return blocks.join('\n\n');
	}

	formatToolInfo(entry: ToolLibraryEntry): string {
		const { metadata } = entry;
		const lines = [
			`# ${metadata.name}`,
			`- 服务器：${metadata.serverName} (${metadata.serverId})`,
			`- 分类：${metadata.category}`,
			`- 核心能力：${metadata.capabilities.join('；') || '未提供'}`,
			`- 适用场景：${metadata.scenarios.join('；') || '未提供'}`,
			`- 决策指南：${metadata.decisionGuide.join('；') || '未提供'}`,
			'',
			'## 参数说明',
			this.formatParametersMarkdown(metadata.parameters),
			'',
			'## 使用示例',
			this.formatExamplesMarkdown(metadata.examples),
		];

		if (entry.body.trim()) {
			lines.push('', '## 补充说明', entry.body.trim());
		}

		return lines.join('\n');
	}

	formatList(entries: ToolLibraryEntry[], filters?: {
		serverIds?: string[];
		categories?: string[];
	}): string {
		if (entries.length === 0) {
			return [
				'# Tool List',
				'未找到符合筛选条件的工具。',
				'- 可以减少 `serverIds` 或 `categories` 过滤条件。',
				'- 也可以直接调用 `find_tool` 让系统按任务匹配工具。',
			].join('\n');
		}

		const parts = ['# Tool List'];
		if (filters?.serverIds?.length || filters?.categories?.length) {
			parts.push(
				[
					'当前筛选：',
					filters.serverIds?.length ? `- serverIds: ${filters.serverIds.join(', ')}` : '',
					filters.categories?.length ? `- categories: ${filters.categories.join(', ')}` : '',
				]
					.filter(Boolean)
					.join('\n')
			);
		}

		let currentGroup = '';
		for (const entry of sortEntries(entries)) {
			const nextGroup = `${entry.metadata.serverName} / ${entry.metadata.category}`;
			if (nextGroup !== currentGroup) {
				currentGroup = nextGroup;
				parts.push(`## ${currentGroup}`);
			}
			parts.push(
				`- \`${entry.metadata.name}\`：${entry.summary || entry.metadata.capabilities[0] || '无说明'}`
			);
		}

		return parts.join('\n\n');
	}

	private async bootstrapMissingFiles(): Promise<void> {
		const definitions = await this.getCatalogDefinitions();
		const existingPaths = await this.listMarkdownFilePaths();
		const existingToolNames = new Set(
			existingPaths.map((path) => normalizeText(basenameWithoutExtension(path)))
		);

		for (const definition of definitions) {
			if (existingToolNames.has(normalizeText(definition.name))) {
				continue;
			}

			const seed = getToolLibrarySeed(definition.name);
			if (!seed) {
				DebugLogger.warn('[ToolLibraryManager] 缺少工具种子定义，已跳过生成', definition.name);
				continue;
			}

			const markdown = this.buildMarkdownRecord(definition, seed);
			await this.writeMarkdownFile(this.getToolFilePath(definition.name), markdown);
		}
	}

	private async getCatalogDefinitions(): Promise<ToolLibraryCatalogDefinition[]> {
		if (this.catalogCache) {
			return this.catalogCache;
		}
		this.catalogCache = await this.toolCatalogLoader();
		return this.catalogCache;
	}

	private async writeMarkdownFile(filePath: string, content: string): Promise<void> {
		const exists = await this.app.vault.adapter.exists(filePath);
		if (!exists) {
			await this.app.vault.create(filePath, content);
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(filePath) as VaultFileLike | null;
		if (!existing) {
			await this.app.vault.create(filePath, content);
			return;
		}

		await this.app.vault.modify(existing as never, content);
	}

	private buildMarkdownRecord(
		definition: ToolLibraryCatalogDefinition,
		seed: ReturnType<typeof getToolLibrarySeed>
	): string {
		if (!seed) {
			throw new Error(`缺少工具种子定义: ${definition.name}`);
		}

		const metadata: ToolLibraryMetadata = {
			name: definition.name,
			serverId: seed.serverId,
			serverName: seed.serverName,
			category: seed.category,
			keywords: seed.keywords,
			scenarios: seed.scenarios,
			decisionGuide: seed.decisionGuide,
			capabilities: seed.capabilities,
			parameters: extractParametersFromSchema(definition.inputSchema),
			examples: seed.examples,
		};

		const yaml = stringifyYaml(metadata).trimEnd();
		return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${seed.body}\n`;
	}

	private async reloadIndex(): Promise<void> {
		const filePaths = (await this.listMarkdownFilePaths()).sort((left, right) =>
			left.localeCompare(right, 'en')
		);
		const nextEntries: ToolLibraryEntry[] = [];

		for (const filePath of filePaths) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				const parsed = this.parseToolFile(filePath, content);
				if (parsed) {
					nextEntries.push(parsed);
				}
			} catch (error) {
				DebugLogger.warn('[ToolLibraryManager] 读取工具描述文件失败，已跳过', { filePath, error });
			}
		}

		this.entries = sortEntries(nextEntries);
		this.rebuildIndexes();
	}

	private parseToolFile(filePath: string, content: string): ToolLibraryEntry | null {
		const { frontmatter, body } = this.parseMarkdownRecord(content);
		if (!frontmatter) {
			return null;
		}

		const metadata: ToolLibraryMetadata = {
			name: isNonEmptyString(frontmatter.name)
				? frontmatter.name.trim()
				: basenameWithoutExtension(filePath),
			serverId: isNonEmptyString(frontmatter.serverId) ? frontmatter.serverId.trim() : '',
			serverName: isNonEmptyString(frontmatter.serverName) ? frontmatter.serverName.trim() : '',
			category: isNonEmptyString(frontmatter.category) ? frontmatter.category.trim() : '',
			keywords: toStringArray(frontmatter.keywords),
			scenarios: toStringArray(frontmatter.scenarios),
			decisionGuide: toStringArray(frontmatter.decisionGuide),
			capabilities: toStringArray(frontmatter.capabilities),
			parameters: toParameters(frontmatter.parameters),
			examples: toExamples(frontmatter.examples),
		};

		if (!metadata.name) {
			return null;
		}

		const summary = extractSummary(body, metadata.capabilities[0] ?? '');
		return {
			filePath,
			body,
			metadata,
			summary,
		};
	}

	private parseMarkdownRecord(content: string): {
		frontmatter: RawToolMetadata | null;
		body: string;
	} {
		if (!content.startsWith(FRONTMATTER_DELIMITER)) {
			return { frontmatter: null, body: content.trim() };
		}

		const delimiterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n)?/;
		const matched = content.match(delimiterRegex);
		if (!matched) {
			return { frontmatter: null, body: content.trim() };
		}

		try {
			const parsed = parseYaml(matched[1]);
			const body = content.slice(matched[0].length).trim();
			return {
				frontmatter:
					parsed && typeof parsed === 'object' && !Array.isArray(parsed)
						? (parsed as RawToolMetadata)
						: null,
				body,
			};
		} catch (error) {
			DebugLogger.warn('[ToolLibraryManager] 解析工具描述 frontmatter 失败，已跳过', error);
			return { frontmatter: null, body: '' };
		}
	}

	private rebuildIndexes(): void {
		this.toolByName.clear();
		this.keywordIndex.clear();
		this.scenarioIndex.clear();
		this.categoryIndex.clear();
		this.serverIndex.clear();

		for (const entry of this.entries) {
			const normalizedName = normalizeText(entry.metadata.name);
			this.toolByName.set(normalizedName, entry);

			const normalizedKeywords = uniqueStrings([
				entry.metadata.name,
				entry.metadata.serverId,
				entry.metadata.serverName,
				entry.metadata.category,
				...entry.metadata.keywords,
			]).map((item) => normalizeText(item));
			for (const keyword of normalizedKeywords) {
				this.addToIndex(this.keywordIndex, keyword, normalizedName);
			}

			for (const scenario of entry.metadata.scenarios.map((item) => normalizeText(item))) {
				this.addToIndex(this.scenarioIndex, scenario, normalizedName);
			}

			this.addToIndex(this.categoryIndex, normalizeText(entry.metadata.category), normalizedName);
			this.addToIndex(this.serverIndex, normalizeText(entry.metadata.serverId), normalizedName);
			this.addToIndex(this.serverIndex, normalizeText(entry.metadata.serverName), normalizedName);
		}
	}

	private addToIndex(index: Map<string, Set<string>>, key: string, toolName: string): void {
		if (!key) {
			return;
		}
		const current = index.get(key) ?? new Set<string>();
		current.add(toolName);
		index.set(key, current);
	}

	private filterEntries(filters?: {
		serverIds?: string[];
		categories?: string[];
	}): ToolLibraryEntry[] {
		if (!filters?.serverIds?.length && !filters?.categories?.length) {
			return [...this.entries];
		}

		let allowedNames: Set<string> | null = null;
		if (filters?.serverIds?.length) {
			const matched = new Set<string>();
			for (const serverId of filters.serverIds.map((item) => normalizeText(item)).filter(Boolean)) {
				for (const toolName of this.serverIndex.get(serverId) ?? []) {
					matched.add(toolName);
				}
			}
			allowedNames = matched;
		}

		if (filters?.categories?.length) {
			const matched = new Set<string>();
			for (const category of filters.categories.map((item) => normalizeText(item)).filter(Boolean)) {
				for (const toolName of this.categoryIndex.get(category) ?? []) {
					matched.add(toolName);
				}
			}

			if (allowedNames === null) {
				allowedNames = matched;
			} else {
				allowedNames = new Set([...allowedNames].filter((toolName) => matched.has(toolName)));
			}
		}

		if (!allowedNames) {
			return [...this.entries];
		}

		return this.entries.filter((entry) => allowedNames?.has(normalizeText(entry.metadata.name)));
	}

	private scoreEntry(
		entry: ToolLibraryEntry,
		normalizedQuery: string,
		searchTerms: string[]
	): ToolLibrarySearchResult | null {
		const exactKeywordMatches: string[] = [];
		const partialKeywordMatches: string[] = [];
		const scenarioMatches: string[] = [];
		const normalizedKeywords = uniqueStrings([
			entry.metadata.name,
			entry.metadata.serverId,
			entry.metadata.serverName,
			entry.metadata.category,
			...entry.metadata.keywords,
		]).map((item) => normalizeText(item));

		for (const keyword of normalizedKeywords) {
			if (!keyword) {
				continue;
			}

			if (normalizedQuery === keyword || searchTerms.includes(keyword)) {
				exactKeywordMatches.push(keyword);
				continue;
			}

			const isPartial = searchTerms.some(
				(term) => term.includes(keyword) || keyword.includes(term)
			);
			if (isPartial) {
				partialKeywordMatches.push(keyword);
			}
		}

		for (const scenario of entry.metadata.scenarios.map((item) => normalizeText(item))) {
			if (!scenario) {
				continue;
			}

			const matched =
				normalizedQuery.includes(scenario)
				|| scenario.includes(normalizedQuery)
				|| searchTerms.some((term) => scenario.includes(term) || term.includes(scenario));
			if (matched) {
				scenarioMatches.push(scenario);
			}
		}

		const score =
			exactKeywordMatches.length * 100
			+ partialKeywordMatches.length * 80
			+ scenarioMatches.length * 50;

		if (score <= 0) {
			return null;
		}

		return {
			entry,
			score,
			exactKeywordMatches,
			partialKeywordMatches,
			scenarioMatches,
		};
	}

	private formatParameterSummary(parameters: ToolLibraryParameter[]): string {
		if (parameters.length === 0) {
			return '无参数';
		}
		return parameters
			.slice(0, 6)
			.map((parameter) => `${parameter.name}:${parameter.type}${parameter.required ? '(必填)' : ''}`)
			.join('，');
	}

	private formatInlineExample(example?: ToolLibraryExample): string {
		if (!example) {
			return '无示例';
		}
		return `${example.title} -> ${JSON.stringify(example.args)}`;
	}

	private formatParametersMarkdown(parameters: ToolLibraryParameter[]): string {
		if (parameters.length === 0) {
			return '无参数。';
		}
		return parameters
			.map((parameter) =>
				`- \`${parameter.name}\`：${parameter.type}${parameter.required ? '，必填' : '，可选'}${parameter.description ? `。${parameter.description}` : ''}`
			)
			.join('\n');
	}

	private formatExamplesMarkdown(examples: ToolLibraryExample[]): string {
		if (examples.length === 0) {
			return '无示例。';
		}
		return examples
			.map(
				(example) =>
					`### ${example.title}\n${example.summary || ''}\n\n\`\`\`json\n${JSON.stringify(example.args, null, 2)}\n\`\`\``
			)
			.join('\n\n');
	}

	private getToolFilePath(toolName: string): string {
		return normalizePath(`${this.storageFolderPath}/${toolName}.md`);
	}

	private async listMarkdownFilePaths(): Promise<string[]> {
		try {
			const exists = await this.app.vault.adapter.exists(this.storageFolderPath);
			if (!exists) {
				return [];
			}
			const listing = await this.app.vault.adapter.list(this.storageFolderPath);
			return listing.files.filter((path) => path.endsWith('.md'));
		} catch (error) {
			DebugLogger.warn('[ToolLibraryManager] 列出工具库目录失败，回退为空', error);
			return [];
		}
	}

	private registerWatchers(): void {
		if (this.eventRefs.length > 0) {
			return;
		}

		this.eventRefs.push(
			this.app.vault.on('create', (file) => this.handleFileChange(file.path)),
			this.app.vault.on('modify', (file) => this.handleFileChange(file.path)),
			this.app.vault.on('delete', (file) => this.handleFileChange(file.path)),
			this.app.vault.on('rename', (file, oldPath) => {
				this.handleFileChange(file.path);
				this.handleFileChange(oldPath);
			})
		);
	}

	private disposeWatchers(): void {
		for (const eventRef of this.eventRefs) {
			this.app.vault.offref(eventRef);
		}
		this.eventRefs = [];
	}

	private handleFileChange(path: string): void {
		if (!this.isToolLibraryPath(path)) {
			return;
		}
		this.scheduleReload();
	}

	private isToolLibraryPath(path: string): boolean {
		const normalized = normalizePath(path);
		return (
			normalized === this.storageFolderPath
			|| normalized.startsWith(`${this.storageFolderPath}/`)
		);
	}

	private scheduleReload(): void {
		if (this.reloadTimer) {
			clearTimeout(this.reloadTimer);
		}

		this.reloadTimer = setTimeout(() => {
			this.reloadTimer = null;
			void this.reloadIndex();
		}, this.reloadDebounceMs);
	}
}
