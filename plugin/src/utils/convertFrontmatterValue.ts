import { App } from "obsidian";
import getPropertyTypeByName from "./getPropertyTypeByName";
import { isValidYamlValue, TypeConversionError, logTypeConversion } from "./typeSafety";
import { localInstance } from "src/i18n/locals";

export interface FrontmatterConversionOptions {
    strictMode?: boolean;
    logConversions?: boolean;
    fallbackValue?: any;
}

export function convertFrontmatterValue(
    app: App,
    name: string,
    value: any,
    options: FrontmatterConversionOptions = {}
): any {
    const { strictMode = false, logConversions = false, fallbackValue = null } = options;

    const targetType = getPropertyTypeByName(app, name);
    const originalType = typeof value;

    try {
        let convertedValue: any;
        const conversionContext = {
            fieldName: name,
            actionType: 'frontmatter_update',
            usage: `property value conversion to ${targetType}`
        };

        switch (targetType) {
            case "checkbox":
                convertedValue = convertToCheckbox(value, strictMode);
                break;

            case "number":
                convertedValue = convertToNumber(value, strictMode);
                break;

            case "date":
                convertedValue = convertToDate(value, strictMode);
                break;

            case "datetime":
                convertedValue = convertToDateTime(value, strictMode);
                break;

            case "tags":
                convertedValue = convertToTags(value, strictMode);
                break;

            case "multitext":
                convertedValue = convertToMultitext(value, strictMode);
                break;

            case "text":
            default:
                convertedValue = convertToText(value, strictMode);
                break;
        }

        // Validate the converted value
        if (!isValidYamlValue(convertedValue, targetType)) {
            throw new Error(`Converted value is not valid for YAML property type '${targetType}'`);
        }

        // Log successful conversion if enabled
        if (logConversions) {
            logTypeConversion(conversionContext, value, String(convertedValue), true);
        }

        return convertedValue;

    } catch (error) {
        const errorMessage = `Failed to convert frontmatter property '${name}' from ${originalType} to ${targetType}: ${error.message}`;

        // Log failed conversion
        if (logConversions) {
            logTypeConversion({
                fieldName: name,
                actionType: 'frontmatter_update',
                usage: `property value conversion to ${targetType}`,
                location: 'convertFrontmatterValue'
            }, value, String(value), false);
        }

        // In strict mode, throw a detailed error
        if (strictMode) {
            throw new TypeConversionError(
                value,
                targetType,
                originalType,
                errorMessage,
                {
                    fieldName: name,
                    actionType: 'frontmatter_update',
                    usage: `property value conversion to ${targetType}`
                }
            );
        }

        // In non-strict mode, log warning and return fallback or original value
        console.warn(errorMessage, {
            propertyName: name,
            originalValue: value,
            targetType,
            error: error.message
        });

        return fallbackValue !== null ? fallbackValue : value;
    }
}

/**
 * Converts value to boolean for checkbox properties
 */
function convertToCheckbox(value: any, strictMode: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const lowerValue = value.toLowerCase().trim();
        if (['true', 'yes', '1', 'on', 'checked'].includes(lowerValue)) {
            return true;
        }
        if (['false', 'no', '0', 'off', 'unchecked'].includes(lowerValue)) {
            return false;
        }
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (strictMode) {
        throw new Error(`Cannot convert '${value}' (${typeof value}) to boolean. Expected boolean, true/false string, or 0/1 number.`);
    }

    return Boolean(value);
}

/**
 * Converts value to number for number properties
 */
