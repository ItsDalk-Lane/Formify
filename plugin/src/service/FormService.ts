import { App, TFile } from "obsidian";
import FormViewModal2, { FormModalResult } from "src/component/modal/FormViewModal2";
import { localInstance } from "src/i18n/locals";
import { showPromiseToast } from "../component/toast/PromiseToast";
import { ToastManager } from "../component/toast/ToastManager";
import { getStartupConditionService, ConditionEvaluationResult } from "../service/startup-condition/StartupConditionService";
import { FormConfig } from "../model/FormConfig";
import { getActionsCompatible } from "../utils/getActionsCompatible";
import { resolveDefaultFormIdValues } from "../utils/resolveDefaultFormIdValues";
import { ActionChain, ActionContext } from "./action/IActionService";
import { FormVisibilies } from "./condition/FormVisibilies";
import { FormIdValues } from "./FormValues";
import { FormValidator } from "./validator/FormValidator";
import { extractContentFromEncodedValue } from "src/view/shared/control/FileListControl";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFileListField } from "src/model/field/IFileListField";
import { FormFieldValueProcessor } from "./engine/FormFieldValueProcessor";
import { FormExecutionManager } from "./FormExecutionManager";
import { FormDisplayRules } from "../utils/FormDisplayRules";

export interface FormSubmitOptions {
    app: App;
    abortSignal?: AbortSignal;  // 用于中断表单执行的信号
    /**
     * 当表单启用执行超时控制且包含 AI 动作时：
     * 允许从首个 AI 动作开始将后续动作链放到后台执行，并让 submit 提前返回。
     * 仅用于“表单界面提交”场景，避免影响 submitDirectly 等无界面执行路径。
     */
    enableBackgroundExecutionOnAI?: boolean;

    /** 当动作链切到后台执行时触发（用于让表单视图避免提前 finishExecution） */
    onBackgroundExecutionStart?: () => void;
    /** 当后台动作链真正结束时触发（用于 finishExecution / 收尾） */
    onBackgroundExecutionFinish?: () => void;
}

export class FormService {

    async submit(idValues: FormIdValues, config: FormConfig, options: FormSubmitOptions) {
        const actions = getActionsCompatible(config);
        
        FormValidator.validate(config, idValues);
        
        // 先处理文件列表字段的编码值，提取内容（根据元数据设置）
        const decodedIdValues = { ...idValues };
        config.fields.forEach(field => {
            if (field.type === FormFieldType.FILE_LIST) {
                const fileListField = field as IFileListField;
                if (fileListField.extractContent && decodedIdValues[field.id] !== undefined) {
                    const extractedContent = extractContentFromEncodedValue(
                        decodedIdValues[field.id],
                        fileListField.includeMetadata
                    );
                    decodedIdValues[field.id] = extractedContent;
                }
            }
        });
        
        // 然后处理字段值中的内置变量（{{date}}、{{clipboard}}、{{selection}} 等）
        const fieldValueProcessor = new FormFieldValueProcessor();
        const processedIdValues = await fieldValueProcessor.processValues(decodedIdValues, options.app);
        
        const chain = new ActionChain(actions);
        const visibleIdValues = FormVisibilies.getVisibleIdValues(config.fields, processedIdValues, options.app);
        const formLabelValues = FormVisibilies.toFormLabelValues(config.fields, processedIdValues, options.app);
        const shouldBackgroundOnAI =
            options.enableBackgroundExecutionOnAI === true &&
            (config.enableExecutionTimeout ?? false) &&
            actions.some((a) => a.type === "ai");

        const actionContext: ActionContext = {
            app: options.app,
            config: config,
            state: {
                idValues: visibleIdValues,
                values: formLabelValues,
            },
            abortSignal: options.abortSignal,  // 传递中断信号
            runInBackgroundOnFirstAIAction: shouldBackgroundOnAI,
			onBackgroundExecutionStart: options.onBackgroundExecutionStart,
			onBackgroundExecutionFinish: options.onBackgroundExecutionFinish,
        }
        chain.validate(actionContext);
        // run all action sequentially
        await chain.next(actionContext);
    }

