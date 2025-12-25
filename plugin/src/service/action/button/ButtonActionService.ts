import { TFile, Notice, WorkspaceLeaf } from "obsidian";
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
import { FileModalWindow } from "src/component/modal/FileModalWIndow";

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
                await this.submitForm(formAction, context);
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

        const file = app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`${localInstance.file_not_found}: ${filePath}`);
            return;
        }

        const openPageIn = action.openPageIn || OpenPageInType.tab;

        switch (openPageIn) {
            case OpenPageInType.none:
                // 不打开
                break;
            case OpenPageInType.modal:
                // 在模态窗口中打开
                FileModalWindow.open(app, file);
                break;
            case OpenPageInType.tab:
                // 在新标签页中打开
                const newLeaf = app.workspace.getLeaf('tab');
                await newLeaf.openFile(file);
                break;
            case OpenPageInType.current:
                // 在当前页打开
                const activeLeaf = app.workspace.getLeaf(false);
                await activeLeaf.openFile(file);
                break;
            case OpenPageInType.split:
                // 分屏打开（默认右侧分屏）
                const splitLeaf = app.workspace.getLeaf('split');
                await splitLeaf.openFile(file);
                break;
            case OpenPageInType.window:
                // 在新窗口中打开
                const windowLeaf = app.workspace.getLeaf('window');
                await windowLeaf.openFile(file);
                break;
            default:
                const defaultLeaf = app.workspace.getLeaf('tab');
                await defaultLeaf.openFile(file);
                break;
        }
    }

    private async submitForm(action: ButtonFormAction, context: ActionContext) {
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
            await formService.openForm(formConfig, app);
        } catch (e) {
            new Notice(`加载表单失败: ${e.message}`);
        }
    }
}
