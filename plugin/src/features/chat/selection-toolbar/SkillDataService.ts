import { App } from 'obsidian';
import type { Skill } from '../types/chat';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 技能数据文件名
 */
const SKILLS_DATA_FILE = '.obsidian/plugins/formify/skills.json';

/**
 * 技能数据结构
 */
interface SkillsData {
	version: number;
	skills: Skill[];
	lastModified: number;
}

/**
 * 默认技能数据
 */
const DEFAULT_SKILLS_DATA: SkillsData = {
	version: 2,
	skills: [],
	lastModified: Date.now()
};

const SKILLS_DATA_VERSION = 2;

const normalizeSkill = (skill: Skill): Skill => ({
	...skill,
	isSkillGroup: skill.isSkillGroup ?? false,
	children: skill.children ?? [],
});

/**
 * 技能数据服务
 * 负责管理技能数据的独立存储
 */
export class SkillDataService {
	private static instance: SkillDataService | null = null;
	private skillsCache: Skill[] | null = null;
	private initializePromise: Promise<void> | null = null;

	private constructor(private readonly app: App) {}

	/**
	 * 获取单例实例
	 */
	static getInstance(app: App): SkillDataService {
		if (!SkillDataService.instance) {
			SkillDataService.instance = new SkillDataService(app);
		}
		return SkillDataService.instance;
	}

	/**
	 * 重置实例（主要用于测试）
	 */
	static resetInstance(): void {
		SkillDataService.instance = null;
	}

	/**
	 * 初始化服务
	 */
	async initialize(): Promise<void> {
		// 如果正在初始化，等待初始化完成
		if (this.initializePromise) {
			return this.initializePromise;
		}

		// 如果缓存已有数据，说明已初始化过
		if (this.skillsCache !== null) {
			return;
		}

		// 开始初始化
		this.initializePromise = (async () => {
			try {
				// 尝试加载现有数据
				await this.loadSkills();
				DebugLogger.debug('[SkillDataService] 初始化完成，共', this.skillsCache?.length || 0, '个技能');
			} catch (error) {
				DebugLogger.error('[SkillDataService] 初始化失败', error);
				this.skillsCache = [];
			} finally {
				// 初始化完成，清空 promise
				this.initializePromise = null;
			}
		})();

		return this.initializePromise;
	}

	/**
	 * 获取所有技能
	 */
	async getSkills(): Promise<Skill[]> {
		await this.initialize();
		return this.skillsCache || [];
	}

	/**
	 * 获取技能（按排序）
	 */
	async getSortedSkills(): Promise<Skill[]> {
		const skills = await this.getSkills();
		return [...skills].sort((a, b) => a.order - b.order);
	}

	/**
	 * 根据 ID 获取技能
	 */
	async getSkillById(id: string): Promise<Skill | undefined> {
		const skills = await this.getSkills();
		return skills.find(s => s.id === id);
	}

	/**
	 * 获取指定技能组的直接子技能列表
	 */
	async getSkillChildren(id: string): Promise<Skill[]> {
		const skills = await this.getSkills();
		const group = skills.find(s => s.id === id);
		if (!group || !group.isSkillGroup) {
			return [];
		}

		const childrenIds = group.children ?? [];
		const byId = new Map(skills.map(s => [s.id, s] as const));
		return childrenIds.map(childId => byId.get(childId)).filter(Boolean) as Skill[];
	}

	/**
	 * 递归获取所有后代技能（按展示顺序平铺）
	 */
	async getAllDescendants(id: string): Promise<Skill[]> {
		await this.initialize();
		const skills = this.skillsCache || [];
		const byId = new Map(skills.map(s => [s.id, s] as const));
		const visited = new Set<string>();
		const result: Skill[] = [];

		const walk = (groupId: string): void => {
			const group = byId.get(groupId);
			if (!group || !group.isSkillGroup) {
				return;
			}
			if (visited.has(groupId)) {
				return;
			}
			visited.add(groupId);

			const children = group.children ?? [];
			for (const childId of children) {
				const child = byId.get(childId);
				if (!child) {
					continue;
				}
				result.push(child);
				if (child.isSkillGroup) {
					walk(child.id);
				}
			}
		};

		walk(id);
		return result;
	}

