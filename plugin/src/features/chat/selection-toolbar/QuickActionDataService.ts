import { App } from 'obsidian';
import type { QuickAction, QuickActionType } from '../types/chat';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 旧版快捷操作独立文件（仅用于迁移）
 */
const LEGACY_QUICK_ACTIONS_DATA_FILE = '.obsidian/plugins/formify/skills.json';

interface RawQuickAction extends Partial<QuickAction> {
	skillType?: QuickActionType;
	isSkillGroup?: boolean;
}

/**
 * 旧版快捷操作数据结构（skills.json）
 */
interface LegacyQuickActionsData {
	version?: number;
	quickActions?: RawQuickAction[];
	skills?: RawQuickAction[];
	lastModified?: number;
}

interface FormifyPluginLike {
	loadData: () => Promise<any>;
	saveData: (data: any) => Promise<void>;
	settings?: {
		chat?: {
			quickActions?: QuickAction[];
			skills?: RawQuickAction[];
		};
	};
}

function resolveQuickActionType(raw: RawQuickAction): QuickActionType {
	if (raw.actionType) {
		return raw.actionType;
	}
	if (raw.skillType) {
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

function normalizeQuickAction(raw: RawQuickAction): QuickAction {
	const actionType = resolveQuickActionType(raw);
	const isActionGroup = raw.isActionGroup ?? raw.isSkillGroup ?? actionType === 'group';
	const {
		skillType: _legacySkillType,
		isSkillGroup: _legacyIsSkillGroup,
		...rawWithoutLegacyFields
	} = raw;

	return {
		...rawWithoutLegacyFields,
		actionType,
		isActionGroup,
		children: Array.isArray(raw.children) ? raw.children : [],
		promptSource: raw.promptSource ?? 'custom',
		showInToolbar: raw.showInToolbar ?? true,
		useDefaultSystemPrompt: raw.useDefaultSystemPrompt ?? true,
		customPromptRole: raw.customPromptRole ?? 'system',
		formCommandIds: Array.isArray(raw.formCommandIds) ? raw.formCommandIds : [],
	} as QuickAction;
}

function normalizeQuickActions(rawList: unknown[]): QuickAction[] {
	return rawList
		.filter((item): item is RawQuickAction => !!item && typeof item === 'object')
		.map((item) => normalizeQuickAction(item));
}

/**
 * 快捷操作数据服务
 * 负责管理快捷操作的 data.json 持久化
 */
export class QuickActionDataService {
	private static instance: QuickActionDataService | null = null;
	private quickActionsCache: QuickAction[] | null = null;
	private initializePromise: Promise<void> | null = null;
	private hasCanonicalQuickActionsField = false;

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
	 * 从旧设置迁移快捷操作数据
	 * 用于将旧版 settings 中的数据迁移到 data.json.chat.quickActions
	 */
	async migrateFromSettings(legacyQuickActions: QuickAction[]): Promise<void> {
		DebugLogger.debug('[QuickActionDataService] 开始检查数据迁移，旧操作数量:', legacyQuickActions?.length || 0);

		if (this.hasCanonicalQuickActionsField) {
			DebugLogger.debug('[QuickActionDataService] data.json.chat.quickActions 已存在，跳过迁移');
			return;
		}

		if (!legacyQuickActions || legacyQuickActions.length === 0) {
			DebugLogger.debug('[QuickActionDataService] 没有旧数据需要迁移');
			return;
		}

		const existingQuickActions = await this.getQuickActions();
		if (existingQuickActions.length > 0) {
			DebugLogger.debug('[QuickActionDataService] 已存在操作数据，跳过迁移');
			return;
		}

		const migratedQuickActions = legacyQuickActions.map((quickAction) => normalizeQuickAction(quickAction));
		this.quickActionsCache = migratedQuickActions;
		await this.persistQuickActions();
		DebugLogger.debug('[QuickActionDataService] 迁移完成，共迁移', migratedQuickActions.length, '个操作');
	}

	/**
	 * 从 data.json 加载快捷操作数据；若不存在则尝试迁移
	 */
	private async loadQuickActions(): Promise<void> {
		try {
			const plugin = this.getPluginInstance();
			if (!plugin) {
				DebugLogger.error('[QuickActionDataService] 无法获取 formify 插件实例，回退为空');
				this.quickActionsCache = [];
				return;
			}

			const persisted = (await plugin.loadData()) ?? {};
			const chatData = persisted?.chat;

			if (chatData && Object.prototype.hasOwnProperty.call(chatData, 'quickActions')) {
				this.hasCanonicalQuickActionsField = true;
				const rawQuickActions = Array.isArray(chatData.quickActions) ? chatData.quickActions : [];
				this.quickActionsCache = normalizeQuickActions(rawQuickActions);
				this.syncRuntimeSettings(this.quickActionsCache);
				DebugLogger.debug('[QuickActionDataService] 从 data.json.chat.quickActions 加载成功，共', this.quickActionsCache.length, '个操作');
				return;
			}

			const migratedFromChatSkills = await this.migrateFromDataJsonSkills(plugin, persisted);
			if (migratedFromChatSkills) {
				return;
			}

			this.hasCanonicalQuickActionsField = false;
			const migratedFromLegacyFile = await this.migrateFromLegacyFile();
			if (migratedFromLegacyFile) {
				return;
			}

			this.quickActionsCache = [];
			DebugLogger.debug('[QuickActionDataService] data.json 中未找到操作数据，初始化空列表');
		} catch (error) {
			DebugLogger.error('[QuickActionDataService] 加载操作数据失败', error);
			this.quickActionsCache = [];
		}
	}

	/**
	 * 新增迁移路径：从 data.json.chat.skills 迁移到 data.json.chat.quickActions
	 */
	private async migrateFromDataJsonSkills(plugin: FormifyPluginLike, persisted: any): Promise<boolean> {
		const chatData = persisted?.chat;
		if (!chatData) {
			return false;
		}
		if (Object.prototype.hasOwnProperty.call(chatData, 'quickActions')) {
			return false;
		}
		if (!Object.prototype.hasOwnProperty.call(chatData, 'skills')) {
			return false;
		}

		const rawLegacyQuickActions = Array.isArray(chatData.skills) ? chatData.skills : [];
		const migratedQuickActions = normalizeQuickActions(
			rawLegacyQuickActions.map((item: any) => ({
				...item,
				actionType: item?.actionType ?? item?.skillType,
				isActionGroup: item?.isActionGroup ?? item?.isSkillGroup,
			}))
		);

		const nextChat: Record<string, unknown> = {
			...chatData,
			quickActions: migratedQuickActions,
		};
		delete nextChat.skills;

		await plugin.saveData({
			...persisted,
			chat: nextChat,
		});

		this.quickActionsCache = migratedQuickActions;
		this.hasCanonicalQuickActionsField = true;
		this.syncRuntimeSettings(migratedQuickActions);
		DebugLogger.info('[QuickActionDataService] 已将 data.json.chat.skills 迁移到 data.json.chat.quickActions，共', migratedQuickActions.length, '个操作');
		return true;
	}

	/**
	 * 将快捷操作数据持久化到 data.json.chat.quickActions
	 */
	private async persistQuickActions(): Promise<void> {
		const plugin = this.getPluginInstance();
		if (!plugin) {
			throw new Error('无法获取 formify 插件实例，无法保存快捷操作数据');
		}

		const persisted = (await plugin.loadData()) ?? {};
		const nextChat: Record<string, unknown> = {
			...(persisted?.chat ?? {}),
			quickActions: this.quickActionsCache || [],
		};
		delete nextChat.skills;

		await plugin.saveData({
			...persisted,
			chat: nextChat,
		});

		this.hasCanonicalQuickActionsField = true;
		this.syncRuntimeSettings(this.quickActionsCache || []);
		DebugLogger.debug('[QuickActionDataService] 保存操作数据到 data.json.chat.quickActions 成功');
	}

	/**
	 * 从旧版 skills.json 迁移到 data.json.chat.quickActions
	 */
	private async migrateFromLegacyFile(): Promise<boolean> {
		try {
			const fileExists = await this.app.vault.adapter.exists(LEGACY_QUICK_ACTIONS_DATA_FILE);
			if (!fileExists) {
				return false;
			}

			const content = await this.app.vault.adapter.read(LEGACY_QUICK_ACTIONS_DATA_FILE);
			const parsed = JSON.parse(content) as LegacyQuickActionsData | RawQuickAction[];
			const rawQuickActions = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.quickActions)
					? parsed.quickActions
					: Array.isArray(parsed?.skills)
						? parsed.skills
						: [];

			this.quickActionsCache = normalizeQuickActions(rawQuickActions);
			await this.persistQuickActions();
			await this.removeLegacyQuickActionsFile();
			this.syncRuntimeSettings(this.quickActionsCache);
			DebugLogger.info('[QuickActionDataService] 已将旧 skills.json 迁移到 data.json.chat.quickActions，共', this.quickActionsCache.length, '个操作');
			return true;
		} catch (error) {
			DebugLogger.error('[QuickActionDataService] 迁移旧版 skills.json 失败', error);
			this.quickActionsCache = [];
			return false;
		}
	}

	private async removeLegacyQuickActionsFile(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(LEGACY_QUICK_ACTIONS_DATA_FILE);
			if (!exists) {
				return;
			}
			await this.app.vault.adapter.remove(LEGACY_QUICK_ACTIONS_DATA_FILE);
			DebugLogger.info('[QuickActionDataService] 已删除旧操作文件', LEGACY_QUICK_ACTIONS_DATA_FILE);
		} catch (error) {
			DebugLogger.warn('[QuickActionDataService] 删除旧操作文件失败（忽略）', error);
		}
	}

	private getPluginInstance(): FormifyPluginLike | null {
		return ((this.app as any).plugins?.plugins?.formify as FormifyPluginLike | undefined) ?? null;
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
