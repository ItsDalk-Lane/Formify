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

}