	/**
	 * 将技能移动到指定技能组或主列表
	 * @param targetGroupId 目标技能组 ID；为 null 表示主列表
	 * @param position 插入位置（不传则追加到末尾）
	 */
	async moveSkillToGroup(skillId: string, targetGroupId: string | null, position?: number): Promise<void> {
		await this.initialize();
		const skills = this.skillsCache || [];
		const byId = new Map(skills.map(s => [s.id, s] as const));
		const skill = byId.get(skillId);
		if (!skill) {
			return;
		}

		const subtreeDepth = this.getSubtreeMaxRelativeDepthSync(skillId, skills);

		if (targetGroupId !== null) {
			const targetGroup = byId.get(targetGroupId);
			if (!targetGroup || !targetGroup.isSkillGroup) {
				throw new Error('目标不是有效的技能组');
			}

			// 禁止移动到自身或后代，避免循环引用
			if (targetGroupId === skillId) {
				throw new Error('不能将技能组移动到自身内部');
			}
			const descendants = await this.getAllDescendants(skillId);
			if (descendants.some(d => d.id === targetGroupId)) {
				throw new Error('不能将技能组移动到其后代内部');
			}

			// 限制最多 3 层（顶层=0），并考虑被移动技能的子树深度
			const targetLevel = this.getNestingLevelSync(targetGroupId, skills) + 1;
			if (targetLevel + subtreeDepth > 2) {
				throw new Error('最多支持 3 层嵌套');
			}
		}

		// 从所有技能组中移除，确保技能只属于一个位置
		this.removeFromAllGroupsSync(skillId, skills);

		if (targetGroupId === null) {
			// 移动到主列表：只需确保不再被任何组引用，然后重排主列表 order
			this.removeFromAllGroupsSync(skillId, skills);
			await this.reorderTopLevelSkillsSync(skills, skillId, position);
			this.skillsCache = skills;
			await this.persistSkills();
			return;
		}

		const targetGroup = byId.get(targetGroupId);
		if (!targetGroup || !targetGroup.isSkillGroup) {
			throw new Error('目标不是有效的技能组');
		}

		// 目标组 children 插入
		const children = [...(targetGroup.children ?? [])].filter(id => id !== skillId);
		const insertAt = position === undefined ? children.length : Math.max(0, Math.min(position, children.length));
		children.splice(insertAt, 0, skillId);
		targetGroup.children = children;
		targetGroup.updatedAt = Date.now();

		// 移入组后需要确保主列表不再包含该技能：membership 本就通过 children 引用判断，这里只需重排主列表 order
		await this.reorderTopLevelSkillsSync(skills);

		this.skillsCache = skills;
		await this.persistSkills();
	}

	/**
	 * 更新技能组的子技能列表
	 */
	async updateSkillGroupChildren(groupId: string, childrenIds: string[]): Promise<void> {
		await this.initialize();
		const skills = this.skillsCache || [];
		const group = skills.find(s => s.id === groupId);
		if (!group || !group.isSkillGroup) {
			throw new Error('目标不是有效的技能组');
		}

		// 去重 & 过滤不存在的 id
		const byId = new Map(skills.map(s => [s.id, s] as const));
		const seen = new Set<string>();
		const normalized: string[] = [];
		for (const id of childrenIds) {
			if (!byId.has(id)) {
				continue;
			}
			if (id === groupId) {
				continue;
			}
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			normalized.push(id);
		}

		// 循环引用 & 嵌套层级校验
		const groupLevel = this.getNestingLevelSync(groupId, skills);
		for (const childId of normalized) {
			if (childId === groupId) {
				throw new Error('技能组不能包含自身');
			}

			// 防止把某个祖先塞回子列表，形成环
			const childDescendants = await this.getAllDescendants(childId);
			if (childDescendants.some(s => s.id === groupId)) {
				throw new Error('技能组 children 存在循环引用');
			}

			// 限制最多 3 层（顶层=0）；child 最终层级=groupLevel+1，并考虑 child 的子树深度
			const childSubtreeDepth = this.getSubtreeMaxRelativeDepthSync(childId, skills);
			if (groupLevel + 1 + childSubtreeDepth > 2) {
				throw new Error('最多支持 3 层嵌套');
			}
		}

		group.children = normalized;
		group.updatedAt = Date.now();
		this.skillsCache = skills;
		await this.persistSkills();
	}

	/**
	 * 计算技能嵌套层级（顶层=0）
	 */
	async getNestingLevel(skillId: string): Promise<number> {
		await this.initialize();
		return this.getNestingLevelSync(skillId, this.skillsCache || []);
	}

	private getNestingLevelSync(skillId: string, skills: Skill[]): number {
		let level = 0;
		let currentId: string | null = skillId;
		const seen = new Set<string>();
		while (currentId) {
			if (seen.has(currentId)) {
				break;
			}
			seen.add(currentId);
			const parent = this.findParentGroupSync(currentId, skills);
			if (!parent) {
				break;
			}
			level += 1;
			currentId = parent.id;
		}
		return level;
	}

