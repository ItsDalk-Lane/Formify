import { App, TFile, TFolder } from 'obsidian';
import type { Skill } from '../types/chat';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 技能数据文件名
 */
const SKILLS_DATA_FILE = '.obsidian/plugins/form-flow/skills.json';

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
	private isInitialized = false;

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
		if (this.isInitialized) {
			return;
		}

		try {
			// 尝试加载现有数据
			await this.loadSkills();
			this.isInitialized = true;
			DebugLogger.debug('[SkillDataService] 初始化完成');
		} catch (error) {
			DebugLogger.error('[SkillDataService] 初始化失败', error);
			this.skillsCache = [];
			this.isInitialized = true;
		}
	}

	/**
	 * 获取所有技能
	 */
	async getSkills(): Promise<Skill[]> {
		if (!this.isInitialized) {
			await this.initialize();
		}
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
		if (!legacySkills || legacySkills.length === 0) {
			return;
		}

		const existingSkills = await this.getSkills();
		
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
			const file = this.app.vault.getAbstractFileByPath(SKILLS_DATA_FILE);
			
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
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
			const file = this.app.vault.getAbstractFileByPath(SKILLS_DATA_FILE);

			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			} else {
				// 确保目录存在
				await this.ensureDirectoryExists();
				await this.app.vault.create(SKILLS_DATA_FILE, content);
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
		const dir = '.obsidian/plugins/form-flow';
		const folder = this.app.vault.getAbstractFileByPath(dir);
		
		if (!folder) {
			// 递归创建目录
			const parts = dir.split('/');
			let currentPath = '';
			
			for (const part of parts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const existing = this.app.vault.getAbstractFileByPath(currentPath);
				
				if (!existing) {
					try {
						await this.app.vault.createFolder(currentPath);
					} catch (e) {
						// 文件夹可能已存在，忽略错误
					}
				}
			}
		}
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		this.skillsCache = null;
		this.isInitialized = false;
		SkillDataService.instance = null;
	}
}
