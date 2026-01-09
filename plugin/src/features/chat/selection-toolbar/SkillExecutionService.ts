import { App, TFile, Notice } from 'obsidian';
import type { Skill } from '../types/chat';
import type { TarsSettings } from '../../tars/settings';
import { availableVendors } from '../../tars/settings';
import type { ProviderSettings, Message, Vendor } from '../../tars/providers';
import { getFormSkillService } from './FormSkillService';
import { localInstance } from 'src/i18n/locals';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 技能执行结果接口
 */
export interface SkillExecutionResult {
	success: boolean;
	content: string;
	error?: string;
}

/**
 * 判断技能的实际类型
 * 用于兼容旧数据结构
 */
function getSkillType(skill: Skill): 'normal' | 'group' | 'form' {
	// 优先使用 skillType 字段
	if (skill.skillType) {
		return skill.skillType;
	}
	// 兼容旧数据：检查 isSkillGroup 字段
	if (skill.isSkillGroup) {
		return 'group';
	}
	// 兼容旧数据：检查 formCommandIds 字段
	if (skill.formCommandIds && skill.formCommandIds.length > 0) {
		return 'form';
	}
	// 默认为普通技能
	return 'normal';
}

/**
 * 技能执行服务
 * 负责处理技能的执行逻辑，包括提示词解析、模板引用和AI调用
 */
export class SkillExecutionService {
	constructor(
		private readonly app: App,
		private readonly getTarsSettings: () => TarsSettings,
		private readonly getPromptTemplateFolder: () => string
	) {}

