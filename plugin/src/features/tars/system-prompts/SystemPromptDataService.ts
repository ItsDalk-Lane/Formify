import type { App } from 'obsidian';
import { TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import { ensureAIDataFolders, getSystemPromptsPath } from 'src/utils/AIPathManager';
import type { AiFeatureId, SystemPromptItem, SystemPromptsDataFile } from './types';
import { SYSTEM_PROMPTS_DATA_VERSION } from './types';

const FRONTMATTER_DELIMITER = '---';
const VALID_FEATURE_IDS: ReadonlySet<AiFeatureId> = new Set([
	'ai_action',
	'tars_chat',
	'tab_completion',
	'selection_toolbar',
]);

interface RawSystemPrompt extends Partial<SystemPromptItem> {}

interface FormifyPluginLike {
	loadData?: () => Promise<any>;
	settings?: {
		aiDataFolder?: string;
		tars?: {
			settings?: {
				systemPromptsData?: SystemPromptsDataFile;
			};
		};
	};
}

const isNonEmptyString = (value: unknown): value is string => {
	return typeof value === 'string' && value.trim().length > 0;
};

const toFeatureIdArray = (value: unknown): AiFeatureId[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is AiFeatureId => typeof item === 'string' && VALID_FEATURE_IDS.has(item as AiFeatureId));
};

export class SystemPromptDataService {
	private static instance: SystemPromptDataService | null = null;
	private promptsCache: SystemPromptItem[] | null = null;
	private initializePromise: Promise<void> | null = null;

	private constructor(private readonly app: App) {}

	static getInstance(app: App): SystemPromptDataService {
		if (!SystemPromptDataService.instance) {
			SystemPromptDataService.instance = new SystemPromptDataService(app);
		}
		return SystemPromptDataService.instance;
	}

	static resetInstance(): void {
		SystemPromptDataService.instance = null;
	}

	async initialize(): Promise<void> {
		if (this.initializePromise) {
			return this.initializePromise;
		}
		if (this.promptsCache !== null) {
			return;
		}

		this.initializePromise = (async () => {
			try {
				await this.loadFromFile();
				DebugLogger.debug('[SystemPromptDataService] 初始化完成，共', this.promptsCache?.length || 0, '条系统提示词');
			} catch (error) {
				DebugLogger.error('[SystemPromptDataService] 初始化失败', error);
				this.promptsCache = [];
			} finally {
				this.initializePromise = null;
			}
		})();

		return this.initializePromise;
	}

	async getPrompts(): Promise<SystemPromptItem[]> {
		await this.initialize();
		return this.promptsCache || [];
	}

	async getSortedPrompts(): Promise<SystemPromptItem[]> {
		const prompts = await this.getPrompts();
		return [...prompts].sort((a, b) => a.order - b.order);
	}

	async upsertPrompt(prompt: SystemPromptItem): Promise<void> {
		await this.initialize();
		const prompts = this.promptsCache || [];
		const index = prompts.findIndex((p) => p.id === prompt.id);
		if (index >= 0) {
			prompts[index] = prompt;
		} else {
			prompts.push(prompt);
		}
		this.promptsCache = this.normalizeOrders(prompts);
		await this.persist();
	}

	async deletePrompt(id: string): Promise<void> {
		await this.initialize();
		const prompts = (this.promptsCache || []).filter((p) => p.id !== id);
		this.promptsCache = this.normalizeOrders(prompts);
		await this.persist();
	}

	async setPromptEnabled(id: string, enabled: boolean): Promise<void> {
		await this.initialize();
		const prompts = this.promptsCache || [];
		const index = prompts.findIndex((p) => p.id === id);
		if (index < 0) {
			return;
		}
		prompts[index] = {
			...prompts[index],
			enabled,
			updatedAt: Date.now(),
		};
		this.promptsCache = prompts;
		await this.persist();
	}

	async reorderPrompts(orderedIds: string[]): Promise<void> {
		await this.initialize();
		const prompts = this.promptsCache || [];
		const byId = new Map(prompts.map((p) => [p.id, p] as const));
		const next: SystemPromptItem[] = [];
		for (const id of orderedIds) {
			const item = byId.get(id);
			if (item) {
				next.push(item);
				byId.delete(id);
			}
		}
		for (const leftover of byId.values()) {
			next.push(leftover);
		}
		this.promptsCache = next.map((item, index) => ({
			...item,
			order: index,
		}));
		await this.persist();
	}

