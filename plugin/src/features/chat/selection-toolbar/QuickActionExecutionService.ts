import { App, TFile, Notice } from 'obsidian';
import type { QuickAction } from '../types/chat';
import type { TarsSettings } from '../../tars/settings';
import { availableVendors } from '../../tars/settings';
import type { ProviderSettings, Message, Vendor } from '../../tars/providers';
import { getFormQuickActionService } from './FormQuickActionService';
import { localInstance } from 'src/i18n/locals';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptAssembler } from 'src/service/SystemPromptAssembler';
import { buildProviderOptionsWithReasoningDisabled } from '../../tars/providers/utils';

/**
 * 快捷操作执行结果接口
 */
export interface QuickActionExecutionResult {
	success: boolean;
	content: string;
	error?: string;
}

/**
 * 判断快捷操作的实际类型
 * 用于兼容旧数据结构
 */
function getQuickActionType(quickAction: QuickAction): 'normal' | 'group' | 'form' {
	// 优先使用 actionType 字段
	if (quickAction.actionType) {
		return quickAction.actionType;
	}
	// 兼容未设置 actionType 的数据：根据分组标记判断
	if (quickAction.isActionGroup) {
		return 'group';
	}
	// 兼容旧数据：检查 formCommandIds 字段
	if (quickAction.formCommandIds && quickAction.formCommandIds.length > 0) {
		return 'form';
	}
	// 默认为普通操作
	return 'normal';
}

/**
 * 快捷操作执行服务
 * 负责处理快捷操作的执行逻辑，包括提示词解析、模板引用和 AI 调用
 */
export class QuickActionExecutionService {
	// 用于管理当前执行的 AbortController
	private currentAbortController: AbortController | null = null;

	constructor(
		private readonly app: App,
		private readonly getTarsSettings: () => TarsSettings,
		private readonly getPromptTemplateFolder: () => string
	) {}

	/**
	 * 取消当前正在执行的快捷操作
	 */
	cancelCurrentExecution(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
	}