function convertToNumber(value: any, strictMode: boolean): number {
    if (typeof value === 'number') {
        if (isNaN(value)) {
            throw new Error('Value is NaN');
        }
        if (!isFinite(value)) {
            throw new Error('Value is not finite');
        }
        return value;
    }

    if (typeof value === 'string') {
        const trimmedValue = value.trim();
        if (trimmedValue === '') {
            if (strictMode) {
                throw new Error('Empty string cannot be converted to number');
            }
            return 0;
        }

        const numValue = Number(trimmedValue);
        if (isNaN(numValue)) {
            throw new Error(`String '${value}' cannot be converted to number`);
        }
        return numValue;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (strictMode) {
        throw new Error(`Cannot convert '${value}' (${typeof value}) to number`);
    }

    const numValue = Number(value);
    if (isNaN(numValue)) {
        throw new Error(`Cannot convert '${value}' to number`);
    }
    return numValue;
}

/**
 * Converts value to Date for date properties
 */
function convertToDate(value: any, strictMode: boolean): Date {
    if (value instanceof Date) {
        if (isNaN(value.getTime())) {
            throw new Error('Invalid Date object');
        }
        return value;
    }

    if (typeof value === 'string') {
        const dateValue = new Date(value);
        if (isNaN(dateValue.getTime())) {
            throw new Error(`String '${value}' cannot be converted to Date`);
        }
        return dateValue;
    }

    if (typeof value === 'number') {
        const dateValue = new Date(value);
        if (isNaN(dateValue.getTime())) {
            throw new Error(`Number ${value} cannot be converted to Date`);
        }
        return dateValue;
    }

    if (strictMode) {
        throw new Error(`Cannot convert '${value}' (${typeof value}) to Date`);
    }

    const dateValue = new Date(value);
    if (isNaN(dateValue.getTime())) {
        throw new Error(`Cannot convert '${value}' to Date`);
    }
    return dateValue;
}

/**
 * Converts value to Date string for datetime properties
 */
function convertToDateTime(value: any, strictMode: boolean): string {
    const dateValue = convertToDate(value, strictMode);
    return dateValue.toISOString();
}

/**
 * Converts value to array for tags properties
 */
function convertToTags(value: any, strictMode: boolean): string[] {
    if (Array.isArray(value)) {
        return value.map(item => String(item)).filter(tag => tag.trim() !== '');
    }

    if (typeof value === 'string') {
        // Split by common delimiters and clean up
        return value.split(/[,;\s|]+/)
                   .map(tag => tag.trim())
                   .filter(tag => tag !== '');
    }

    if (strictMode) {
        throw new Error(`Cannot convert '${value}' (${typeof value}) to tags array`);
    }

    return [String(value)].filter(tag => tag.trim() !== '');
}

/**
 * Converts value to array for multitext properties
 */
function convertToMultitext(value: any, strictMode: boolean): string[] {
    if (Array.isArray(value)) {
        return value.map(item => String(item));
    }

    if (typeof value === 'string') {
        // Split by newlines for multiline text
        return value.split('\n').map(line => line);
    }

    if (strictMode) {
        throw new Error(`Cannot convert '${value}' (${typeof value}) to multitext array`);
    }

    return [String(value)];
}

/**
 * Converts value to text (string) for text properties
 */
function convertToText(value: any, strictMode: boolean): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            if (strictMode) {
                throw new Error(`Object cannot be converted to string: ${error.message}`);
            }
            return String(value);
        }
    }

    return String(value);
}

/**
 * Batch convert multiple frontmatter values
 */
export function convertFrontmatterValues(
    app: App,
    values: Record<string, any>,
    options: FrontmatterConversionOptions = {}
): Record<string, any> {
    const convertedValues: Record<string, any> = {};
    const errors: TypeConversionError[] = [];

    for (const [name, value] of Object.entries(values)) {
        try {
            convertedValues[name] = convertFrontmatterValue(app, name, value, options);
        } catch (error) {
            if (error instanceof TypeConversionError) {
                errors.push(error);
            } else {
                errors.push(new TypeConversionError(
                    value,
                    'unknown',
                    typeof value,
                    `Unexpected error converting property '${name}': ${error.message}`,
                    {
                        fieldName: name,
                        actionType: 'frontmatter_batch_update'
                    }
                ));
            }

            // In non-strict mode, use original value
            if (!options.strictMode) {
                convertedValues[name] = value;
            }
        }
    }

    if (errors.length > 0 && options.strictMode) {
        throw new Error(`Multiple frontmatter conversion errors: ${errors.map(e => e.message).join('; ')}`);
    }

    return convertedValues;
}