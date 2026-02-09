import { normalizePath, TFile } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import { UpdateFrontmatterFormAction } from "src/model/action/UpdateFrontmatterFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { TargetFileType } from "src/model/enums/TargetFileType";
import { FormTemplateProcessEngine } from "src/service/engine/FormTemplateProcessEngine";
import { convertFrontmatterValue, FrontmatterConversionOptions } from "src/utils/convertFrontmatterValue";
import { expandTargetPaths } from "src/utils/expandTargetPaths";
import { IActionService, ActionContext, ActionChain } from "../IActionService";
import { createFileFromActionIfNotExists } from "../util/createFileFromActionIfNotExists";
import { getFilePathFromAction } from "../util/getFilePathFromAction";
import { validateFileName } from "../util/validateFileName";
import { validateAndConvertToString, TypeConversionError, FormFieldValidationError, isValidYamlValue, logTypeConversion } from "src/utils/typeSafety";


export default class UpdateFrontmatterActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.UPDATE_FRONTMATTER;
    }

    async run(action: UpdateFrontmatterFormAction, context: ActionContext, chain: ActionChain): Promise<any> {
        const app = context.app;
        const engine = new FormTemplateProcessEngine();

        try {
            // Validate form values and action configuration before processing
            await this.validateFormValuesAndAction(context.state, action);

            await validateFileName(action, context);

            // Process and validate property updates with type checking
            const formattedProperties = await this.processAndValidateProperties(
                action.propertyUpdates,
                engine,
                context
            );

            // Configure frontmatter conversion options
            const conversionOptions: FrontmatterConversionOptions = {
                strictMode: false, // Allow flexible type conversion for user-friendliness
                logConversions: process.env.NODE_ENV === 'development',
                fallbackValue: null
            };

            if (action.targetFileType === TargetFileType.MULTIPLE_FILES) {
                const files = await this.resolveMultipleTargetFiles(action, context);
                for (const file of files) {
                    await this.updateFrontmatterWithTypeValidation(
                        app,
                        file,
                        formattedProperties,
                        conversionOptions
                    );
                }
            } else {
                const filePath = await this.validateAndProcessFilePath(action, context);
                const file = await createFileFromActionIfNotExists(filePath, action, context);
                await this.updateFrontmatterWithTypeValidation(
                    app,
                    file,
                    formattedProperties,
                    conversionOptions
                );
            }

            if (chain) {
                return await chain.next(context);
            }
        } catch (error) {
            if (error instanceof FormFieldValidationError || error instanceof TypeConversionError) {
                // Show user-friendly error with guidance
                throw new Error(error.getUserFriendlyMessage());
            }
            throw new FormFieldValidationError(
                'frontmatter_update',
                'frontmatter operation',
                `Failed to update frontmatter: ${error.message}`,
                'Check property names, values, and ensure they are compatible with YAML format'
            );
        }
    }

    private async resolveMultipleTargetFiles(
        action: UpdateFrontmatterFormAction,
        context: ActionContext
    ): Promise<TFile[]> {
        const engine = new FormTemplateProcessEngine();
        const processedTargets: string[] = [];

        for (const rawPath of action.targetFiles ?? []) {
            if (!rawPath || rawPath.trim() === "") {
                continue;
            }
            const rendered = await engine.process(rawPath, context.state, context.app);
            if (!rendered || rendered.trim() === "") {
                continue;
            }
            processedTargets.push(normalizePath(rendered));
        }

        const expandedPaths = expandTargetPaths(processedTargets, context.app, {
            mdOnly: true,
        });
        const files: TFile[] = [];

        for (const path of expandedPaths) {
            const target = context.app.vault.getAbstractFileByPath(path);
            if (target instanceof TFile && target.extension === "md") {
                files.push(target);
            }
        }

        if (files.length === 0) {
            throw new Error("No markdown files found for frontmatter update");
        }

        return files;
    }

    /**
     * Validates form values and action configuration
     */
    private async validateFormValuesAndAction(
        state: any,
        action: UpdateFrontmatterFormAction
    ): Promise<void> {
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
                        "Use simpler data types (string, number, boolean) or serializable objects in frontmatter"
                    );
                }
            }

            if (typeof value === 'function') {
                throw new FormFieldValidationError(
                    fieldName,
                    "function",
                    "Functions cannot be used in frontmatter templates",
                    "Remove function references from form fields"
                );
            }
        }

        // Validate action configuration
        if (!action.propertyUpdates || action.propertyUpdates.length === 0) {
            throw new FormFieldValidationError(
                'propertyUpdates',
                'property updates',
                'No property updates specified',
                'Add at least one property update to the action'
            );
        }

        // Validate each property update configuration
        for (const [index, property] of action.propertyUpdates.entries()) {
            if (!property.name || typeof property.name !== 'string') {
                throw new FormFieldValidationError(
                    `propertyUpdates[${index}].name`,
                    'property name',
                    'Property name must be a non-empty string',
                    'Provide a valid property name for each frontmatter update'
                );
            }

            if (property.value === undefined) {
                throw new FormFieldValidationError(
                    `propertyUpdates[${index}].value`,
                    'property value',
                    'Property value cannot be undefined',
                    'Provide a value for each frontmatter property'
                );
            }
        }
    }

    /**
     * Processes and validates property updates with type checking
     */
    private async processAndValidateProperties(
        propertyUpdates: any[],
        engine: FormTemplateProcessEngine,
        context: ActionContext
    ): Promise<Array<{ name: string; value: any }>> {
        const formattedProperties: Array<{ name: string; value: any }> = [];

        for (const [index, property] of propertyUpdates.entries()) {
            try {
                // Process property name
                const propertyName = await this.validateAndProcessPropertyName(
                    property.name,
                    engine,
                    context
                );

                // Process property value
                const propertyValue = await this.validateAndProcessPropertyValue(
                    property.value,
                    engine,
                    context,
                    propertyName
                );

                formattedProperties.push({
                    name: propertyName,
                    value: propertyValue
                });

            } catch (error) {
                if (error instanceof FormFieldValidationError || error instanceof TypeConversionError) {
                    throw error;
                }
                throw new FormFieldValidationError(
                    `propertyUpdates[${index}]`,
                    'property update',
                    `Failed to process property update: ${error.message}`,
                    'Check property name and value variables for valid template syntax'
                );
            }
        }

        return formattedProperties;
    }

    /**
     * Validates and processes property name
     */
    private async validateAndProcessPropertyName(
        propertyName: string,
        engine: FormTemplateProcessEngine,
        context: ActionContext
    ): Promise<string> {
        try {
            const processedName = await engine.process(propertyName, context.state, context.app);

            // Validate property name type and format
            if (typeof processedName !== 'string') {
                throw new TypeConversionError(
                    processedName,
                    'string',
                    typeof processedName,
                    'Property name must resolve to a string',
                    {
                        fieldName: propertyName,
                        actionType: 'update_frontmatter',
                        usage: 'property name resolution'
                    }
                );
            }

            // Check for valid YAML property name format
            const trimmedName = processedName.trim();
            if (trimmedName === '') {
                throw new FormFieldValidationError(
                    propertyName,
                    'property name',
                    'Property name cannot be empty',
                    'Ensure property name template resolves to a non-empty string'
                );
            }

            // Check for invalid characters in property name
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName) && !/^[a-zA-Z][a-zA-Z0-9\s-]*$/.test(trimmedName)) {
                console.warn(`Property name "${trimmedName}" contains unusual characters, ensure this is intentional`);
            }

            return trimmedName;
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                propertyName,
                'property name',
                `Failed to process property name: ${error.message}`,
                'Check property name template syntax and variables'
            );
        }
    }

    /**
     * Validates and processes property value
     */
    private async validateAndProcessPropertyValue(
        propertyValue: any,
        engine: FormTemplateProcessEngine,
        context: ActionContext,
        propertyName: string
    ): Promise<any> {
        try {
            if (Array.isArray(propertyValue)) {
                // Process array values
                const processedArray = [];
                for (const [index, item] of propertyValue.entries()) {
                    // 检测纯变量引用（如 {{@MOC}}），直接使用原始值以保持数组格式
                    const pureVariableMatch = typeof item === 'string' && item.match(/^\{\{@([^}]+)\}\}$/);
                    let processedItem;

                    if (pureVariableMatch) {
                        const rawName = pureVariableMatch[1]?.trim();
                        const originalValue = context.state.values[rawName];
                        // 如果原始值是数组，直接使用；否则正常处理
                        if (Array.isArray(originalValue)) {
                            processedItem = originalValue;
                        } else {
                            processedItem = await engine.process(item, context.state, context.app);
                        }
                    } else {
                        processedItem = await engine.process(item, context.state, context.app);
                    }

                    if (Array.isArray(processedItem)) {
                        processedArray.push(...processedItem);
                    } else {
                        // Validate individual array items
                        if (!this.isValidYamlValue(processedItem)) {
                            throw new TypeConversionError(
                                processedItem,
                                'yaml-compatible',
                                typeof processedItem,
                                `Array item at index ${index} is not YAML compatible`,
                                {
                                    fieldName: `${propertyName}[${index}]`,
                                    actionType: 'update_frontmatter',
                                    usage: 'array item processing'
                                }
                            );
                        }
                        processedArray.push(processedItem);
                    }
                }
                return processedArray;
            } else {
                // Process single value
                const processedValue = await engine.process(propertyValue, context.state, context.app);

                // Validate the processed value for YAML compatibility
                if (!this.isValidYamlValue(processedValue)) {
                    throw new TypeConversionError(
                        processedValue,
                        'yaml-compatible',
                        typeof processedValue,
                        'Property value is not YAML compatible',
                        {
                            fieldName: propertyName,
                            actionType: 'update_frontmatter',
                            usage: 'property value processing'
                        }
                    );
                }

                return processedValue;
            }
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                propertyName,
                'property value',
                `Failed to process property value: ${error.message}`,
                'Check property value template syntax and variables'
            );
        }
    }

    /**
     * Validates if a value is compatible with YAML format
     */
    private isValidYamlValue(value: any): boolean {
        // null and undefined are valid (will be handled appropriately)
        if (value === null || value === undefined) {
            return true;
        }

        // Primitive types are generally valid
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return true;
        }

        // Arrays are valid if all elements are valid
        if (Array.isArray(value)) {
            return value.every(item => this.isValidYamlValue(item));
        }

        // Objects are valid if they can be serialized and don't have circular references
        if (typeof value === 'object') {
            try {
                JSON.stringify(value);
                return true;
            } catch (error) {
                return false;
            }
        }

        // Functions are not valid in YAML
        return false;
    }

    /**
     * Validates and processes file path
     */
    private async validateAndProcessFilePath(
        action: UpdateFrontmatterFormAction,
        context: ActionContext
    ): Promise<string> {
        try {
            const filePath = await getFilePathFromAction(action, context);

            // Validate file path type
            if (typeof filePath !== 'string') {
                throw new TypeConversionError(
                    filePath,
                    'string',
                    typeof filePath,
                    'File path must be a string',
                    {
                        fieldName: 'filePath',
                        actionType: 'update_frontmatter',
                        usage: 'file path resolution'
                    }
                );
            }

            if (filePath.trim() === '') {
                throw new FormFieldValidationError(
                    'filePath',
                    'file path',
                    'File path cannot be empty',
                    'Ensure file path variables resolve to valid paths'
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

    /**
     * Updates frontmatter with comprehensive type validation
     */
    private async updateFrontmatterWithTypeValidation(
        app: any,
        file: any,
        formattedProperties: Array<{ name: string; value: any }>,
        conversionOptions: FrontmatterConversionOptions
    ): Promise<void> {
        try {
            await app.fileManager.processFrontMatter(file, (frontmatter: any) => {
                for (const property of formattedProperties) {
                    try {
                        // Convert property value with enhanced type handling
                        const convertedValue = convertFrontmatterValue(
                            app,
                            property.name,
                            property.value,
                            conversionOptions
                        );

                        // Validate the converted value for YAML compatibility
                        if (!isValidYamlValue(convertedValue, this.getPropertyType(app, property.name))) {
                            console.warn(`Converted value for property "${property.name}" may not be fully YAML compatible:`, convertedValue);
                        }

                        // Update frontmatter
                        frontmatter[property.name] = convertedValue;

                        // Log successful conversion in development mode
                        if (process.env.NODE_ENV === 'development') {
                            logTypeConversion(
                                {
                                    fieldName: property.name,
                                    actionType: 'update_frontmatter',
                                    usage: 'frontmatter property update',
                                    location: 'UpdateFrontmatterActionService.updateFrontmatterWithTypeValidation'
                                },
                                property.value,
                                String(convertedValue),
                                true
                            );
                        }

                    } catch (error) {
                        // Provide detailed error information for each property
                        const enhancedError = new TypeConversionError(
                            property.value,
                            'frontmatter-compatible',
                            typeof property.value,
                            `Failed to convert property "${property.name}": ${error.message}`,
                            {
                                fieldName: property.name,
                                actionType: 'update_frontmatter',
                                usage: 'frontmatter property conversion'
                            }
                        );

                        // In non-strict mode, use original value but log warning
                        if (!conversionOptions.strictMode) {
                            console.warn(`Frontmatter conversion warning for property "${property.name}":`, error.message);
                            frontmatter[property.name] = property.value;
                        } else {
                            throw enhancedError;
                        }
                    }
                }
            });
        } catch (error) {
            throw new FormFieldValidationError(
                'frontmatter_update',
                'frontmatter operation',
                `Failed to update frontmatter: ${error.message}`,
                'Check property values and ensure they are compatible with your Obsidian property types'
            );
        }
    }

    /**
     * Gets the expected property type from Obsidian (helper method)
     */
    private getPropertyType(app: any, propertyName: string): string {
        try {
            // Try to get property type from Obsidian's metadata system
            const propertyTypeManager = (app as any).metadataTypeManager;
            if (propertyTypeManager) {
                const typeInfo = propertyTypeManager.getType(propertyName);
                return typeInfo?.type || 'text';
            }
        } catch (error) {
            // Fall back to default if unable to get type
        }
        return 'text';
    }
}