	/**
	 * 执行技能
	 * @param skill 要执行的技能
	 * @param selection 选中的文本
	 * @param modelTag 可选的模型标签，不提供则使用技能配置的模型或默认模型
	 * @returns 执行结果
	 */
	async executeSkill(
		skill: Skill,
		selection: string,
		modelTag?: string
	): Promise<SkillExecutionResult> {
		try {
			// 判断技能类型
			const skillType = getSkillType(skill);

			// 表单技能：执行表单，忽略 selection 参数
			if (skillType === 'form') {
				return await this.executeFormSkill(skill);
			}

			// 技能组不应该直接执行
			if (skillType === 'group') {
				return {
					success: false,
					content: '',
					error: '技能组不能直接执行'
				};
			}

			// 普通技能：执行 AI 调用
			return await this.executeNormalSkill(skill, selection, modelTag);
		} catch (error) {
			console.error('[SkillExecutionService] 执行技能失败:', error);
			return {
				success: false,
				content: '',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * 执行表单技能
	 */
	private async executeFormSkill(skill: Skill): Promise<SkillExecutionResult> {
		const formSkillService = getFormSkillService(this.app);
		const result = await formSkillService.executeFormSkill(skill);

		if (result.success) {
			return {
				success: true,
				content: ''  // 表单技能不返回文本内容
			};
		} else {
			return {
				success: false,
				content: '',
				error: result.errors.join('; ')
			};
		}
	}

	/**
	 * 执行普通技能（AI 调用）
	 */
	private async executeNormalSkill(
		skill: Skill,
		selection: string,
		modelTag?: string
	): Promise<SkillExecutionResult> {
		try {
			// 1. 获取提示词内容
			let promptContent = '';
			if (skill.promptSource === 'template' && skill.templateFile) {
				// 从模板文件加载提示词
				promptContent = await this.loadTemplateFile(skill.templateFile);
			} else {
				// 使用自定义提示词
				promptContent = skill.prompt;
			}

			// 2. 解析提示词（处理模板引用和占位符）
			const resolvedPrompt = await this.resolvePrompt(promptContent, selection);

			// 3. 获取AI模型配置（优先使用传入的 modelTag，其次使用技能配置的 modelTag）
			const tarsSettings = this.getTarsSettings();
			const effectiveModelTag = modelTag || skill.modelTag;
			const providerSettings = this.getProviderSettings(tarsSettings, effectiveModelTag);

			if (!providerSettings) {
				return {
					success: false,
					content: '',
					error: '未找到可用的AI模型配置'
				};
			}

			// 4. 调用AI模型
			const result = await this.callAI(providerSettings, resolvedPrompt);

			return {
				success: true,
				content: result
			};
		} catch (error) {
			console.error('[SkillExecutionService] 执行技能失败:', error);
			return {
				success: false,
				content: '',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * 加载模板文件内容
	 */
	private async loadTemplateFile(filePath: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			try {
				return await this.app.vault.read(file);
			} catch (e) {
				console.warn(`[SkillExecutionService] 读取模板文件失败: ${filePath}`, e);
				throw new Error(`无法读取模板文件: ${filePath}`);
			}
		}
		throw new Error(`模板文件不存在: ${filePath}`);
	}

	/**
	 * 解析提示词
	 * 处理模板引用 {{template:文件名}} 和占位符
	 * 
	 * 占位符规则：
	 * - {{}} - 空的双大括号，会被替换为选中的文本
	 * - {{@xxx}} - @ 符号在第一个字符位置时，整个占位符会被替换为选中的文本
	 * - 例如：{{@用户输入}}、{{@选中内容}}、{{@}} 都会被替换
	 * - {{xxx}} - 如果 {{ 后面不是 @ 符号且不为空，则不会被替换
	 */
	async resolvePrompt(prompt: string, selection: string): Promise<string> {
		let resolvedPrompt = prompt;

		// 1. 处理模板引用 {{template:文件名}}
		const templatePattern = /\{\{template:([^}]+)\}\}/g;
		let match;
		
		while ((match = templatePattern.exec(prompt)) !== null) {
			const templateName = match[1].trim();
			const templateContent = await this.loadTemplate(templateName);
			resolvedPrompt = resolvedPrompt.replace(match[0], templateContent);
		}

		// 2. 替换占位符
		// 空的双大括号 {{}} - 会被替换
		resolvedPrompt = resolvedPrompt.replace(/\{\{\}\}/g, selection);
		// {{@xxx}} 格式 - @ 符号在 {{ 之后的第一个位置，会被替换
		resolvedPrompt = resolvedPrompt.replace(/\{\{@[^}]*\}\}/g, selection);

		return resolvedPrompt;
	}

	/**
	 * 加载模板文件内容
	 */
	private async loadTemplate(templateName: string): Promise<string> {
		const templateFolder = this.getPromptTemplateFolder();
		
		// 尝试多种路径格式
		const possiblePaths = [
			`${templateFolder}/${templateName}`,
			`${templateFolder}/${templateName}.md`,
			templateName,
			`${templateName}.md`
		];

		for (const path of possiblePaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				try {
					return await this.app.vault.read(file);
				} catch (e) {
					console.warn(`[SkillExecutionService] 读取模板文件失败: ${path}`, e);
				}
			}
		}

		console.warn(`[SkillExecutionService] 未找到模板文件: ${templateName}`);
		return `[模板未找到: ${templateName}]`;
	}

	/**
	 * 获取AI提供商设置
	 */
	private getProviderSettings(
		tarsSettings: TarsSettings,
		modelTag?: string
	): ProviderSettings | null {
		const providers = tarsSettings.providers;
		
		if (providers.length === 0) {
			return null;
		}

		// 如果指定了模型标签，查找对应的提供商
		if (modelTag) {
			const provider = providers.find(p => p.tag === modelTag);
			if (provider) {
				return provider;
			}
		}

		// 返回第一个可用的提供商
		return providers[0];
	}

	/**
	 * 获取 Vendor 实例
	 */
	private getVendor(vendorName: string): Vendor | undefined {
		return availableVendors.find(v => v.name === vendorName);
	}

	/**
	 * 调用AI模型
	 */
	private async callAI(
		providerSettings: ProviderSettings,
		prompt: string
	): Promise<string> {
		const vendor = this.getVendor(providerSettings.vendor);
		
		if (!vendor) {
			throw new Error(`未找到AI提供商: ${providerSettings.vendor}`);
		}

		// 构建消息
		const messages: Message[] = [
			{
				role: 'user',
				content: prompt
			}
		];

		// 创建 AbortController
		const controller = new AbortController();

		// 获取发送函数
		const sendRequest = vendor.sendRequestFunc(providerSettings.options);
		DebugLogger.logLlmMessages('SkillExecutionService.callAI', messages, { level: 'debug' });

		// 创建空的 resolveEmbed 函数
		const resolveEmbed = async () => new ArrayBuffer(0);

		// 收集响应
		let result = '';
		for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
			result += chunk;
		}
		DebugLogger.logLlmResponsePreview('SkillExecutionService.callAI', result, { level: 'debug', previewChars: 100 });

		return result;
	}

	/**
	 * 流式执行技能（用于显示实时进度）
	 */
	async *executeSkillStream(
		skill: Skill,
		selection: string,
		modelTag?: string
	): AsyncGenerator<string, void, unknown> {
		// 判断技能类型
		const skillType = getSkillType(skill);

		// 表单技能不支持流式执行，直接执行并返回空
		if (skillType === 'form') {
			const formSkillService = getFormSkillService(this.app);
			await formSkillService.executeFormSkill(skill);
			return;
		}

		// 技能组不应该直接执行
		if (skillType === 'group') {
			throw new Error('技能组不能直接执行');
		}

		// 普通技能：流式执行 AI 调用
		try {
			// 1. 获取提示词内容
			let promptContent = '';
			if (skill.promptSource === 'template' && skill.templateFile) {
				// 从模板文件加载提示词
				promptContent = await this.loadTemplateFile(skill.templateFile);
			} else {
				// 使用自定义提示词
				promptContent = skill.prompt;
			}

			// 2. 解析提示词
			const resolvedPrompt = await this.resolvePrompt(promptContent, selection);

			// 3. 获取AI模型配置（优先使用传入的 modelTag，其次使用技能配置的 modelTag）
			const tarsSettings = this.getTarsSettings();
			const effectiveModelTag = modelTag || skill.modelTag;
			const providerSettings = this.getProviderSettings(tarsSettings, effectiveModelTag);

			if (!providerSettings) {
				throw new Error('未找到可用的AI模型配置');
			}

			// 4. 流式调用AI
			const vendor = this.getVendor(providerSettings.vendor);
			
			if (!vendor) {
				throw new Error(`未找到AI提供商: ${providerSettings.vendor}`);
			}

			const messages: Message[] = [
				{
					role: 'user',
					content: resolvedPrompt
				}
			];

			// 创建 AbortController
			const controller = new AbortController();

			// 获取发送函数
			const sendRequest = vendor.sendRequestFunc(providerSettings.options);
			DebugLogger.logLlmMessages('SkillExecutionService.executeSkillStream', messages, { level: 'debug' });

			// 创建空的 resolveEmbed 函数
			const resolveEmbed = async () => new ArrayBuffer(0);

			// 流式返回结果
			let preview = '';
			for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
				if (preview.length < 100) {
					preview += chunk;
					if (preview.length > 100) {
						preview = preview.slice(0, 100);
					}
				}
				yield chunk;
			}
			DebugLogger.logLlmResponsePreview('SkillExecutionService.executeSkillStream', preview, { level: 'debug', previewChars: 100 });
		} catch (error) {
			console.error('[SkillExecutionService] 流式执行技能失败:', error);
			throw error;
		}
	}
}