	private findParentGroupSync(skillId: string, skills: Skill[]): Skill | null {
		for (const s of skills) {
			if (s.isSkillGroup && (s.children ?? []).includes(skillId)) {
				return s;
			}
		}
		return null;
	}

	private removeFromAllGroupsSync(skillId: string, skills: Skill[]): void {
		for (const s of skills) {
			if (!s.isSkillGroup) {
				continue;
			}
			const before = s.children ?? [];
			const after = before.filter(id => id !== skillId);
			if (after.length !== before.length) {
				s.children = after;
				s.updatedAt = Date.now();
			}
		}
	}

	/**
	 * 获取以 skillId 为根的子树最大相对深度（根=0）。用于校验移动后是否会超过最大嵌套层级。
	 */
	private getSubtreeMaxRelativeDepthSync(skillId: string, skills: Skill[]): number {
		const byId = new Map(skills.map(s => [s.id, s] as const));
		const seen = new Set<string>();

		const dfs = (currentId: string): number => {
			if (seen.has(currentId)) {
				return 0;
			}
			seen.add(currentId);
			const current = byId.get(currentId);
			if (!current || !current.isSkillGroup) {
				return 0;
			}
			let maxChild = 0;
			for (const childId of (current.children ?? [])) {
				maxChild = Math.max(maxChild, 1 + dfs(childId));
			}
			return maxChild;
		};

		return dfs(skillId);
	}

	private async reorderTopLevelSkillsSync(skills: Skill[], movingSkillId?: string, position?: number): Promise<void> {
		// 顶层技能定义：未被任何技能组 children 引用的技能
		const referenced = new Set<string>();
		for (const s of skills) {
			if (s.isSkillGroup) {
				for (const id of (s.children ?? [])) {
					referenced.add(id);
				}
			}
		}

		const topLevel = skills
			.filter(s => !referenced.has(s.id))
			.sort((a, b) => a.order - b.order);

		if (movingSkillId) {
			const movingIndex = topLevel.findIndex(s => s.id === movingSkillId);
			if (movingIndex >= 0) {
				const [moving] = topLevel.splice(movingIndex, 1);
				const insertAt = position === undefined ? topLevel.length : Math.max(0, Math.min(position, topLevel.length));
				topLevel.splice(insertAt, 0, moving);
			}
		}

		topLevel.forEach((s, index) => {
			s.order = index;
			s.updatedAt = Date.now();
		});
	}

	/**
	 * 保存技能（新增或更新）
	 */
	async saveSkill(skill: Skill): Promise<void> {
		const skills = await this.getSkills();
		const existingIndex = skills.findIndex(s => s.id === skill.id);

		if (existingIndex >= 0) {
			// 更新现有技能
			skills[existingIndex] = skill;
			DebugLogger.debug('[SkillDataService] 更新技能', skill.name);
		} else {
			// 新增技能
			skills.push(skill);
			DebugLogger.debug('[SkillDataService] 新增技能', skill.name);
		}

		this.skillsCache = skills;
		await this.persistSkills();
	}

	/**
	 * 删除技能
	 */
	async deleteSkill(id: string): Promise<void> {
		const skills = await this.getSkills();
		const index = skills.findIndex(s => s.id === id);

		if (index >= 0) {
			// 清理所有技能组对该技能的引用，避免留下悬空 children
			this.removeFromAllGroupsSync(id, skills);
			const deletedSkill = skills.splice(index, 1)[0];
			DebugLogger.debug('[SkillDataService] 删除技能', deletedSkill.name);
			this.skillsCache = skills;
			await this.persistSkills();
		}
	}

	/**
	 * 更新技能排序
	 */
	async updateSkillsOrder(orderedIds: string[]): Promise<void> {
		const skills = await this.getSkills();
		
		// 根据传入的 ID 顺序更新 order 字段
		orderedIds.forEach((id, index) => {
			const skill = skills.find(s => s.id === id);
			if (skill) {
				skill.order = index;
				skill.updatedAt = Date.now();
			}
		});

		this.skillsCache = skills;
		await this.persistSkills();
		DebugLogger.debug('[SkillDataService] 更新技能排序');
	}

	/**
	 * 批量更新技能显示状态
	 */
	async updateSkillShowInToolbar(id: string, showInToolbar: boolean): Promise<void> {
		const skills = await this.getSkills();
		const skill = skills.find(s => s.id === id);
		
		if (skill) {
			skill.showInToolbar = showInToolbar;
			skill.updatedAt = Date.now();
			this.skillsCache = skills;
			await this.persistSkills();
			DebugLogger.debug('[SkillDataService] 更新技能显示状态', skill.name, showInToolbar);
		}
	}

