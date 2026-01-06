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
	version: 1,
	skills: [],
	lastModified: Date.now()
};

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
			...skill,
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
				this.skillsCache = data.skills || [];
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
				version: 1,
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