    async submitDirectly(formConfig: FormConfig, app: App) {
        const executionManager = FormExecutionManager.getInstance(app);
        
        try {
            // 检查执行条件
            if (formConfig.hasStartupConditions()) {
                const conditionService = getStartupConditionService();
                const evaluationResult = await conditionService.evaluateConditions(
                    formConfig.getStartupConditions()!,
                    {
                        app,
                        currentFile: app.workspace.getActiveFile(),
                        formFilePath: formConfig.filePath,
                        lastExecutionTime: formConfig.lastExecutionTime,
                        pluginVersion: app.plugins.getPlugin('obsidian-formify')?.manifest.version || '0.0.0'
                    },
                    "startup"
                );
                
                if (!evaluationResult.satisfied) {
                    // 显示详细的条件不满足信息
                    const detailMessage = this.formatConditionFailureMessage(evaluationResult);
                    ToastManager.info(detailMessage, 5000);
                    return;
                }
            }
            
            // 启动执行监控
            const abortController = executionManager.startExecution(
                formConfig.enableExecutionTimeout ?? false,
                formConfig.executionTimeoutThreshold ?? 30
            );
            
            const formIdValues = resolveDefaultFormIdValues(formConfig.fields);
            const context: FormSubmitOptions = {
                app: app,
                abortSignal: abortController.signal,
            };
            const promise = this.submit(formIdValues, formConfig, context);
            
            // 完成后清理
            promise.finally(() => {
                executionManager.finishExecution();
                // 更新最后执行时间
                if (formConfig.hasStartupConditions()) {
                    formConfig.updateLastExecutionTime();
                }
            });
            
            // 根据配置决定是否显示提交成功提示
            if (formConfig.showSubmitSuccessToast !== false) {
                showPromiseToast(promise, {
                    loadingMessage: localInstance.handling,
                    successMessage: localInstance.submit_success,
                    successDuration: 3000
                });
            }
            
            return promise;
        } catch (e) {
            executionManager.finishExecution();
            ToastManager.error(e.message || localInstance.unknown_error, 5000);
        }
    }

    async open(file: TFile, app: App) {
        const data = await app.vault.readJson(file.path);
        const form = FormConfig.fromJSON(data);

        // 检查是否需要显示表单界面
        if (FormDisplayRules.shouldShowForm(form)) {
            // 需要用户输入，显示表单界面，并且只显示需要输入的字段
            const m = new FormViewModal2(app, {
                formFilePath: file.path,
                options: {
                    showOnlyFieldsNeedingInput: true
                }
            });
            m.open();
        } else {
            // 不需要用户输入，直接提交
            const formService = new FormService();
            await formService.submitDirectly(form, app);
        }
    }

    async openForm(
        formConfig: FormConfig,
        app: App,
        options?: {
            /**
             * 严格串行：延迟关闭表单界面，直到动作链执行完成。
             */
            deferAfterSubmitUntilFinish?: boolean;
            /**
             * 嵌套执行：复用父级 AbortController，避免中断父级执行。
             */
            nestedExecution?: boolean;
            /**
             * 禁用“首个 AI 动作后台执行”优化（严格串行时需要）。
             */
            disableBackgroundExecutionOnAI?: boolean;
        }
    ): Promise<FormModalResult> {
        // 检查是否需要显示表单界面
        if (FormDisplayRules.shouldShowForm(formConfig)) {
            // 需要用户输入，显示表单界面，并且只显示需要输入的字段
            const m = new FormViewModal2(app, {
                formConfig: formConfig,
                options: {
                    showOnlyFieldsNeedingInput: true,
                    deferAfterSubmitUntilFinish: options?.deferAfterSubmitUntilFinish,
                    nestedExecution: options?.nestedExecution,
                    disableBackgroundExecutionOnAI: options?.disableBackgroundExecutionOnAI,
                }
            });
            // 等待用户操作完成
            return await m.open();
        } else {
            // 不需要用户输入，直接提交
            const formService = new FormService();
            await formService.submitDirectly(formConfig, app);
            return { submitted: true };
        }
    }

    /**
     * 格式化条件不满足的提示信息
     */
    private formatConditionFailureMessage(result: ConditionEvaluationResult): string {
        const baseMessage = localInstance.startup_condition_not_met_detail || "表单执行条件未满足：{0}";
        
        // 收集所有不满足的条件详情
        const failedDetails: string[] = [];
        
        // 主要详情
        if (result.details) {
            failedDetails.push(result.details);
        }
        
        // 子条件详情
        if (result.childResults) {
            for (const childResult of result.childResults) {
                if (!childResult.satisfied && childResult.details) {
                    failedDetails.push(childResult.details);
                }
            }
        }
        
        // 错误信息
        if (result.error) {
            failedDetails.push(`错误: ${result.error}`);
        }
        
        const detailText = failedDetails.length > 0 
            ? failedDetails.join("；") 
            : "未知原因";
        
        return baseMessage.replace("{0}", detailText);
    }
}