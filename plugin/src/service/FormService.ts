import { App, TFile } from "obsidian";
import FormViewModal2 from "src/component/modal/FormViewModal2";
import { localInstance } from "src/i18n/locals";
import { showPromiseToast } from "../component/toast/PromiseToast";
import { ToastManager } from "../component/toast/ToastManager";
import { getStartupConditionService } from "../service/startup-condition/StartupConditionService";
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
        const visibleIdValues = FormVisibilies.getVisibleIdValues(config.fields, processedIdValues);
        const formLabelValues = FormVisibilies.toFormLabelValues(config.fields, processedIdValues);
        const actionContext: ActionContext = {
            app: options.app,
            config: config,
            state: {
                idValues: visibleIdValues,
                values: formLabelValues,
            },
            abortSignal: options.abortSignal  // 传递中断信号
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
                const canExecute = await conditionService.evaluate(
                    formConfig.getStartupConditions()!,
                    {
                        app,
                        formConfig,
                        currentTime: Date.now(),
                        lastExecutionTime: formConfig.lastExecutionTime,
                        pluginVersion: app.plugins.getPlugin('obsidian-formify')?.manifest.version || '0.0.0'
                    }
                );
                
                if (!canExecute) {
                    ToastManager.info(localInstance.execution_condition_not_met || '表单执行条件未满足', 3000);
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

    async openForm(formConfig: FormConfig, app: App) {
        // 检查是否需要显示表单界面
        if (FormDisplayRules.shouldShowForm(formConfig)) {
            // 需要用户输入，显示表单界面，并且只显示需要输入的字段
            const m = new FormViewModal2(app, {
                formConfig: formConfig,
                options: {
                    showOnlyFieldsNeedingInput: true
                }
            });
            m.open();
        } else {
            // 不需要用户输入，直接提交
            const formService = new FormService();
            await formService.submitDirectly(formConfig, app);
        }
    }
}