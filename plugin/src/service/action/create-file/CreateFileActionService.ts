import { localInstance } from "src/i18n/locals";
import { ContentTemplateSource, CreateFileFormAction } from "src/model/action/CreateFileFormAction";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { getFilePathFromAction } from "../util/getFilePathFromAction";
import { validateFileName } from "../util/validateFileName";
import { FormFieldValidationError } from "src/utils/typeSafety";
import { FileOperationService } from "src/service/FileOperationService";

export default class CreateFileActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.CREATE_FILE;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
        const formAction = action as CreateFileFormAction;
        const state = context.state;
        await validateFileName(formAction, context);

        // Validate form values before processing
        await this.validateFormValues(state, formAction);

        const filePath = await getFilePathFromAction(formAction, context);
        const conflictResolution = formAction.conflictResolution || FileConflictResolution.SKIP;
        const fileService = new FileOperationService(context.app);

        try {
            const template =
                formAction.contentTemplateSource === ContentTemplateSource.FILE
                    ? (formAction.templateFile ?? "")
                    : "";
            const content =
                formAction.contentTemplateSource === ContentTemplateSource.FILE
                    ? ""
                    : (formAction.content ?? "");

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
        } catch (error) {
            if (error instanceof FormFieldValidationError) {
                throw new Error(error.getUserFriendlyMessage());
            }
            throw error;
        }

        // do next
        await chain.next(context);
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