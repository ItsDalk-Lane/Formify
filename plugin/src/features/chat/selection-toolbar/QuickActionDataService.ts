import { App, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import type { QuickAction, QuickActionType } from '../types/chat';
import { DebugLogger } from 'src/utils/DebugLogger';
import { ensureAIDataFolders, getQuickActionsPath } from 'src/utils/AIPathManager';

const FRONTMATTER_DELIMITER = '---';

interface RawQuickAction extends Partial<QuickAction> {
	skillType?: QuickActionType;
	isSkillGroup?: boolean;
}

interface FormifyPluginLike {
	loadData?: () => Promise<any>;
	settings?: {
		aiDataFolder?: string;
		chat?: {
			quickActions?: QuickAction[];
			skills?: RawQuickAction[];
		};
	};
}

const isNonEmptyString = (value: unknown): value is string => {
	return typeof value === 'string' && value.trim().length > 0;
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
};

function resolveQuickActionType(raw: RawQuickAction): QuickActionType {
	if (raw.actionType === 'normal' || raw.actionType === 'group' || raw.actionType === 'form') {
		return raw.actionType;
	}
	if (raw.skillType === 'normal' || raw.skillType === 'group' || raw.skillType === 'form') {
		return raw.skillType;
	}
	if ((raw.formCommandIds?.length ?? 0) > 0) {
		return 'form';
	}
	if ((raw.isActionGroup ?? raw.isSkillGroup) === true) {
		return 'group';
	}
	return 'normal';
}

function normalizeQuickAction(
	raw: RawQuickAction,
	fallback: { id: string; order: number; prompt?: string }
): QuickAction {
	const now = Date.now();
	const actionType = resolveQuickActionType(raw);
	const isActionGroup = raw.isActionGroup ?? raw.isSkillGroup ?? actionType === 'group';
	const {
		skillType: _legacySkillType,
		isSkillGroup: _legacyIsSkillGroup,
		...rawWithoutLegacyFields
	} = raw;
	const promptSource = raw.promptSource === 'template' ? 'template' : 'custom';
	const defaultPrompt = isNonEmptyString(fallback.prompt) ? fallback.prompt : '';
	const rawPrompt = typeof raw.prompt === 'string' ? raw.prompt : defaultPrompt;
	const normalizedPrompt = promptSource === 'template' ? '' : rawPrompt;
	const rawName = typeof raw.name === 'string' ? raw.name.trim() : '';
	const normalizedName = rawName || '未命名操作';

	return {
		...rawWithoutLegacyFields,
		id: isNonEmptyString(raw.id) ? raw.id : fallback.id,
		name: normalizedName,
		prompt: normalizedPrompt,
		actionType,
		isActionGroup,
		children: toStringArray(raw.children),
		promptSource,
		showInToolbar: raw.showInToolbar ?? true,
		useDefaultSystemPrompt: raw.useDefaultSystemPrompt ?? true,
		customPromptRole: raw.customPromptRole === 'user' ? 'user' : 'system',
		formCommandIds: toStringArray(raw.formCommandIds),
		templateFile: typeof raw.templateFile === 'string' ? raw.templateFile : undefined,
		modelTag: typeof raw.modelTag === 'string' ? raw.modelTag : undefined,
		order: typeof raw.order === 'number' ? raw.order : fallback.order,
		createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
	} as QuickAction;
}

function normalizeQuickActions(rawList: unknown[], promptResolver?: (item: RawQuickAction, index: number) => string): QuickAction[] {
	const now = Date.now();
	return rawList
		.filter((item): item is RawQuickAction => !!item && typeof item === 'object')
		.map((item, index) =>
			normalizeQuickAction(item, {
				id: isNonEmptyString(item.id) ? item.id : `quick_action_${now}_${index}`,
				order: index,
				prompt: promptResolver?.(item, index) ?? '',
			})
		);
}

/**
 * 快捷操作数据服务
 * 负责管理快捷操作的 Markdown 文件持久化
 */
export class QuickActionDataService {
	private static instance: QuickActionDataService | null = null;
	private quickActionsCache: QuickAction[] | null = null;
	private initializePromise: Promise<void> | null = null;

	private constructor(private readonly app: App) {}

	/**
	 * 获取单例实例
	 */
	static getInstance(app: App): QuickActionDataService {
		if (!QuickActionDataService.instance) {
			QuickActionDataService.instance = new QuickActionDataService(app);
		}
		return QuickActionDataService.instance;
	}

	/**
	 * 重置实例（主要用于测试）
	 */
	static resetInstance(): void {
		QuickActionDataService.instance = null;
	}

	/**
	 * 初始化服务
	 */
	async initialize(): Promise<void> {
		if (this.initializePromise) {
			return this.initializePromise;
		}

		if (this.quickActionsCache !== null) {
			return;
		}

		this.initializePromise = (async () => {
			try {
				await this.loadQuickActions();
				DebugLogger.debug('[QuickActionDataService] 初始化完成，共', this.quickActionsCache?.length || 0, '个操作');
			} catch (error) {
				DebugLogger.error('[QuickActionDataService] 初始化失败', error);
				this.quickActionsCache = [];
			} finally {
				this.initializePromise = null;
			}
		})();

		return this.initializePromise;
	}

	/**
	 * 获取所有快捷操作
	 */
	async getQuickActions(): Promise<QuickAction[]> {
		await this.initialize();
		return this.quickActionsCache || [];
	}

	/**
	 * 获取快捷操作（按排序）
	 */
	async getSortedQuickActions(): Promise<QuickAction[]> {
		const quickActions = await this.getQuickActions();
		return [...quickActions].sort((a, b) => a.order - b.order);
	}

	/**
	 * 根据 ID 获取快捷操作
	 */
	async getQuickActionById(id: string): Promise<QuickAction | undefined> {
		const quickActions = await this.getQuickActions();
		return quickActions.find((quickAction) => quickAction.id === id);
	}

	/**
	 * 获取指定操作组的直接子操作列表
	 */
	async getQuickActionChildren(id: string): Promise<QuickAction[]> {
		const quickActions = await this.getQuickActions();
		const group = quickActions.find((quickAction) => quickAction.id === id);
		if (!group || !group.isActionGroup) {
			return [];
		}

		const childrenIds = group.children ?? [];
		const byId = new Map(quickActions.map((quickAction) => [quickAction.id, quickAction] as const));
		return childrenIds
			.map((childId) => byId.get(childId))
			.filter(Boolean) as QuickAction[];
	}

	/**
	 * 递归获取所有后代快捷操作（按展示顺序平铺）
	 */
	async getAllDescendants(id: string): Promise<QuickAction[]> {
		await this.initialize();
		const quickActions = this.quickActionsCache || [];
		const byId = new Map(quickActions.map((quickAction) => [quickAction.id, quickAction] as const));
		const visited = new Set<string>();
		const result: QuickAction[] = [];

		const walk = (groupId: string): void => {
			const group = byId.get(groupId);
			if (!group || !group.isActionGroup || visited.has(groupId)) {
				return;
			}
			visited.add(groupId);

			for (const childId of (group.children ?? [])) {
				const child = byId.get(childId);
				if (!child) {
					continue;
				}
				result.push(child);
				if (child.isActionGroup) {
					walk(child.id);
				}
			}
		};

		walk(id);
		return result;
	}

	/**
	 * 将快捷操作移动到指定操作组或主列表
	 * @param targetGroupId 目标操作组 ID；为 null 表示主列表
	 * @param position 插入位置（不传则追加到末尾）
	 */
	async moveQuickActionToGroup(quickActionId: string, targetGroupId: string | null, position?: number): Promise<void> {
		await this.initialize();
		const quickActions = this.quickActionsCache || [];
		const byId = new Map(quickActions.map((quickAction) => [quickAction.id, quickAction] as const));
		const quickAction = byId.get(quickActionId);
		if (!quickAction) {
			return;
		}

		const subtreeDepth = this.getSubtreeMaxRelativeDepthSync(quickActionId, quickActions);

		if (targetGroupId !== null) {
			const targetGroup = byId.get(targetGroupId);
			if (!targetGroup || !targetGroup.isActionGroup) {
				throw new Error('目标不是有效的操作组');
			}

			if (targetGroupId === quickActionId) {
				throw new Error('不能将操作组移动到自身内部');
			}
			const descendants = await this.getAllDescendants(quickActionId);
			if (descendants.some((d) => d.id === targetGroupId)) {
				throw new Error('不能将操作组移动到其后代内部');
			}

			const targetLevel = this.getNestingLevelSync(targetGroupId, quickActions) + 1;
			if (targetLevel + subtreeDepth > 2) {
				throw new Error('最多支持 3 层嵌套');
			}
		}

		this.removeFromAllGroupsSync(quickActionId, quickActions);

		if (targetGroupId === null) {
			await this.reorderTopLevelQuickActionsSync(quickActions, quickActionId, position);
			this.quickActionsCache = quickActions;
			await this.persistQuickActions();
			return;
		}

		const targetGroup = byId.get(targetGroupId);
		if (!targetGroup || !targetGroup.isActionGroup) {
			throw new Error('目标不是有效的操作组');
		}

		const children = [...(targetGroup.children ?? [])].filter((id) => id !== quickActionId);
		const insertAt = position === undefined ? children.length : Math.max(0, Math.min(position, children.length));
		children.splice(insertAt, 0, quickActionId);
		targetGroup.children = children;
		targetGroup.updatedAt = Date.now();

		await this.reorderTopLevelQuickActionsSync(quickActions);
		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
	}

	/**
	 * 更新操作组的子操作列表
	 */
	async updateQuickActionGroupChildren(groupId: string, childrenIds: string[]): Promise<void> {
		await this.initialize();
		const quickActions = this.quickActionsCache || [];
		const group = quickActions.find((quickAction) => quickAction.id === groupId);
		if (!group || !group.isActionGroup) {
			throw new Error('目标不是有效的操作组');
		}

		const byId = new Map(quickActions.map((quickAction) => [quickAction.id, quickAction] as const));
		const seen = new Set<string>();
		const normalized: string[] = [];
		for (const id of childrenIds) {
			if (!byId.has(id) || id === groupId || seen.has(id)) {
				continue;
			}
			seen.add(id);
			normalized.push(id);
		}

		const groupLevel = this.getNestingLevelSync(groupId, quickActions);
		for (const childId of normalized) {
			if (childId === groupId) {
				throw new Error('操作组不能包含自身');
			}

			const childDescendants = await this.getAllDescendants(childId);
			if (childDescendants.some((quickAction) => quickAction.id === groupId)) {
				throw new Error('操作组 children 存在循环引用');
			}

			const childSubtreeDepth = this.getSubtreeMaxRelativeDepthSync(childId, quickActions);
			if (groupLevel + 1 + childSubtreeDepth > 2) {
				throw new Error('最多支持 3 层嵌套');
			}
		}

		group.children = normalized;
		group.updatedAt = Date.now();
		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
	}

	/**
	 * 计算快捷操作嵌套层级（顶层=0）
	 */
	async getNestingLevel(quickActionId: string): Promise<number> {
		await this.initialize();
		return this.getNestingLevelSync(quickActionId, this.quickActionsCache || []);
	}

	private getNestingLevelSync(quickActionId: string, quickActions: QuickAction[]): number {
		let level = 0;
		let currentId: string | null = quickActionId;
		const seen = new Set<string>();
		while (currentId) {
			if (seen.has(currentId)) {
				break;
			}
			seen.add(currentId);
			const parent = this.findParentGroupSync(currentId, quickActions);
			if (!parent) {
				break;
			}
			level += 1;
			currentId = parent.id;
		}
		return level;
	}

	private findParentGroupSync(quickActionId: string, quickActions: QuickAction[]): QuickAction | null {
		for (const quickAction of quickActions) {
			if (quickAction.isActionGroup && (quickAction.children ?? []).includes(quickActionId)) {
				return quickAction;
			}
		}
		return null;
	}

	private removeFromAllGroupsSync(quickActionId: string, quickActions: QuickAction[]): void {
		for (const quickAction of quickActions) {
			if (!quickAction.isActionGroup) {
				continue;
			}
			const before = quickAction.children ?? [];
			const after = before.filter((id) => id !== quickActionId);
			if (after.length !== before.length) {
				quickAction.children = after;
				quickAction.updatedAt = Date.now();
			}
		}
	}

	private getSubtreeMaxRelativeDepthSync(quickActionId: string, quickActions: QuickAction[]): number {
		const byId = new Map(quickActions.map((quickAction) => [quickAction.id, quickAction] as const));
		const seen = new Set<string>();

		const dfs = (currentId: string): number => {
			if (seen.has(currentId)) {
				return 0;
			}
			seen.add(currentId);
			const current = byId.get(currentId);
			if (!current || !current.isActionGroup) {
				return 0;
			}
			let maxChild = 0;
			for (const childId of current.children ?? []) {
				maxChild = Math.max(maxChild, 1 + dfs(childId));
			}
			return maxChild;
		};

		return dfs(quickActionId);
	}

	private async reorderTopLevelQuickActionsSync(quickActions: QuickAction[], movingQuickActionId?: string, position?: number): Promise<void> {
		const referenced = new Set<string>();
		for (const quickAction of quickActions) {
			if (!quickAction.isActionGroup) {
				continue;
			}
			for (const id of quickAction.children ?? []) {
				referenced.add(id);
			}
		}

		const topLevel = quickActions
			.filter((quickAction) => !referenced.has(quickAction.id))
			.sort((a, b) => a.order - b.order);

		if (movingQuickActionId) {
			const movingIndex = topLevel.findIndex((quickAction) => quickAction.id === movingQuickActionId);
			if (movingIndex >= 0) {
				const [moving] = topLevel.splice(movingIndex, 1);
				const insertAt = position === undefined ? topLevel.length : Math.max(0, Math.min(position, topLevel.length));
				topLevel.splice(insertAt, 0, moving);
			}
		}

		topLevel.forEach((quickAction, index) => {
			quickAction.order = index;
			quickAction.updatedAt = Date.now();
		});
	}

	/**
	 * 保存快捷操作（新增或更新）
	 */
	async saveQuickAction(quickAction: QuickAction): Promise<void> {
		const quickActions = await this.getQuickActions();
		const existingIndex = quickActions.findIndex((item) => item.id === quickAction.id);

		if (existingIndex >= 0) {
			quickActions[existingIndex] = quickAction;
			DebugLogger.debug('[QuickActionDataService] 更新操作', quickAction.name);
		} else {
			quickActions.push(quickAction);
			DebugLogger.debug('[QuickActionDataService] 新增操作', quickAction.name);
		}

		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
	}

	/**
	 * 删除快捷操作
	 */
	async deleteQuickAction(id: string): Promise<void> {
		const quickActions = await this.getQuickActions();
		const index = quickActions.findIndex((item) => item.id === id);
		if (index < 0) {
			return;
		}

		this.removeFromAllGroupsSync(id, quickActions);
		const deletedQuickAction = quickActions.splice(index, 1)[0];
		DebugLogger.debug('[QuickActionDataService] 删除操作', deletedQuickAction.name);
		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
	}

	/**
	 * 更新快捷操作排序
	 */
	async updateQuickActionsOrder(orderedIds: string[]): Promise<void> {
		const quickActions = await this.getQuickActions();
		orderedIds.forEach((id, index) => {
			const quickAction = quickActions.find((item) => item.id === id);
			if (quickAction) {
				quickAction.order = index;
				quickAction.updatedAt = Date.now();
			}
		});

		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
		DebugLogger.debug('[QuickActionDataService] 更新操作排序');
	}

	/**
	 * 更新快捷操作显示状态
	 */
	async updateQuickActionShowInToolbar(id: string, showInToolbar: boolean): Promise<void> {
		const quickActions = await this.getQuickActions();
		const quickAction = quickActions.find((item) => item.id === id);
		if (!quickAction) {
			return;
		}

		quickAction.showInToolbar = showInToolbar;
		quickAction.updatedAt = Date.now();
		this.quickActionsCache = quickActions;
		await this.persistQuickActions();
		DebugLogger.debug('[QuickActionDataService] 更新操作显示状态', quickAction.name, showInToolbar);
	}

	/**
	 * 历史迁移入口已停用（保留签名用于兼容外部调用）
	 */
	async migrateFromSettings(_legacyQuickActions: QuickAction[]): Promise<void> {
		DebugLogger.debug('[QuickActionDataService] migrateFromSettings 已停用，忽略调用');
	}

	/**
	 * 从 quick-actions/*.md 加载快捷操作
	 */
	private async loadQuickActions(): Promise<void> {
		try {
			const folderPath = await this.getStorageFolderPath();
			if (!folderPath) {
				this.quickActionsCache = [];
				return;
			}

			const files = this.listMarkdownFiles(folderPath);
			const loaded: RawQuickAction[] = [];
			for (const [index, file] of files.entries()) {
				try {
					const content = await this.app.vault.read(file);
					const { frontmatter, body } = this.parseMarkdownRecord(content);
					const item: RawQuickAction = {
						...frontmatter,
						id: isNonEmptyString(frontmatter.id) ? frontmatter.id : file.basename,
						order: typeof frontmatter.order === 'number' ? frontmatter.order : index,
						prompt: body,
					};
					loaded.push(item);
				} catch (error) {
					DebugLogger.warn('[QuickActionDataService] 读取快捷操作文件失败，已跳过', { path: file.path, error });
				}
			}

			this.quickActionsCache = normalizeQuickActions(loaded).sort((a, b) => a.order - b.order);
			this.syncRuntimeSettings(this.quickActionsCache);
			DebugLogger.debug('[QuickActionDataService] 已从 Markdown 加载快捷操作，共', this.quickActionsCache.length, '个操作');
		} catch (error) {
			DebugLogger.error('[QuickActionDataService] 加载操作数据失败', error);
			this.quickActionsCache = [];
		}
	}

	/**
	 * 将缓存全量同步到 quick-actions/*.md，并清理无效旧文件
	 */
	private async persistQuickActions(): Promise<void> {
		const folderPath = await this.getStorageFolderPath();
		if (!folderPath) {
			throw new Error('无法解析 AI 数据目录，无法保存快捷操作');
		}

		const normalizedCache = normalizeQuickActions(this.quickActionsCache || []);
		const expectedPaths = new Set<string>();
		for (const quickAction of normalizedCache) {
			if (!isNonEmptyString(quickAction.id)) {
				DebugLogger.warn('[QuickActionDataService] 快捷操作缺少 id，已跳过写入', quickAction);
				continue;
			}

			const filePath = normalizePath(`${folderPath}/${quickAction.id}.md`);
			expectedPaths.add(filePath);

			const { prompt: _prompt, ...frontmatter } = quickAction as RawQuickAction;
			const body = quickAction.promptSource === 'template' ? '' : (quickAction.prompt ?? '');
			const content = this.buildMarkdownRecord(frontmatter, body);

			const existing = this.app.vault.getAbstractFileByPath(filePath);
			if (existing instanceof TFile) {
				const previous = await this.app.vault.read(existing);
				if (previous !== content) {
					await this.app.vault.modify(existing, content);
				}
				continue;
			}

			await this.app.vault.create(filePath, content);
		}

		for (const file of this.listMarkdownFiles(folderPath)) {
			if (!expectedPaths.has(file.path)) {
				await this.app.vault.delete(file, true);
			}
		}

		this.quickActionsCache = normalizedCache;
		this.syncRuntimeSettings(normalizedCache);
		DebugLogger.debug('[QuickActionDataService] 快捷操作已同步到 Markdown 文件');
	}

	private getPluginInstance(): FormifyPluginLike | null {
		return ((this.app as any).plugins?.plugins?.formify as FormifyPluginLike | undefined) ?? null;
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
				DebugLogger.warn('[QuickActionDataService] 读取 aiDataFolder 失败，回退运行时配置', error);
			}
		}
		if (!isNonEmptyString(aiDataFolder)) {
			DebugLogger.warn('[QuickActionDataService] AI 数据目录未配置，回退为空');
			return null;
		}

		await ensureAIDataFolders(this.app, aiDataFolder);
		return getQuickActionsPath(aiDataFolder);
	}

	private listMarkdownFiles(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			return [];
		}
		return folder.children.filter((child): child is TFile => child instanceof TFile && child.extension === 'md');
	}

	private parseMarkdownRecord(content: string): { frontmatter: RawQuickAction; body: string } {
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
			const frontmatter = (parsed && typeof parsed === 'object' ? parsed : {}) as RawQuickAction;
			const body = content.slice(matched[0].length);
			return { frontmatter, body };
		} catch (error) {
			DebugLogger.warn('[QuickActionDataService] 解析 frontmatter 失败，已使用默认值', error);
			return { frontmatter: {}, body: '' };
		}
	}

	private buildMarkdownRecord(frontmatter: RawQuickAction, body: string): string {
		const yaml = stringifyYaml(frontmatter).trimEnd();
		return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${body}`;
	}

	private syncRuntimeSettings(quickActions: QuickAction[]): void {
		const plugin = this.getPluginInstance();
		if (!plugin?.settings?.chat) {
			return;
		}
		plugin.settings.chat.quickActions = quickActions;
		if ('skills' in plugin.settings.chat) {
			delete (plugin.settings.chat as any).skills;
		}
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.quickActionsCache = null;
		this.initializePromise = null;
		QuickActionDataService.instance = null;
	}
}
