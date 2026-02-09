import type { App } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import type { AiFeatureId, SystemPromptItem, SystemPromptsDataFile } from './types';
import { SYSTEM_PROMPTS_DATA_VERSION } from './types';

const LEGACY_SYSTEM_PROMPTS_DATA_FILE = '.obsidian/plugins/formify/system-prompts.json';

const DEFAULT_DATA: SystemPromptsDataFile = {
	version: SYSTEM_PROMPTS_DATA_VERSION,
	prompts: [],
	lastModified: Date.now(),
};

interface FormifyPluginLike {
	loadData: () => Promise<any>;
	saveData: (data: any) => Promise<void>;
	settings?: {
		tars?: {
			settings?: {
				systemPromptsData?: SystemPromptsDataFile;
			};
		};
	};
}

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
		DebugLogger.info('[SystemPromptDataService] 已迁移旧默认系统消息到 data.json.tars.settings.systemPromptsData');
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
			const plugin = this.getPluginInstance();
			if (!plugin) {
				DebugLogger.error('[SystemPromptDataService] 无法获取 formify 插件实例，回退为空');
				this.promptsCache = [];
				return;
			}

			const persisted = (await plugin.loadData()) ?? {};
			const tarsSettingsData = persisted?.tars?.settings;
			if (tarsSettingsData && Object.prototype.hasOwnProperty.call(tarsSettingsData, 'systemPromptsData')) {
				const parsed = tarsSettingsData.systemPromptsData as Partial<SystemPromptsDataFile> | undefined;
				const data: SystemPromptsDataFile = {
					...DEFAULT_DATA,
					...(parsed ?? {}),
					prompts: Array.isArray(parsed?.prompts) ? (parsed?.prompts as any) : [],
					lastModified: typeof parsed?.lastModified === 'number' ? parsed.lastModified : Date.now(),
				};
				this.promptsCache = this.normalizeOrders(this.sanitizeItems(data.prompts));
				this.syncRuntimeSettings({
					version: SYSTEM_PROMPTS_DATA_VERSION,
					prompts: this.promptsCache,
					lastModified: data.lastModified,
				});
				DebugLogger.debug('[SystemPromptDataService] 从 data.json.tars.settings.systemPromptsData 加载成功，共', this.promptsCache.length, '条系统提示词');
				return;
			}

			const migrated = await this.migrateFromLegacyFile();
			if (migrated) {
				return;
			}

			this.promptsCache = [];
		} catch (error) {
			DebugLogger.error('[SystemPromptDataService] 加载系统提示词配置失败，回退为空', error);
			this.promptsCache = [];
		}
	}

	private sanitizeItems(items: any[]): SystemPromptItem[] {
		const now = Date.now();
		return (items || [])
			.filter(Boolean)
			.map((item, index) => {
				const id = typeof item.id === 'string' && item.id ? item.id : `sys_prompt_${now}_${index}`;
				const name = typeof item.name === 'string' ? item.name : '';
				const sourceType = item.sourceType === 'template' ? 'template' : 'custom';
				const enabled = item.enabled !== false;
				const content = typeof item.content === 'string' ? item.content : undefined;
				const templatePath = typeof item.templatePath === 'string' ? item.templatePath : undefined;
				const excludeFeatures = Array.isArray(item.excludeFeatures) ? item.excludeFeatures.filter((v: any) => typeof v === 'string') : [];
				const createdAt = typeof item.createdAt === 'number' ? item.createdAt : now;
				const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : now;
				const order = typeof item.order === 'number' ? item.order : index;

				return {
					id,
					name,
					sourceType,
					content,
					templatePath,
					enabled,
					excludeFeatures,
					order,
					createdAt,
					updatedAt,
				} as SystemPromptItem;
			});
	}

	private async persist(): Promise<void> {
		try {
			const plugin = this.getPluginInstance();
			if (!plugin) {
				throw new Error('无法获取 formify 插件实例，无法保存系统提示词');
			}

			const data: SystemPromptsDataFile = {
				version: SYSTEM_PROMPTS_DATA_VERSION,
				prompts: this.promptsCache || [],
				lastModified: Date.now(),
			};

			const persisted = (await plugin.loadData()) ?? {};
			const next = {
				...persisted,
				tars: {
					...(persisted?.tars ?? {}),
					settings: {
						...(persisted?.tars?.settings ?? {}),
						systemPromptsData: data,
					},
				},
			};

			await plugin.saveData(next);
			this.syncRuntimeSettings(data);
		} catch (error) {
			DebugLogger.error('[SystemPromptDataService] 保存系统提示词配置失败', error);
			throw error;
		}
	}

	private async migrateFromLegacyFile(): Promise<boolean> {
		try {
			const exists = await this.app.vault.adapter.exists(LEGACY_SYSTEM_PROMPTS_DATA_FILE);
			if (!exists) {
				return false;
			}

			const raw = await this.app.vault.adapter.read(LEGACY_SYSTEM_PROMPTS_DATA_FILE);
			const parsed = JSON.parse(raw) as Partial<SystemPromptsDataFile>;
			const data: SystemPromptsDataFile = {
				...DEFAULT_DATA,
				...parsed,
				prompts: Array.isArray(parsed?.prompts) ? (parsed.prompts as any) : [],
				lastModified: typeof parsed?.lastModified === 'number' ? parsed.lastModified : Date.now(),
			};

			this.promptsCache = this.normalizeOrders(this.sanitizeItems(data.prompts));
			await this.persist();
			await this.removeLegacyFile();
			DebugLogger.info('[SystemPromptDataService] 已将旧 system-prompts.json 迁移到 data.json.tars.settings.systemPromptsData，共', this.promptsCache.length, '条');
			return true;
		} catch (error) {
			DebugLogger.error('[SystemPromptDataService] 迁移旧版 system-prompts.json 失败', error);
			this.promptsCache = [];
			return false;
		}
	}

	private async removeLegacyFile(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(LEGACY_SYSTEM_PROMPTS_DATA_FILE);
			if (!exists) {
				return;
			}
			await this.app.vault.adapter.remove(LEGACY_SYSTEM_PROMPTS_DATA_FILE);
			DebugLogger.info('[SystemPromptDataService] 已删除旧系统提示词文件', LEGACY_SYSTEM_PROMPTS_DATA_FILE);
		} catch (error) {
			DebugLogger.warn('[SystemPromptDataService] 删除旧系统提示词文件失败（忽略）', error);
		}
	}

	private getPluginInstance(): FormifyPluginLike | null {
		return ((this.app as any).plugins?.plugins?.['formify'] as FormifyPluginLike | undefined) ?? null;
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
