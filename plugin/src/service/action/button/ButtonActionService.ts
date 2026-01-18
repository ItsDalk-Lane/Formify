import { TFile, Notice } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ButtonActionType } from "src/model/enums/ButtonActionType";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { localInstance } from "src/i18n/locals";
import { FormService } from "src/service/FormService";
import { FormConfig } from "src/model/FormConfig";
import { FormTemplateProcessEngine } from "../../engine/FormTemplateProcessEngine";
import { FormExecutionMode } from "src/model/enums/FormExecutionMode";
import { FormDisplayMode } from "src/model/enums/FormDisplayMode";
import MultiSubmitFormsModal, {
    MultiSubmitFormsModalEntry,
} from "src/component/modal/MultiSubmitFormsModal";
import { FormDisplayRules } from "src/utils/FormDisplayRules";
import { resolveDefaultFormIdValues } from "src/utils/resolveDefaultFormIdValues";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";
import { CommandRuntimeFieldsGenerator } from "src/utils/CommandRuntimeFieldsGenerator";
import { FileOperationService } from "src/service/FileOperationService";

export class ButtonActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.BUTTON;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
        const formAction = action as ButtonFormAction;
        const app = context.app;

        switch (formAction.buttonActionType) {
            case ButtonActionType.OPEN_URL:
                await this.openUrl(formAction, context);
                break;
            case ButtonActionType.OPEN_FILE:
                await this.openFile(formAction, context);
                break;
            case ButtonActionType.SUBMIT_FORM:
                await this.submitForm(formAction, context, chain);
                break;
            default:
                new Notice(localInstance.unknown_error);
                break;
        }

        return await chain.next(context);
    }

    private async openUrl(action: ButtonFormAction, context: ActionContext) {
        const engine = new FormTemplateProcessEngine();
        const url = await engine.process(action.url || "", context.state, context.app);
        
        if (!url) {
            new Notice("URL 不能为空");
            return;
        }

        // 使用 Obsidian 的方式打开 URL
        window.open(url, '_blank');
    }

    private async openFile(action: ButtonFormAction, context: ActionContext) {
        const app = context.app;
        const engine = new FormTemplateProcessEngine();
        const filePath = await engine.process(action.filePath || "", context.state, context.app);

        if (!filePath) {
            new Notice(localInstance.file_path_required);
            return;
        }

        const openPageIn = action.openPageIn || OpenPageInType.tab;
        const fileService = new FileOperationService(app);
        const result = await fileService.openFile({
            path: filePath,
            mode: openPageIn,
            state: context.state,
        });
        if (!result.success) {
            new Notice(result.error || `${localInstance.file_not_found}: ${filePath}`);
        }
    }

    /**
     * 提交表单动作
     * 会等待被调用表单的用户操作完成（提交或取消）及其动作链执行完毕
     */
    private async submitForm(action: ButtonFormAction, context: ActionContext, chain: ActionChain) {
        const executionMode = context.config.multiSubmitFormExecutionMode || FormExecutionMode.SEQUENTIAL;

        // 并行执行时强制合并界面；否则使用表单级界面模式
        const displayMode =
            executionMode === FormExecutionMode.PARALLEL
                ? FormDisplayMode.MERGED
                : (context.config.multiSubmitFormDisplayMode || FormDisplayMode.SINGLE);

        // 合并界面：把连续的 SUBMIT_FORM 动作作为一个“组”处理
        if (displayMode === FormDisplayMode.MERGED) {
            await this.submitFormsMerged(action, context, chain, executionMode);
            return;
        }

        const app = context.app;
        const engine = new FormTemplateProcessEngine();
        const formFilePath = await engine.process(action.formFilePath || "", context.state, context.app);

        if (!formFilePath) {
            new Notice("表单文件路径不能为空");
            return;
        }

        const file = app.vault.getAbstractFileByPath(formFilePath);
        if (!(file instanceof TFile)) {
            new Notice(`${localInstance.file_not_found}: ${formFilePath}`);
            return;
        }

        try {
            const data = await app.vault.readJson(file.path);
            const formConfig = FormConfig.fromJSON(data);
            const formService = new FormService();
            
            // 等待用户操作完成（提交或取消）
            // openForm 现在返回 Promise，会在用户提交表单后 resolve
            // 如果用户取消表单，Promise 也会 resolve（submitted: false）
            const result = await formService.openForm(formConfig, app, {
                // 多表单串行：必须等动作链完成后再继续
                deferAfterSubmitUntilFinish: true,
                // 嵌套调用：不能中断父级执行（否则 AI/动作链会被 abort）
                nestedExecution: true,
                // 严格串行：禁用 AI 后台执行，否则 submit 会提前返回
                disableBackgroundExecutionOnAI: true,
            });
            
            // 用户取消了表单，不继续执行后续动作
            if (!result.submitted) {
                return;
            }
            
            // 表单已提交，其内部的动作链会在 submit 时执行
            // openForm -> FormViewModal2.open -> CpsFormDataView.afterSubmit -> FormService.submit
            // 所以到达这里时，被调用表单的动作链已经执行完毕
        } catch (e) {
            new Notice(`加载表单失败: ${e.message}`);
        }
    }

    private async submitFormsMerged(
        firstAction: ButtonFormAction,
        context: ActionContext,
        chain: ActionChain,
        executionMode: FormExecutionMode
    ) {
        const app = context.app;
        const engine = new FormTemplateProcessEngine();

        const actions: ButtonFormAction[] = [firstAction];
        // 收集后续连续的 SUBMIT_FORM 动作，并跳过它们（防止再次执行）
        while (chain.index < chain.actions.length) {
            const nextAction = chain.actions[chain.index] as any;
            if (
                nextAction?.type !== FormActionType.BUTTON ||
                nextAction?.buttonActionType !== ButtonActionType.SUBMIT_FORM
            ) {
                break;
            }
            actions.push(nextAction as ButtonFormAction);
            chain.index += 1;
        }

        const entries: MultiSubmitFormsModalEntry[] = [];
        for (const a of actions) {
            const formFilePath = await engine.process(a.formFilePath || "", context.state, context.app);
            if (!formFilePath) {
                new Notice("表单文件路径不能为空");
                return;
            }

            const file = app.vault.getAbstractFileByPath(formFilePath);
            if (!(file instanceof TFile)) {
                new Notice(`${localInstance.file_not_found}: ${formFilePath}`);
                return;
            }

            const data = await app.vault.readJson(file.path);
            const formConfig = FormConfig.fromJSON(data);

            // 生成完整的字段列表（与 CpsFormActionView 保持一致）
            // 1. 生成 AI 运行时字段（如模型选择、模板选择）
            const aiRuntimeFields = AIRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
            // 2. 生成命令运行时选择字段
            const commandRuntimeFields = CommandRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
            // 3. 合并所有字段：表单原有字段 + AI运行时字段 + 命令运行时字段
            const allFields = [...formConfig.fields, ...aiRuntimeFields, ...commandRuntimeFields];

            // 仅在需要界面输入的表单才显示字段；否则保持空字段（提交时直接用默认值执行）
            const fields = FormDisplayRules.shouldShowForm(formConfig)
                ? allFields
                : [];

            const title = file.basename;
            entries.push({
                key: file.path,
                title,
                formConfig,
                fields,
            });
        }

        const modal = new MultiSubmitFormsModal(app, entries);
        const result = await modal.open();
        if (!result.submitted || !result.valuesByKey) {
            return;
        }

        const formService = new FormService();

        const submitOne = async (entry: MultiSubmitFormsModalEntry) => {
            const values = result.valuesByKey?.[entry.key] ?? {};
            // 使用完整字段列表（包括运行时字段）来计算默认值
            const base = resolveDefaultFormIdValues(entry.fields.length > 0 ? entry.fields : entry.formConfig.fields);
            const idValues = { ...base, ...values };

            await formService.submit(idValues, entry.formConfig, {
                app,
                abortSignal: context.abortSignal,
                enableBackgroundExecutionOnAI: false,
            });
        };

        if (executionMode === FormExecutionMode.PARALLEL) {
            await Promise.all(entries.map((e) => submitOne(e)));
            return;
        }

        for (const entry of entries) {
            await submitOne(entry);
        }
    }
}
