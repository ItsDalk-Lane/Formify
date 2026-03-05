import { App, Notice, TFile } from "obsidian";
import { FormService } from "src/service/FormService";
import { FormConfig } from "src/model/FormConfig";

export class FormFlowApi {

    constructor(public app: App, private formService: FormService) {}

    async openFormFile(filePath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.formService.open(file, this.app);
        } else {
            new Notice(`Form File not found: ${filePath}`);
        }
    }
	
    async submitFormFile(filePath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const data = await this.app.vault.readJson(file.path);
            const form = FormConfig.fromJSON(data);
            await this.formService.submitDirectly(form, this.app);
        } else {
            new Notice(`Form File not found: ${filePath}`);
        }
    }

    /**
     * 通过触发器名称执行表单中的特定动作子集
     * @param filePath 表单文件路径
     * @param triggerName 触发器名称
     */
    async openFormTrigger(filePath: string, triggerName: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Form File not found: ${filePath}`);
            return;
        }

        const data = await this.app.vault.readJson(file.path);
        const form = FormConfig.fromJSON(data);
        const trigger = form.getActionTriggerByName(triggerName);

        if (!trigger) {
            new Notice(`Trigger not found: ${triggerName}`);
            return;
        }

        await this.formService.openByTrigger(trigger, file, this.app);
    }

    /**
     * 通过触发器名称直接提交表单中的特定动作子集（无界面）
     * @param filePath 表单文件路径
     * @param triggerName 触发器名称
     */
    async submitFormTrigger(filePath: string, triggerName: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Form File not found: ${filePath}`);
            return;
        }

        const data = await this.app.vault.readJson(file.path);
        const form = FormConfig.fromJSON(data);
        const trigger = form.getActionTriggerByName(triggerName);

        if (!trigger) {
            new Notice(`Trigger not found: ${triggerName}`);
            return;
        }

        await this.formService.submitDirectlyByTrigger(trigger, form, this.app);
    }

    /**
     * 通过触发器 ID 直接提交表单中的特定动作子集（无界面）
     * @param filePath 表单文件路径
     * @param triggerId 触发器 ID
     */
    async submitFormTriggerById(filePath: string, triggerId: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Form File not found: ${filePath}`);
            return;
        }

        const data = await this.app.vault.readJson(file.path);
        const form = FormConfig.fromJSON(data);
        const trigger = form.getActionTrigger(triggerId);

        if (!trigger) {
            new Notice(`Trigger not found: ${triggerId}`);
            return;
        }

        await this.formService.submitDirectlyByTrigger(trigger, form, this.app);
    }

}