	/**
	 * 从旧的设置数据迁移技能
	 * 用于将 data.json 中的技能数据迁移到独立文件
	 */
	async migrateFromSettings(legacySkills: Skill[]): Promise<void> {
		DebugLogger.debug('[SkillDataService] 开始检查数据迁移，旧技能数量:', legacySkills?.length || 0);

		if (!legacySkills || legacySkills.length === 0) {
			DebugLogger.debug('[SkillDataService] 没有旧数据需要迁移');
			return;
		}

		const existingSkills = await this.getSkills();
		DebugLogger.debug('[SkillDataService] 当前已加载的技能数量:', existingSkills.length);

		// 如果已有技能数据，跳过迁移
		if (existingSkills.length > 0) {
			DebugLogger.debug('[SkillDataService] 已存在技能数据，跳过迁移');
			return;
		}

		// 迁移旧数据
		// 确保所有技能都有新增的字段
		const migratedSkills = legacySkills.map(skill => ({
			...normalizeSkill(skill),
			promptSource: skill.promptSource || 'custom' as const,
			templateFile: skill.templateFile,
			modelTag: skill.modelTag
		}));

		this.skillsCache = migratedSkills;
		await this.persistSkills();
		DebugLogger.debug('[SkillDataService] 迁移完成，共迁移', migratedSkills.length, '个技能');
	}

	/**
	 * 从文件加载技能数据
	 */
	private async loadSkills(): Promise<void> {
		try {
			// 使用 vault.adapter 检查文件是否存在
			const fileExists = await this.app.vault.adapter.exists(SKILLS_DATA_FILE);

			if (fileExists) {
				const content = await this.app.vault.adapter.read(SKILLS_DATA_FILE);
				const data: SkillsData = JSON.parse(content);
				const rawSkills = data.skills || [];
				this.skillsCache = rawSkills.map(normalizeSkill);
				DebugLogger.debug('[SkillDataService] 加载技能数据成功，共', this.skillsCache.length, '个技能');
			} else {
				// 文件不存在，使用空数组
				this.skillsCache = [];
				DebugLogger.debug('[SkillDataService] 技能数据文件不存在，初始化空列表');
			}
		} catch (error) {
			DebugLogger.error('[SkillDataService] 加载技能数据失败', error);
			this.skillsCache = [];
		}
	}

	/**
	 * 将技能数据持久化到文件
	 */
	private async persistSkills(): Promise<void> {
		try {
			const data: SkillsData = {
				version: SKILLS_DATA_VERSION,
				skills: this.skillsCache || [],
				lastModified: Date.now()
			};

			const content = JSON.stringify(data, null, 2);

			// 使用 vault.adapter 检查文件是否存在（更可靠）
			const fileExists = await this.app.vault.adapter.exists(SKILLS_DATA_FILE);

			if (fileExists) {
				// 文件已存在，修改内容
				await this.app.vault.adapter.write(SKILLS_DATA_FILE, content);
				DebugLogger.debug('[SkillDataService] 更新技能数据文件成功');
			} else {
				// 文件不存在，创建新文件
				// 确保目录存在
				await this.ensureDirectoryExists();

				// 再次检查文件是否已被创建
				const fileExistsNow = await this.app.vault.adapter.exists(SKILLS_DATA_FILE);
				if (fileExistsNow) {
					await this.app.vault.adapter.write(SKILLS_DATA_FILE, content);
				} else {
					await this.app.vault.adapter.write(SKILLS_DATA_FILE, content);
				}
				DebugLogger.debug('[SkillDataService] 创建技能数据文件成功');
			}

			DebugLogger.debug('[SkillDataService] 保存技能数据成功');
		} catch (error) {
			DebugLogger.error('[SkillDataService] 保存技能数据失败', error);
			throw error;
		}
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDirectoryExists(): Promise<void> {
		const dir = '.obsidian/plugins/formify';

		// 使用 vault.adapter 检查目录是否存在
		const dirExists = await this.app.vault.adapter.exists(dir);

		if (!dirExists) {
			// 递归创建目录
			try {
				await this.app.vault.adapter.mkdir(dir);
				DebugLogger.debug('[SkillDataService] 创建目录', dir);
			} catch (error) {
				// 目录可能已被创建，忽略错误
				DebugLogger.debug('[SkillDataService] 创建目录失败或已存在', error);
			}
		}
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.skillsCache = null;
		this.initializePromise = null;
		SkillDataService.instance = null;
	}
}
