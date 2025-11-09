import { App } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import { InsertTextFormAction } from "src/model/action/InsertTextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { TargetFileType } from "src/model/enums/TargetFileType";
import { TextInsertPosition } from "src/model/enums/TextInsertPosition";
import { openFilePathDirectly } from "src/utils/openFilePathDirectly";
import { FormTemplateProcessEngine } from "../../engine/FormTemplateProcessEngine";
import { FormState } from "../../FormState";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { createFileFromActionIfNotExists } from "../util/createFileFromActionIfNotExists";
import { getFilePathFromAction } from "../util/getFilePathFromAction";
import { validateFileName } from "../util/validateFileName";
import ContentInsertionService from "./ContentInsertionService";
import { validateAndConvertToString, TypeConversionError, FormFieldValidationError, logTypeConversion } from "src/utils/typeSafety";

export default class InsertTextActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.INSERT_TEXT;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<any> {
        const formAction = action as InsertTextFormAction;
        const state = context.state;

        try {
            // Validate form values before processing
            await this.validateFormValues(state, formAction);

            await validateFileName(formAction, context);
            const file = await this.getFile(formAction, context);
            await this.insertText(file.path, state, formAction, context);

            // do next
            if (chain) {
                return await chain.next(context);
            }
        } catch (error) {
            if (error instanceof FormFieldValidationError || error instanceof TypeConversionError) {
                // Show user-friendly error with guidance
                throw new Error(error.getUserFriendlyMessage());
            }
            throw error;
        }
    }

    private async getFile(formAction: InsertTextFormAction, context: ActionContext) {
        const filePath = await getFilePathFromAction(formAction, context);
        const file = await createFileFromActionIfNotExists(filePath, formAction, context);
        return file;
    }

    private async insertText(filePath: string, state: FormState, formAction: InsertTextFormAction, context: ActionContext) {
        const app = context.app;
        const insertionService = new ContentInsertionService();

        try {
            // Validate and process content with type checking
            const content = await this.validateAndProcessContent(
                formAction.content,
                state,
                context.app,
                "insert text content"
            );

            // Validate file path
            if (typeof filePath !== 'string' || filePath.trim() === '') {
                throw new FormFieldValidationError(
                    'filePath',
                    'file path',
                    'File path must be a non-empty string',
                    'Ensure file path variables resolve to valid paths'
                );
            }

            const position = formAction.position;

            // Process based on insertion position with validation
            if (position === TextInsertPosition.TOP_OF_CONTENT) {
                await insertionService.insertToTopOfNote(app, filePath, content);
            } else if (position === TextInsertPosition.END_OF_CONTENT) {
                await insertionService.insertToBottomOfNote(app, filePath, content);
            } else if (position === TextInsertPosition.TOP_BELOW_TITLE && formAction.heading) {
                const heading = await this.validateAndProcessContent(
                    formAction.heading,
                    state,
                    context.app,
                    "insert text heading"
                );
                await insertionService.insertToTopBelowTitle(app, filePath, heading, content);
            } else if (position === TextInsertPosition.BOTTOM_BELOW_TITLE && formAction.heading) {
                const heading = await this.validateAndProcessContent(
                    formAction.heading,
                    state,
                    context.app,
                    "insert text heading"
                );
                await insertionService.insertToBottomBelowTitle(app, filePath, heading, content);
            } else if (position === TextInsertPosition.AT_CURSOR && formAction.targetFileType === TargetFileType.CURRENT_FILE) {
                await insertionService.insertToCurrentCursor(app, content);
                return Promise.resolve();
            } else {
                // Default fallback
                await insertionService.insertToBottomOfNote(app, filePath, content);
            }

            // Open file if not current file
            if (formAction.targetFileType !== TargetFileType.CURRENT_FILE) {
                openFilePathDirectly(app, filePath, formAction.openPageIn || OpenPageInType.none);
            }

            return Promise.resolve();
        } catch (error) {
            if (error instanceof FormFieldValidationError || error instanceof TypeConversionError) {
                throw error;
            }
            throw new FormFieldValidationError(
                'insertText',
                'text insertion',
                `Failed to insert text: ${error.message}`,
                'Check content variables and ensure they can be converted to strings'
            );
        }
    }

    /**
     * Validates and processes content with type checking
     * @param content 原始内容
     * @param state 表单状态
     * @param app Obsidian应用实例
     * @param contentType 内容类型描述
     * @returns 处理后的内容
     */
    private async validateAndProcessContent(
        content: string,
        state: FormState,
        app: App,
        contentType: string
    ): Promise<string> {
        try {
            const engine = new FormTemplateProcessEngine();
            const processedContent = await engine.process(content, state, app);

            // Ensure content is a string with validation
            const stringContent = validateAndConvertToString(
                processedContent,
                {
                    fieldName: 'content',
                    actionType: 'insert_text',
                    usage: contentType
                }
            );

            // Log successful conversion in development mode
            if (process.env.NODE_ENV === 'development') {
                logTypeConversion(
                    {
                        fieldName: 'content',
                        actionType: 'insert_text',
                        usage: contentType,
                        location: 'InsertTextActionService.validateAndProcessContent'
                    },
                    content,
                    stringContent,
                    true
                );
            }

            return stringContent;
        } catch (error) {
            if (error instanceof TypeConversionError) {
                throw error;
            }
            throw new FormFieldValidationError(
                'content',
                'text content',
                `Failed to process ${contentType}: ${error.message}`,
                'Check content variables and ensure they can be converted to strings'
            );
        }
    }

    /**
     * Validates form values for type-related issues
     */
    private async validateFormValues(state: FormState, formAction: InsertTextFormAction): Promise<void> {
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
                    "Functions cannot be used in text insertion templates",
                    "Remove function references from form fields"
                );
            }
        }

        // Validate specific fields for insert text action
        if (formAction.content && typeof formAction.content !== 'string') {
            throw new FormFieldValidationError(
                'content',
                'text content',
                'Content must be a string',
                'Ensure content field contains valid text'
            );
        }

        if (formAction.heading && typeof formAction.heading !== 'string') {
            throw new FormFieldValidationError(
                'heading',
                'heading text',
                'Heading must be a string',
                'Ensure heading field contains valid text'
            );
        }
    }

}