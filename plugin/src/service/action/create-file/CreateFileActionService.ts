import { normalizePath, TFolder } from "obsidian";
import { localInstance } from "src/i18n/locals";
import { ContentTemplateSource, CreateFileFormAction } from "src/model/action/CreateFileFormAction";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { CreateFileMode } from "src/model/enums/CreateFileMode";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { getFilePathFromAction } from "../util/getFilePathFromAction";
import { validateFileName } from "../util/validateFileName";
import { FormFieldValidationError } from "src/utils/typeSafety";
import { FileOperationService } from "src/service/FileOperationService";
import { FormTemplateProcessEngine } from "src/service/engine/FormTemplateProcessEngine";
import { Strings } from "src/utils/Strings";

export default class CreateFileActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.CREATE_FILE;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
        const formAction = action as CreateFileFormAction;
        const state = context.state;

        try {
            await this.validateFormValues(state, formAction);
            const mode =
                formAction.createFileMode ?? CreateFileMode.SINGLE_FILE;
            switch (mode) {
                case CreateFileMode.BATCH_FILES:
                    await this.handleBatchFiles(formAction, context);
                    break;
                case CreateFileMode.SINGLE_FOLDER:
                    await this.handleSingleFolder(formAction, context);
                    break;
                case CreateFileMode.BATCH_FOLDERS:
                    await this.handleBatchFolders(formAction, context);
                    break;
                case CreateFileMode.SINGLE_FILE:
                default:
                    await this.handleSingleFile(formAction, context);
                    break;
            }
        } catch (error) {
            if (error instanceof FormFieldValidationError) {
                throw new Error(error.getUserFriendlyMessage());
            }
            throw error;
        }

        // do next
        await chain.next(context);
    }

    private async handleSingleFile(
        formAction: CreateFileFormAction,
        context: ActionContext
    ): Promise<void> {
        await validateFileName(formAction, context);

        const state = context.state;
        const filePath = await getFilePathFromAction(formAction, context);
        const conflictResolution =
            formAction.conflictResolution || FileConflictResolution.SKIP;
        const fileService = new FileOperationService(context.app);
        const { content, template } = this.resolveWriteContent(formAction);

        const writeResult = await fileService.writeFile({
            path: filePath,
            content,
            template,
            state,
            conflictStrategy: conflictResolution,
            createFolders: true,
            createFileOptions: {
                enableAutoTypeConversion: true,
                strictTypeChecking: false,
                logTypeConversions: process.env.NODE_ENV === "development",
            },
        });

        if (!writeResult.success) {
            throw new Error(writeResult.error || localInstance.submit_failed);
        }

        const openMode = formAction.openPageIn || OpenPageInType.none;
        const targetPath = writeResult.actualPath ?? writeResult.path;
        await fileService.openFile({
            path: targetPath,
            mode: openMode,
            state,
        });
    }

    private async handleBatchFiles(
        formAction: CreateFileFormAction,
        context: ActionContext
    ): Promise<void> {
        const fileService = new FileOperationService(context.app);
        const state = context.state;
        const conflictResolution =
            formAction.conflictResolution || FileConflictResolution.SKIP;
        const targets = (formAction.batchFilePaths ?? []).filter((path) =>
            Strings.isNotBlank(path)
        );

        if (targets.length === 0) {
            throw new Error(localInstance.file_path_required);
        }

        const { content, template } = this.resolveWriteContent(formAction);

        for (const target of targets) {
            const writeResult = await fileService.writeFile({
                path: target,
                content,
                template,
                state,
                conflictStrategy: conflictResolution,
                createFolders: true,
                createFileOptions: {
                    enableAutoTypeConversion: true,
                    strictTypeChecking: false,
                    logTypeConversions: process.env.NODE_ENV === "development",
                },
            });

            if (!writeResult.success) {
                throw new Error(
                    writeResult.error ||
                        `${localInstance.submit_failed}: ${target}`
                );
            }
        }
    }

    private async handleSingleFolder(
        formAction: CreateFileFormAction,
        context: ActionContext
    ): Promise<void> {
        const path = await this.renderPath(formAction.folderPath ?? "", context);
        if (Strings.isBlank(path)) {
            throw new Error(localInstance.folder_path_required);
        }
        await this.ensureFolderPathExists(path, context);
    }

    private async handleBatchFolders(
        formAction: CreateFileFormAction,
        context: ActionContext
    ): Promise<void> {
        const targets = (formAction.batchFolderPaths ?? []).filter((path) =>
            Strings.isNotBlank(path)
        );

        if (targets.length === 0) {
            throw new Error(localInstance.folder_path_required);
        }

        for (const rawPath of targets) {
            const path = await this.renderPath(rawPath, context);
            if (Strings.isBlank(path)) {
                continue;
            }
            await this.ensureFolderPathExists(path, context);
        }
    }

    private resolveWriteContent(formAction: CreateFileFormAction): {
        content: string;
        template: string;
    } {
        const template =
            formAction.contentTemplateSource === ContentTemplateSource.FILE
                ? (formAction.templateFile ?? "")
                : "";
        const content =
            formAction.contentTemplateSource === ContentTemplateSource.FILE
                ? ""
                : (formAction.content ?? "");
        return { content, template };
    }

    private async renderPath(
        path: string,
        context: ActionContext
    ): Promise<string> {
        const engine = new FormTemplateProcessEngine();
        const rendered = await engine.process(path, context.state, context.app);
        return normalizePath(rendered ?? "");
    }

    private async ensureFolderPathExists(
        folderPath: string,
        context: ActionContext
    ): Promise<void> {
        const app = context.app;
        const normalized = normalizePath(folderPath).replace(/^\/+/, "");
        if (Strings.isBlank(normalized)) {
            return;
        }

        const parts = normalized.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const existing = app.vault.getAbstractFileByPath(current);
            if (existing && !(existing instanceof TFolder)) {
                throw new Error(`${current} is not a folder`);
            }
            if (!existing) {
                await app.vault.createFolder(current);
            }
        }
    }

    /**
     * Validates form values for type-related issues
     */
    private async validateFormValues(state: any, formAction: CreateFileFormAction): Promise<void> {
        // Check for problematic object types in form values
        for (const [fieldName, value] of Object.entries(state.values)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                try {
                    JSON.stringify(value);
                } catch (error) {
                    throw new FormFieldValidationError(
                        fieldName,
                        "complex object",
                        `Field contains non-serializable data: ${error.message}`,
                        "Use simpler data types (string, number, boolean) or serializable objects"
                    );
                }
            }

            if (typeof value === 'function') {
                throw new FormFieldValidationError(
                    fieldName,
                    "function",
                    "Functions cannot be used in form templates",
                    "Remove function references from form fields"
                );
            }
        }
    }

}