	/**
	 * 执行快捷操作
	 * @param quickAction 要执行的快捷操作
	 * @param selection 选中的文本
	 * @param modelTag 可选的模型标签，不提供则使用快捷操作配置的模型或默认模型
	 * @returns 执行结果
	 */
	async executeQuickAction(
		quickAction: QuickAction,
		selection: string,
		modelTag?: string
	): Promise<QuickActionExecutionResult> {
		try {
			// 判断操作类型
			const actionType = getQuickActionType(quickAction);

			// 表单操作：执行表单，忽略 selection 参数
			if (actionType === 'form') {
				return await this.executeFormQuickAction(quickAction);
			}

			// 操作组不应该直接执行
			if (actionType === 'group') {
				return {
					success: false,
					content: '',
					error: '操作组不能直接执行'
				};
			}

			// 普通操作：执行 AI 调用
			return await this.executeNormalQuickAction(quickAction, selection, modelTag);
		} catch (error) {
			console.error('[QuickActionExecutionService] 执行操作失败:', error);
			return {
				success: false,
				content: '',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * 执行表单操作
	 */
	private async executeFormQuickAction(quickAction: QuickAction): Promise<QuickActionExecutionResult> {
		const formQuickActionService = getFormQuickActionService(this.app);
		const result = await formQuickActionService.executeFormQuickAction(quickAction);

		if (result.success) {
			return {
				success: true,
				content: ''  // 表单操作不返回文本内容
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
	 * 执行普通操作（AI 调用）
	 */
	private async executeNormalQuickAction(
		quickAction: QuickAction,
		selection: string,
		modelTag?: string
	): Promise<QuickActionExecutionResult> {
		try {
			// 1. 获取提示词内容（保持原逻辑）
			let promptContent = '';
			if (quickAction.promptSource === 'template' && quickAction.templateFile) {
				promptContent = await this.loadTemplateFile(quickAction.templateFile);
			} else {
				promptContent = quickAction.prompt;
			}

			// 2. 获取AI模型配置
			const tarsSettings = this.getTarsSettings();
			const effectiveModelTag = modelTag || quickAction.modelTag;
			const providerSettings = this.getProviderSettings(tarsSettings, effectiveModelTag);

			if (!providerSettings) {
				return {
					success: false,
					content: '',
					error: '未找到可用的AI模型配置'
				};
			}

			// 3. 构建消息（使用新的统一方法）
			const useDefaultSystemPrompt = quickAction.useDefaultSystemPrompt ?? true;
			const messages = await this.buildMessages(
				useDefaultSystemPrompt,
				promptContent,
				selection,
				quickAction.customPromptRole
			);

			// 4. 调用AI模型
			const result = await this.callAIWithMessages(providerSettings, messages);

			return {
				success: true,
				content: result
			};
		} catch (error) {
			console.error('[QuickActionExecutionService] 执行操作失败:', error);
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
				console.warn(`[QuickActionExecutionService] 读取模板文件失败: ${filePath}`, e);
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
	 * 仅解析模板引用，不处理占位符替换
	 * 用于当自定义提示词作为系统消息时，只处理 {{template:xxx}} 模板引用
	 */
	async resolvePromptTemplateOnly(prompt: string): Promise<string> {
		let resolvedPrompt = prompt;

		// 处理模板引用 {{template:文件名}}
		const templatePattern = /\{\{template:([^}]+)\}\}/g;
		let match;

		while ((match = templatePattern.exec(prompt)) !== null) {
			const templateName = match[1].trim();
			const templateContent = await this.loadTemplate(templateName);
			resolvedPrompt = resolvedPrompt.replace(match[0], templateContent);
		}

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
					console.warn(`[QuickActionExecutionService] 读取模板文件失败: ${path}`, e);
				}
			}
		}

		console.warn(`[QuickActionExecutionService] 未找到模板文件: ${templateName}`);
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
	 * 构建 AI 调用的消息结构
	 * @param useDefaultSystemPrompt 是否使用默认系统提示词
	 * @param promptContent 提示词内容（已加载但未解析）
	 * @param selection 选中的文本
	 * @param customPromptRole 自定义提示词的角色（仅当 useDefaultSystemPrompt 为 false 时生效）
	 * @returns 消息数组
	 */
	private async buildMessages(
		useDefaultSystemPrompt: boolean,
		promptContent: string,
		selection: string,
		customPromptRole?: 'system' | 'user'
	): Promise<Message[]> {
		const messages: Message[] = [];

		if (useDefaultSystemPrompt) {
			// 原有逻辑：使用系统提示词 + 解析后的提示词
			const assembler = new SystemPromptAssembler(this.app);
			const globalSystemPrompt = (await assembler.buildGlobalSystemPrompt('selection_toolbar')).trim();

			if (globalSystemPrompt.length > 0) {
				messages.push({ role: 'system', content: globalSystemPrompt });
			}

			// 解析提示词（处理占位符和模板引用）
			const resolvedPrompt = await this.resolvePrompt(promptContent, selection);
			messages.push({ role: 'user', content: resolvedPrompt });
		} else {
			// 扩展逻辑：根据配置决定消息结构
			const promptRole = customPromptRole ?? 'system';

			if (promptRole === 'system') {
				// 提示词作为系统消息，占位符替换为指示文本
				// 处理模板引用
				let processedPrompt = await this.resolvePromptTemplateOnly(promptContent);

				// 将占位符替换为指示文本
				processedPrompt = processedPrompt.replace(/\{\{\}\}/g, '<用户消息内容>');
				processedPrompt = processedPrompt.replace(/\{\{@[^}]*\}\}/g, '<用户消息内容>');

				messages.push({ role: 'system', content: processedPrompt });
				// 选中文本作为用户消息
				messages.push({ role: 'user', content: selection });
			} else {
				// 提示词作为用户消息，需要处理占位符替换
				const resolvedPrompt = await this.resolvePrompt(promptContent, selection);
				messages.push({ role: 'user', content: resolvedPrompt });
			}
		}

		return messages;
	}

	/**
	 * 调用AI模型（使用预构建的消息）
	 */
	private async callAIWithMessages(
		providerSettings: ProviderSettings,
		messages: Message[]
	): Promise<string> {
		const vendor = this.getVendor(providerSettings.vendor);

		if (!vendor) {
			throw new Error(`未找到AI提供商: ${providerSettings.vendor}`);
		}

		// 创建新的 AbortController 并保存到实例变量
		this.currentAbortController = new AbortController();
		const controller = this.currentAbortController;
		// 禁用推理功能
		const providerOptions = buildProviderOptionsWithReasoningDisabled(
			providerSettings.options,
			providerSettings.vendor
		);
		const sendRequest = vendor.sendRequestFunc(providerOptions);
		DebugLogger.logLlmMessages('QuickActionExecutionService.callAIWithMessages', messages, { level: 'debug' });

		const resolveEmbed = async () => new ArrayBuffer(0);

		try {
			let result = '';
			for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
				// 检查是否已取消
				if (controller.signal.aborted) {
					break;
				}
				result += chunk;
			}
			DebugLogger.logLlmResponsePreview('QuickActionExecutionService.callAIWithMessages', result, { level: 'debug', previewChars: 100 });
			return result;
		} finally {
			// 执行完成后清理 AbortController
			this.currentAbortController = null;
		}
	}

	/**
	 * 流式执行快捷操作（用于显示实时进度）
	 */
	async *executeQuickActionStream(
		quickAction: QuickAction,
		selection: string,
		modelTag?: string
	): AsyncGenerator<string, void, unknown> {
		// 判断操作类型
		const actionType = getQuickActionType(quickAction);

		// 表单操作不支持流式执行，直接执行并返回空
		if (actionType === 'form') {
			const formQuickActionService = getFormQuickActionService(this.app);
			await formQuickActionService.executeFormQuickAction(quickAction);
			return;
		}

		// 操作组不应该直接执行
		if (actionType === 'group') {
			throw new Error('操作组不能直接执行');
		}

		// 普通操作：流式执行 AI 调用
		try {
			// 1. 获取提示词内容
			let promptContent = '';
			if (quickAction.promptSource === 'template' && quickAction.templateFile) {
				promptContent = await this.loadTemplateFile(quickAction.templateFile);
			} else {
				promptContent = quickAction.prompt;
			}

			// 2. 获取AI模型配置
			const tarsSettings = this.getTarsSettings();
			const effectiveModelTag = modelTag || quickAction.modelTag;
			const providerSettings = this.getProviderSettings(tarsSettings, effectiveModelTag);

			if (!providerSettings) {
				throw new Error('未找到可用的AI模型配置');
			}

			// 3. 构建消息（复用 buildMessages 方法）
			const useDefaultSystemPrompt = quickAction.useDefaultSystemPrompt ?? true;
			const messages = await this.buildMessages(
				useDefaultSystemPrompt,
				promptContent,
				selection,
				quickAction.customPromptRole
			);

			// 4. 流式调用AI
			const vendor = this.getVendor(providerSettings.vendor);
			if (!vendor) {
				throw new Error(`未找到AI提供商: ${providerSettings.vendor}`);
			}

			// 创建新的 AbortController 并保存到实例变量
			this.currentAbortController = new AbortController();
			const controller = this.currentAbortController;
			// 禁用推理功能
			const providerOptions = buildProviderOptionsWithReasoningDisabled(
				providerSettings.options,
				providerSettings.vendor
			);
			const sendRequest = vendor.sendRequestFunc(providerOptions);
			DebugLogger.logLlmMessages('QuickActionExecutionService.executeQuickActionStream', messages, { level: 'debug' });

			const resolveEmbed = async () => new ArrayBuffer(0);

			let preview = '';
			try {
				// 流式输出循环，添加取消检查
				for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
					// 检查是否已取消
					if (controller.signal.aborted) {
						DebugLogger.debug('[QuickActionExecutionService] 操作执行已被取消');
						break;
					}

					if (preview.length < 100) {
						preview += chunk;
						if (preview.length > 100) {
							preview = preview.slice(0, 100);
						}
					}
					yield chunk;
				}
				DebugLogger.logLlmResponsePreview('QuickActionExecutionService.executeQuickActionStream', preview, { level: 'debug', previewChars: 100 });
			} finally {
				// 执行完成后清理 AbortController
				this.currentAbortController = null;
			}
		} catch (error) {
			// 如果是取消错误，不记录为错误
			if (error instanceof Error && error.name === 'AbortError') {
				DebugLogger.debug('[QuickActionExecutionService] 操作执行已取消');
				return;
			}
			console.error('[QuickActionExecutionService] 流式执行操作失败:', error);
			throw error;
		}
	}

}
