import { App, TFile, normalizePath, Notice } from "obsidian";
import { localInstance } from "src/i18n/locals";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { processObTemplate } from "./templates";
import { generateUniqueFilePath } from "./generateUniqueFilePath";
import { convertVariableToString, logTypeConversion, TypeConversionError } from "./typeSafety";

export interface CreateFileOptions {
    enableAutoTypeConversion?: boolean;
    strictTypeChecking?: boolean;
    logTypeConversions?: boolean;
    onTypeConversionWarning?: (warning: TypeConversionWarning) => void;
}

export interface TypeConversionWarning {
    fieldName?: string;
    originalType: string;
    originalValue: any;
    convertedValue: string;
    location: string;
    timestamp: string;
}

export async function createFileByText(
    app: App,
    newFilePath: string,
    template: string,
    conflictResolution: FileConflictResolution = FileConflictResolution.SKIP,
    options: CreateFileOptions = {}
): Promise<TFile> {
    const {
        enableAutoTypeConversion = true,
        strictTypeChecking = false,
        logTypeConversions = false,
        onTypeConversionWarning
    } = options;

    // Validate and convert file path
    const validatedFilePath = await validateAndConvertFilePath(newFilePath, options);

    // Validate and convert template content
    const validatedTemplate = await validateAndConvertTemplate(template, options);

    return await createFileWithValidatedContent(
        app,
        validatedFilePath,
        validatedTemplate,
        conflictResolution,
        options
    );
}

/**
 * Validates and converts file path to ensure it's a string
 */
async function validateAndConvertFilePath(
    filePath: any,
    options: CreateFileOptions
): Promise<string> {
    const { enableAutoTypeConversion, strictTypeChecking, logTypeConversions } = options;

    if (typeof filePath === 'string') {
        return filePath;
    }

    const originalType = typeof filePath;
    const originalValue = filePath;
    let convertedValue: string;

    try {
        if (enableAutoTypeConversion) {
            convertedValue = convertVariableToString(filePath);

            const warning: TypeConversionWarning = {
                originalType,
                originalValue,
                convertedValue,
                location: 'createFileByText - filePath validation',
                timestamp: new Date().toISOString()
            };

            if (logTypeConversions) {
                logTypeConversion(
                    {
                        fieldName: 'filePath',
                        usage: 'file path creation',
                        location: 'createFileByText'
                    },
                    originalValue,
                    convertedValue,
                    true
                );
            }

            console.warn(`File path type conversion: ${originalType} "${originalValue}" → string "${convertedValue}"`, warning);

            return convertedValue;
        } else {
            throw new TypeConversionError(
                originalValue,
                'string',
                originalType,
                `File path must be a string, got ${originalType}`,
                {
                    fieldName: 'filePath',
                    actionType: 'create_file',
                    usage: 'file path creation'
                }
            );
        }
    } catch (error) {
        if (strictTypeChecking) {
            throw error;
        }

        // Fallback to string conversion in non-strict mode
        convertedValue = String(filePath);
        console.warn(`File path type conversion fallback: ${originalType} → string`, {
            originalValue,
            convertedValue,
            error: error.message
        });

        return convertedValue;
    }
}

/**
 * Validates and converts template content to ensure it's a string
 */
async function validateAndConvertTemplate(
    template: any,
    options: CreateFileOptions
): Promise<string> {
    const { enableAutoTypeConversion, strictTypeChecking, logTypeConversions } = options;

    if (typeof template === 'string') {
        return template;
    }

    const originalType = typeof template;
    const originalValue = template;
    let convertedValue: string;

    try {
        if (enableAutoTypeConversion) {
            convertedValue = convertVariableToString(template);

            const warning: TypeConversionWarning = {
                originalType,
                originalValue,
                convertedValue,
                location: 'createFileByText - template validation',
                timestamp: new Date().toISOString()
            };

            if (logTypeConversions) {
                logTypeConversion(
                    {
                        fieldName: 'template',
                        usage: 'file content creation',
                        location: 'createFileByText'
                    },
                    originalValue,
                    convertedValue,
                    true
                );
            }

            console.warn(`Template content type conversion: ${originalType} → string`, warning);

            return convertedValue;
        } else {
            throw new TypeConversionError(
                originalValue,
                'string',
                originalType,
                `Template content must be a string, got ${originalType}`,
                {
                    fieldName: 'template',
                    actionType: 'create_file',
                    usage: 'file content creation'
                }
            );
        }
    } catch (error) {
        if (strictTypeChecking) {
            throw error;
        }

        // Fallback conversion strategies based on type
        if (originalValue === null || originalValue === undefined) {
            convertedValue = '';
        } else if (typeof originalValue === 'object') {
            try {
                convertedValue = JSON.stringify(originalValue, null, 2);
            } catch (jsonError) {
                convertedValue = String(originalValue);
            }
        } else {
            convertedValue = String(originalValue);
        }

        console.warn(`Template content type conversion fallback: ${originalType} → string`, {
            originalValue,
            convertedValue,
            error: error.message
        });

        return convertedValue;
    }
}

/**
 * Creates file with validated string content
 */
async function createFileWithValidatedContent(
    app: App,
    newFilePath: string,
    template: string,
    conflictResolution: FileConflictResolution,
    options: CreateFileOptions
): Promise<TFile> {
    const parent = newFilePath.substring(0, newFilePath.lastIndexOf("/"));
    const isExists = await app.vault.exists(parent);
    if (!isExists) {
        await app.vault.createFolder(parent);
    }

    const normalizedNewFilePath = normalizePath(newFilePath);
    const existingFile = app.vault.getAbstractFileByPath(normalizedNewFilePath);

    if (existingFile != null) {
        switch (conflictResolution) {
            case FileConflictResolution.SKIP:
                return Promise.resolve(existingFile as TFile);

            case FileConflictResolution.AUTO_RENAME:
                const uniquePath = generateUniqueFilePath(app, normalizedNewFilePath);
                const processedTemplate = processObTemplate(template);
                return await app.vault.create(uniquePath, processedTemplate);

            case FileConflictResolution.OVERWRITE:
                if (existingFile instanceof TFile) {
                    const processedTemplate = processObTemplate(template);
                    await app.vault.modify(existingFile, processedTemplate);
                    return existingFile;
                } else {
                    throw new Error(`Cannot overwrite non-file: ${newFilePath}`);
                }

            default:
                throw new Error(`Unknown conflict resolution strategy: ${conflictResolution}`);
        }
    }

    const processedTemplate = processObTemplate(template);
    return await app.vault.create(normalizedNewFilePath, processedTemplate);
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createFileByText with options parameter instead
 */
export async function createFileByTextLegacy(
    app: App,
    newFilePath: string,
    template: string,
    conflictResolution: FileConflictResolution = FileConflictResolution.SKIP
): Promise<TFile> {
    return createFileByText(app, newFilePath, template, conflictResolution, {
        enableAutoTypeConversion: true,
        strictTypeChecking: false,
        logTypeConversions: false
    });
}