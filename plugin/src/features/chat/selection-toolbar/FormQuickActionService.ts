import { App, TFile, TFolder, Notice } from 'obsidian';
import { FormConfig } from 'src/model/FormConfig';
import { FormService } from 'src/service/FormService';
import FormViewModal2 from 'src/component/modal/FormViewModal2';
import { FormDisplayRules } from 'src/utils/FormDisplayRules';
import { localInstance } from 'src/i18n/locals';
import type { QuickAction } from '../types/chat';

/**
 * 表单信息接口
 */
export interface FormInfo {
	commandId: string;
	filePath: string;
	fileName: string;
}

/**
 * 表单操作执行结果接口
 */
export interface FormQuickActionExecutionResult {
	success: boolean;
	executedForms: string[];
	skippedForms: string[];
	errors: string[];
}

/**
 * 表单操作服务
 * 负责管理表单操作的扫描、执行等逻辑
 */
export class FormQuickActionService {
	private formInfoCache: FormInfo[] | null = null;

	constructor(private readonly app: App) {}

	/**
	 * 扫描 vault 中的所有 .cform 表单文件
	 * @returns 表单信息数组
	 */
	async scanForms(): Promise<FormInfo[]> {
		const formFiles: TFile[] = [];

		// 递归扫描所有文件夹
		const scanFolder = async (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'cform') {
					formFiles.push(child);
				} else if (child instanceof TFolder) {
					await scanFolder(child);
				}
			}
		};

		// 从根目录开始扫描
		await scanFolder(this.app.vault.getRoot());

		const formInfos: FormInfo[] = [];

		for (const file of formFiles) {
			try {
				const content = await this.app.vault.read(file);
				const config = JSON.parse(content) as FormConfig;

				if (this.isValidFormConfig(config) && config.commandId) {
					formInfos.push({
						commandId: config.commandId,
						filePath: file.path,
						fileName: file.basename
					});
				}
			} catch (error) {
				console.warn(`[FormQuickActionService] 无法解析表单文件 ${file.path}:`, error);
			}
		}

		// 缓存结果
		this.formInfoCache = formInfos;

		return formInfos;
	}

	/**
	 * 获取缓存的表单信息，如果没有缓存则扫描
	 */
	async getFormInfos(): Promise<FormInfo[]> {
		if (this.formInfoCache === null) {
			return await this.scanForms();
		}
		return this.formInfoCache;
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.formInfoCache = null;
	}

	/**
	 * 通过 commandId 查找表单
	 */
	async findFormByCommandId(commandId: string): Promise<FormInfo | null> {
		const formInfos = await this.getFormInfos();
		return formInfos.find(f => f.commandId === commandId) || null;
	}

	/**
	 * 通过 commandId 获取表单配置
	 */
	async getFormConfigByCommandId(commandId: string): Promise<FormConfig | null> {
		const formInfo = await this.findFormByCommandId(commandId);
		if (!formInfo) {
			return null;
		}

		try {
			const file = this.app.vault.getAbstractFileByPath(formInfo.filePath);
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
				return FormConfig.fromJSON(JSON.parse(content));
			}
		} catch (error) {
			console.error(`[FormQuickActionService] 读取表单配置失败: ${formInfo.filePath}`, error);
		}

		return null;
	}

	/**
	 * 执行表单操作
	 * @param quickAction 表单操作
	 * @returns 执行结果
	 */
	async executeFormQuickAction(quickAction: QuickAction): Promise<FormQuickActionExecutionResult> {
		const result: FormQuickActionExecutionResult = {
			success: true,
			executedForms: [],
			skippedForms: [],
			errors: []
		};

		const formCommandIds = quickAction.formCommandIds || [];

		if (formCommandIds.length === 0) {
			const errorMsg = localInstance.quick_action_form_no_forms_configured || '未配置可执行的表单操作';
			new Notice(errorMsg);
			result.errors.push(errorMsg);
			result.success = false;
			return result;
		}

		if (formCommandIds.length > 1) {
			new Notice('表单操作仅支持配置一个表单，将只执行第一个表单')
		}

		const formService = new FormService();

		const runOneForm = async (commandId: string): Promise<void> => {
			const formConfig = await this.getFormConfigByCommandId(commandId);
			if (!formConfig) {
				const errorMsg = localInstance.quick_action_form_not_found.replace('{0}', commandId);
				new Notice(errorMsg);
				result.skippedForms.push(commandId);
				result.errors.push(errorMsg);
				return;
			}

			const shouldShowForm = FormDisplayRules.shouldShowForm(formConfig);
			if (!shouldShowForm) {
				// 不需要用户输入：直接执行
				await formService.submitDirectly(formConfig, this.app);
				result.executedForms.push(commandId);
				return;
			}

			// 需要用户输入：打开表单 UI，并等待关闭/提交后返回
			await new Promise<void>((resolve) => {
				const modal = new FormViewModal2(this.app, {
					formConfig,
					options: { showOnlyFieldsNeedingInput: true }
				});
				const originalClose = modal.close.bind(modal);
				modal.close = () => {
					try {
						originalClose();
					} finally {
						resolve();
					}
				};
				void modal.open();
			});
			result.executedForms.push(commandId);
		}

		const commandId = formCommandIds[0];
		try {
			await runOneForm(commandId);
		} catch (error) {
			const errorMsg = `执行表单 ${commandId} 失败: ${error instanceof Error ? error.message : String(error)}`;
			console.error(`[FormQuickActionService] ${errorMsg}`);
			result.errors.push(errorMsg);
			result.skippedForms.push(commandId);
		}

		result.success = result.errors.length === 0;
		return result;
	}

	// 注意：表单操作目前只允许配置 1 个表单。

	/**
	 * 验证表单配置是否有效
	 */
	private isValidFormConfig(config: any): config is FormConfig {
		return config &&
			typeof config === 'object' &&
			typeof config.id === 'string' &&
			Array.isArray(config.fields) &&
			Array.isArray(config.actions);
	}
}

/**
 * 获取表单操作服务单例
 */
let formQuickActionServiceInstance: FormQuickActionService | null = null;

export function getFormQuickActionService(app: App): FormQuickActionService {
	if (!formQuickActionServiceInstance) {
		formQuickActionServiceInstance = new FormQuickActionService(app);
	}
	return formQuickActionServiceInstance;
}