	async migrateFromLegacyDefaultSystemMessage(params: { enabled?: boolean; content?: string | null }): Promise<boolean> {
		await this.initialize();
		const enabled = params.enabled === true;
		const content = (params.content ?? '').trim();
		if (!enabled || content.length === 0) {
			return false;
		}

		const prompts = this.promptsCache || [];
		const exists = prompts.some((p) => p.name === '默认系统消息');
		if (exists) {
			return false;
		}

		const now = Date.now();
		const migrated: SystemPromptItem = {
			id: `legacy_default_system_message_${now}`,
			name: '默认系统消息',
			sourceType: 'custom',
			content,
			templatePath: undefined,
			enabled: true,
			excludeFeatures: [] as AiFeatureId[],
			order: 0,
			createdAt: now,
			updatedAt: now,
		};

		const bumped = prompts.map((p) => ({ ...p, order: p.order + 1 }));
		this.promptsCache = this.normalizeOrders([migrated, ...bumped]);
		await this.persist();
		DebugLogger.info('[SystemPromptDataService] 已迁移旧默认系统消息到 Markdown 系统提示词目录');
		return true;
	}

	private normalizeOrders(prompts: SystemPromptItem[]): SystemPromptItem[] {
		return prompts
			.map((p) => ({ ...p }))
			.sort((a, b) => a.order - b.order)
			.map((p, index) => ({ ...p, order: index }));
	}

	private async loadFromFile(): Promise<void> {
		try {
			const folderPath = await this.getStorageFolderPath();
			if (!folderPath) {
				this.promptsCache = [];
				return;
			}

			// 使用 adapter API 直接从文件系统读取，避免在插件启动早期
			// Vault 缓存尚未就绪时 getAbstractFileByPath 返回 null 导致丢失数据
			const filePaths = await this.listMarkdownFilePathsViaAdapter(folderPath);
			const loaded: RawSystemPrompt[] = [];
			for (const [index, filePath] of filePaths.entries()) {
				try {
					const content = await this.app.vault.adapter.read(filePath);
					const basename = filePath.split('/').pop()?.replace(/\.md$/, '') ?? '';
					const { frontmatter, body } = this.parseMarkdownRecord(content);
					const item: RawSystemPrompt = {
						...frontmatter,
						id: isNonEmptyString(frontmatter.id) ? frontmatter.id : basename,
						order: typeof frontmatter.order === 'number' ? frontmatter.order : index,
						content: body,
					};
					loaded.push(item);
				} catch (error) {
					DebugLogger.warn('[SystemPromptDataService] 读取系统提示词文件失败，已跳过', { path: filePath, error });
				}
			}

			this.promptsCache = this.normalizeOrders(this.sanitizeItems(loaded));
			this.syncRuntimeSettings({
				version: SYSTEM_PROMPTS_DATA_VERSION,
				prompts: this.promptsCache,
				lastModified: Date.now(),
			});
		} catch (error) {
			DebugLogger.error('[SystemPromptDataService] 加载系统提示词配置失败，回退为空', error);
			this.promptsCache = [];
		}
	}

	private sanitizeItems(items: RawSystemPrompt[]): SystemPromptItem[] {
		const now = Date.now();
		return (items || [])
			.filter((item): item is RawSystemPrompt => !!item && typeof item === 'object')
			.map((item, index) => {
				const id = isNonEmptyString(item.id) ? item.id : `sys_prompt_${now}_${index}`;
				const sourceType = item.sourceType === 'template' ? 'template' : 'custom';
				const bodyContent = typeof item.content === 'string' ? item.content : '';

				return {
					id,
					name: isNonEmptyString(item.name) ? item.name.trim() : '未命名系统提示词',
					sourceType,
					content: sourceType === 'template' ? undefined : bodyContent,
					templatePath: sourceType === 'template' && isNonEmptyString(item.templatePath) ? item.templatePath : undefined,
					enabled: item.enabled !== false,
					excludeFeatures: toFeatureIdArray(item.excludeFeatures),
					order: typeof item.order === 'number' ? item.order : index,
					createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
					updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
				};
			});
	}

