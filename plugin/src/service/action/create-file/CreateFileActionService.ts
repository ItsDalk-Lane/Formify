import { TFile } from "obsidian";
import { localInstance } from "src/i18n/locals";
import { ContentTemplateSource, CreateFileFormAction } from "src/model/action/CreateFileFormAction";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { createFileByText, CreateFileOptions } from "src/utils/createFileByText";
import { openFilePathDirectly } from "src/utils/openFilePathDirectly";
import { FormTemplateProcessEngine } from "../../engine/FormTemplateProcessEngine";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { getFilePathFromAction } from "../util/getFilePathFromAction";
import { validateFileName } from "../util/validateFileName";
import { validateAndConvertToString, TypeConversionError, FormFieldValidationError, logTypeConversion } from "src/utils/typeSafety";

export default class CreateFileActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.CREATE_FILE;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
        const formAction = action as CreateFileFormAction;
        const engine = new FormTemplateProcessEngine();
        const state = context.state;
        await validateFileName(formAction, context);

        // Validate form values before processing
        await this.validateFormValues(state, formAction);

        const app = context.app;
        let formContent;
        try {
            if (formAction.contentTemplateSource === ContentTemplateSource.FILE) {
                const templateFilePath = formAction.templateFile ?? "";
                if (templateFilePath.trim() === "") {
                    formContent = "";
                } else {
                    // Validate and process template file path
                    const processedTemplateFilePath = await this.validateAndProcessTemplatePath(
                        engine, formAction.templateFile, state, context.app
                    );

                    const templateFile = app.vault.getAbstractFileByPath(processedTemplateFilePath);
                    if (!templateFile || !(templateFile instanceof TFile)) {
                        throw new FormFieldValidationError(
                            "templateFile",
                            "file path",
                            localInstance.template_file_not_exists + ": " + processedTemplateFilePath,
                            "Ensure the template file exists at the specified path"
                        );
                    }
                    const templateContent = await app.vault.cachedRead(templateFile);
                    formContent = await this.validateAndProcessContent(
                        engine, templateContent, state, context.app, "template content"
                    );
                }
            } else {
                formContent = await this.validateAndProcessContent(
                    engine, formAction.content, state, context.app, "direct content"
                );
            }
        } catch (error) {
            if (error instanceof FormFieldValidationError || error instanceof TypeConversionError) {
                // Show user-friendly error with guidance
                throw new Error(error.getUserFriendlyMessage());
            }
            throw error;
        }

        // Validate and process file path
        const filePath = await this.validateAndProcessFilePath(formAction, context, engine);

        const conflictResolution = formAction.conflictResolution || FileConflictResolution.SKIP;

        // Configure create file options with type checking
        const createFileOptions: CreateFileOptions = {
            enableAutoTypeConversion: true,
            strictTypeChecking: false,
            logTypeConversions: process.env.NODE_ENV === 'development',
            onTypeConversionWarning: (warning) => {
                console.warn(`Create file type conversion warning: ${warning.location}`, warning);
            }
        };

        const file = await createFileByText(app, filePath, formContent, conflictResolution, createFileOptions);

        // Open the actual created file (which might have a different path due to auto-renaming)
        openFilePathDirectly(app, file.path, formAction.openPageIn || OpenPageInType.none);

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

    /**
     * Validates and processes template file path
     */
    private async validateAndProcessTemplatePath(
        engine: FormTemplateProcessEngine,
        templatePath: string,
        state: any,
        app: any
    ): Promise<string> {
        try {
            const processedPath = await engine.process(templatePath, state, app);

            // Validate the processed path
            if (typeof processedPath !== 'string') {
                throw new TypeConversionError(
                    processedPath,
                    'string',
                    typeof processedPath,
                    'Template file path must resolve to a string',
                    {
                        fieldName: 'templateFile',
                        actionType: 'create_file',
                        usage: 'template file path resolution'
                    }
                );
            }

            if (processedPath.trim() === '') {
                throw new FormFieldValidationError(
                    'templateFile',
                    'file path',
                    'Template file path cannot be empty',
                    'Provide a valid template file path'
                );
            }

            return processedPath;
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                'templateFile',
                'file path',
                `Failed to process template file path: ${error.message}`,
                'Check template file path variables and ensure they resolve to valid strings'
            );
        }
    }

    /**
     * Validates and processes content for file creation
     */
    private async validateAndProcessContent(
        engine: FormTemplateProcessEngine,
        content: string,
        state: any,
        app: any,
        contentType: string
    ): Promise<string> {
        try {
            const processedContent = await engine.process(content, state, app);

            // Ensure content is a string
            const stringContent = validateAndConvertToString(
                processedContent,
                {
                    fieldName: 'content',
                    actionType: 'create_file',
                    usage: `${contentType} processing`
                }
            );

            return stringContent;
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                'content',
                'file content',
                `Failed to process ${contentType}: ${error.message}`,
                'Check content variables and ensure they can be converted to strings'
            );
        }
    }

    /**
     * Validates and processes file path
     */
    private async validateAndProcessFilePath(
        formAction: CreateFileFormAction,
        context: ActionContext,
        engine: FormTemplateProcessEngine
    ): Promise<string> {
        try {
            const filePath = await getFilePathFromAction(formAction, context);

            // Validate file path type
            if (typeof filePath !== 'string') {
                throw new TypeConversionError(
                    filePath,
                    'string',
                    typeof filePath,
                    'File path must be a string',
                    {
                        fieldName: 'filePath',
                        actionType: 'create_file',
                        usage: 'file path generation'
                    }
                );
            }

            // Check for invalid characters in file path
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(filePath)) {
                throw new FormFieldValidationError(
                    'filePath',
                    'file path',
                    'File path contains invalid characters',
                    'Remove characters like < > : " | ? * from file paths'
                );
            }

            return filePath;
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                'filePath',
                'file path',
                `Failed to process file path: ${error.message}`,
                'Check file path variables and ensure they resolve to valid paths'
            );
        }
    }

}