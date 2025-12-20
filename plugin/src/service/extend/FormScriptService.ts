import { FormScript } from "./FormScript";
import { DebugLogger } from '../../utils/DebugLogger';
import { FormScriptLoader } from "./FormScriptLoader";
import { FormScriptRunner } from "./FormScriptRunner";
import { App, EventRef, normalizePath, TAbstractFile, TFile } from "obsidian";


export class FormScriptService {

    private formScripts: Map<string, FormScript> = new Map();

    private formScriptLoader: FormScriptLoader = new FormScriptLoader();

    private eventRefs: EventRef[] = [];

    private extensionFolder: string;

    private app: App;

    getFunctions() {
        return Array.from(this.formScripts.values());
    }

    async run(expression: string, contextOptions: Record<string, any> = {}) {
        const functions = Array.from(this.formScripts.values())
        return FormScriptRunner.run(this.app, expression, functions, contextOptions);
    }

    async runWithFunctions(additionalFunctions: FormScript[], expression: string, contextOptions: Record<string, any> = {}) {
        const functions = Array.from(this.formScripts.values())
        const allExtensions = [
            ...functions,
            ...additionalFunctions
        ]
        return FormScriptRunner.run(this.app, expression, allExtensions, contextOptions);
    }

    async refresh(extensionFolder: string) {
        if (!this.app) {
            return;
        }
        const normalizedFolder = this.normalizeExtensionFolder(extensionFolder);
        const folderChanged = this.extensionFolder !== normalizedFolder;
        this.extensionFolder = normalizedFolder;
        const functions = await this.formScriptLoader.loadAll(this.app, this.extensionFolder);
        this.formScripts.clear();
        functions.forEach((extension) => {
            this.formScripts.set(extension.id, extension);
        });
        if (folderChanged) {
            this.resetWatchers();
        }
    }

    unload() {
        this.clearWatchers();
    }

    async initialize(app: App, scriptFolder: string) {
        this.app = app;
        this.extensionFolder = this.normalizeExtensionFolder(scriptFolder);

        const functions = await this.formScriptLoader.loadAll(app, this.extensionFolder);
        this.formScripts.clear();
        functions.forEach((extension) => {
            this.formScripts.set(extension.id, extension);
        });
        this.resetWatchers();
        // DebugLogger.info("script extension loaded " + this.formScripts.size + " functions from " + this.extensionFolder, this.formScripts);
    }

    private resetWatchers() {
        this.clearWatchers();
        if (!this.app || !this.extensionFolder) {
            return;
        }
        this.eventRefs = this.createWatchers();
    }

    private createWatchers(): EventRef[] {
        const app = this.app;
        const createFileEventRef = app.vault.on("create", async (file: TFile) => {
            if (this.isExtensionFile(file)) {
                const extension = await this.formScriptLoader.load(app, file);
                if (extension) {
                    this.formScripts.set(file.path, extension);
                }
            }
        });

        const deleteFileEventRef = app.vault.on("delete", (file: TFile) => {
            if (this.isExtensionFile(file)) {
                this.formScripts.delete(file.path);
            }
        });

        const modifyFileEventRef = app.vault.on("modify", async (file: TFile) => {
            if (this.isExtensionFile(file)) {
                const extension = await this.formScriptLoader.load(app, file);
                if (extension) {
                    this.formScripts.set(file.path, extension);
                }
            }
        });

        const renameFileEventRef = app.vault.on("rename", async (file: TFile, oldPath: string) => {
            if (this.isExtensionFile(file)) {
                this.formScripts.delete(oldPath);
                const extension = await this.formScriptLoader.load(app, file);
                if (extension) {
                    this.formScripts.set(file.path, extension);
                }
            }
        });
        return [createFileEventRef, deleteFileEventRef, modifyFileEventRef, renameFileEventRef];
    }

    private clearWatchers() {
        if (!this.app) {
            return;
        }
        this.eventRefs.forEach(ref => {
            this.app.vault.offref(ref);
        });
        this.eventRefs = [];
    }


    private normalizeExtensionFolder(scriptFolder: string) {
        const folder = scriptFolder || "";
        const normalizedFolder = normalizePath(folder);
        return normalizedFolder;
    }

    private isExtensionFile(file: TAbstractFile) {
        if (file instanceof TFile) {
            const folder = this.extensionFolder || "";
            const isExtensionFile = file.path.startsWith(folder) && file.extension === "js";
            return isExtensionFile;
        }
        return false;
    }

    getExtensionFolder() {
        return this.extensionFolder;
    }
}