	private async persist(): Promise<void> {
		try {
			const folderPath = await this.getStorageFolderPath();
			if (!folderPath) {
				throw new Error('无法解析 AI 数据目录，无法保存系统提示词');
			}

			const prompts = this.normalizeOrders(this.promptsCache || []);
			const expectedPaths = new Set<string>();
			for (const prompt of prompts) {
				if (!isNonEmptyString(prompt.id)) {
					DebugLogger.warn('[SystemPromptDataService] 系统提示词缺少 id，已跳过写入', prompt);
					continue;
				}

				const filePath = normalizePath(`${folderPath}/${prompt.id}.md`);
				expectedPaths.add(filePath);

				const { content: _content, ...frontmatter } = prompt;
				const body = prompt.sourceType === 'template' ? '' : (prompt.content ?? '');
				const markdown = this.buildMarkdownRecord(frontmatter, body);

				const existing = this.app.vault.getAbstractFileByPath(filePath);
				if (existing instanceof TFile) {
					const previous = await this.app.vault.read(existing);
					if (previous !== markdown) {
						await this.app.vault.modify(existing, markdown);
					}
					continue;
				}

				await this.app.vault.create(filePath, markdown);
			}

			for (const file of this.listMarkdownFiles(folderPath)) {
				if (!expectedPaths.has(file.path)) {
					await this.app.vault.delete(file, true);
				}
			}

			const systemPromptsData: SystemPromptsDataFile = {
				version: SYSTEM_PROMPTS_DATA_VERSION,
				prompts,
				lastModified: Date.now(),
			};

			this.promptsCache = prompts;
			this.syncRuntimeSettings(systemPromptsData);
		} catch (error) {
			DebugLogger.error('[SystemPromptDataService] 保存系统提示词配置失败', error);
			throw error;
		}
	}

	private getPluginInstance(): FormifyPluginLike | null {
		return ((this.app as any).plugins?.plugins?.['formify'] as FormifyPluginLike | undefined) ?? null;
	}

	private async getStorageFolderPath(): Promise<string | null> {
		const plugin = this.getPluginInstance();
		let aiDataFolder = plugin?.settings?.aiDataFolder;
		if (plugin?.loadData) {
			try {
				const persisted = await plugin.loadData();
				const persistedAiDataFolder = persisted?.aiDataFolder;
				if (isNonEmptyString(persistedAiDataFolder)) {
					aiDataFolder = persistedAiDataFolder;
				}
			} catch (error) {
				DebugLogger.warn('[SystemPromptDataService] 读取 aiDataFolder 失败，回退运行时配置', error);
			}
		}
		if (!isNonEmptyString(aiDataFolder)) {
			DebugLogger.warn('[SystemPromptDataService] AI 数据目录未配置，回退为空');
			return null;
		}
		await ensureAIDataFolders(this.app, aiDataFolder);
		return getSystemPromptsPath(aiDataFolder);
	}

	/**
	 * 通过 adapter API 直接从文件系统列出 Markdown 文件路径
	 * 不依赖 Vault 缓存，确保在插件启动早期（onLayoutReady 之前）也能正确读取
	 */
	private async listMarkdownFilePathsViaAdapter(folderPath: string): Promise<string[]> {
		try {
			const exists = await this.app.vault.adapter.exists(folderPath);
			if (!exists) {
				return [];
			}
			const listing = await this.app.vault.adapter.list(folderPath);
			return listing.files.filter((f) => f.endsWith('.md'));
		} catch {
			return [];
		}
	}

	private listMarkdownFiles(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			return [];
		}
		return folder.children.filter((child): child is TFile => child instanceof TFile && child.extension === 'md');
	}

	private parseMarkdownRecord(content: string): { frontmatter: RawSystemPrompt; body: string } {
		if (!content.startsWith(FRONTMATTER_DELIMITER)) {
			return { frontmatter: {}, body: content };
		}
		const delimiterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n)?/;
		const matched = content.match(delimiterRegex);
		if (!matched) {
			return { frontmatter: {}, body: content };
		}

		try {
			const parsed = parseYaml(matched[1]);
			const frontmatter = (parsed && typeof parsed === 'object' ? parsed : {}) as RawSystemPrompt;
			const body = content.slice(matched[0].length);
			return { frontmatter, body };
		} catch (error) {
			DebugLogger.warn('[SystemPromptDataService] 解析 frontmatter 失败，已使用默认值', error);
			return { frontmatter: {}, body: '' };
		}
	}

	private buildMarkdownRecord(frontmatter: RawSystemPrompt, body: string): string {
		const yaml = stringifyYaml(frontmatter).trimEnd();
		return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${body}`;
	}

	private syncRuntimeSettings(systemPromptsData: SystemPromptsDataFile): void {
		const plugin = this.getPluginInstance();
		if (!plugin?.settings?.tars?.settings) {
			return;
		}
		plugin.settings.tars.settings.systemPromptsData = systemPromptsData;
	}

	dispose(): void {
		this.promptsCache = null;
		this.initializePromise = null;
		SystemPromptDataService.instance = null;
	}
}
