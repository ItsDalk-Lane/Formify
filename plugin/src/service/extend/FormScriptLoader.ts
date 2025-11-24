import { App, normalizePath, TFile } from "obsidian";
import { FormScriptComipler } from "./FormScriptComipler";
import { FormScript } from "./FormScript";

export class FormScriptLoader {

    async loadAll(app: App, folder: string) {
        // folder
        const extendFiles = this.loadExtensionFiles(folder);
        const extension: FormScript[] = [];
        for (const extendFile of extendFiles) {
            try {
                const extend = await this.load(app, extendFile);
                if (extend) {
                    extension.push(extend);
                }
            } catch (error) {
                // 记录错误但继续处理其他文件
                console.error(`FormFlow: Failed to load script file "${extendFile.path}":`, error);
                // 继续处理下一个文件，不让单个文件的错误阻止整个插件加载
            }
        }
        return extension;
    }

    private loadExtensionFiles(folder: string) {
        const normalizedFolder = normalizePath(folder)
        return app.vault.getFiles().filter(f => {
            return f.path.startsWith(normalizedFolder) && f.extension === "js";
        })
    }

    async load(app: App, extendFile: TFile): Promise<FormScript | null> {
        try {
            const content = await app.vault.read(extendFile);
            const extension = await this.compile(content, extendFile.path);
            return extension;
        } catch (error) {
            // 重新抛出错误，让上层处理
            throw error;
        }
    }

    private async compile(content: string, filePath: string) {
        return FormScriptComipler.compile(filePath, content);
    }

}