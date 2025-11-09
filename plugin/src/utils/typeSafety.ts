/**
 * Type safety utilities for form processing
 * Provides consistent type conversion and validation across the application
 */

import { localInstance } from "src/i18n/locals";

/**
 * Converts any value to string with consistent behavior
 * Follows JavaScript String() conversion rules
 */
export function convertVariableToString(value: any): string {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
}

/**
 * Validates and converts a value to string with context information
 * Throws detailed error if conversion fails or produces unexpected results
 */
export function validateAndConvertToString(
    value: any,
    context: {
        fieldName?: string;
        actionType?: string;
        usage?: string;
    }
): string {
    if (value === undefined || value === null) {
        return "";
    }

    try {
        const result = String(value);

        // Check for NaN result from number conversion
        if (typeof value === 'number' && result === 'NaN') {
            throw new TypeConversionError(
                value,
                'string',
                'NaN',
                `Failed to convert number ${value} to string`,
                context
            );
        }

        return result;
    } catch (error) {
        throw new TypeConversionError(
            value,
            'string',
            typeof value,
            `Type conversion failed: ${error.message}`,
            context
        );
    }
}

/**
 * Validates if a value is suitable for YAML frontmatter
 * Checks for types that can cause YAML parsing issues
 */
export function isValidYamlValue(value: any, expectedType?: string): boolean {
    // Check for undefined/null
    if (value === undefined || value === null) {
        return expectedType === 'text' || expectedType === undefined;
    }

    // Handle different expected types
    switch (expectedType) {
        case 'checkbox':
            return typeof value === 'boolean' ||
                   value === 'true' || value === 'false' ||
                   value === true || value === false;

        case 'number':
            return !isNaN(Number(value)) && isFinite(Number(value));

        case 'date':
        case 'datetime':
            // Date strings should be parseable
            const date = new Date(value);
            return !isNaN(date.getTime());

        case 'tags':
        case 'multitext':
            // Arrays or comma-separated strings
            return Array.isArray(value) || typeof value === 'string';

        case 'text':
        default:
            // Most types can be represented as text
            return typeof value === 'string' ||
                   typeof value === 'number' ||
                   typeof value === 'boolean';
    }
}

/**
 * Creates a standardized type conversion error with context
 */
export class TypeConversionError extends Error {
    constructor(
        public originalValue: any,
        public expectedType: string,
        public actualType: string,
        message: string,
        public context: {
            fieldName?: string;
            actionType?: string;
            usage?: string;
        }
    ) {
        super(message);
        this.name = 'TypeConversionError';
    }

    /**
     * Generates a user-friendly error message with configuration guidance
     */
    getUserFriendlyMessage(): string {
        const { fieldName, actionType, usage } = this.context;

        let message = 'Type Conversion Error';

        if (fieldName) {
            message += `\nField: ${fieldName}`;
        }

        message += `\nExpected ${this.expectedType}, got ${this.actualType} (value: ${JSON.stringify(this.originalValue)})`;

        if (actionType && usage) {
            message += `\nUsed in ${actionType} for ${usage}`;
        }

        // Add suggestions based on the conversion issue
        message += `\n\nSuggestions:`;

        if (this.actualType === 'number' && this.expectedType === 'string') {
            message += `\n• Numbers will be automatically converted to strings in templates`;
        } else if (this.actualType === 'boolean' && this.expectedType === 'string') {
            message += `\n• Booleans will be automatically converted to "true" or "false"`;
        } else if (this.expectedType === 'number' && this.actualType === 'string') {
            message += `\n• Ensure field contains only numeric characters`;
        }

        return message;
    }
}

/**
 * Form field validation error with configuration guidance
 */
export class FormFieldValidationError extends Error {
    constructor(
        public fieldName: string,
        public fieldType: string,
        public issue: string,
        public suggestion: string
    ) {
        super(`Validation error for field '${fieldName}': ${issue}`);
        this.name = 'FormFieldValidationError';
    }

    /**
     * Generates a user-friendly error message with configuration guidance
     */
    getUserFriendlyMessage(): string {
        return `Field "${this.fieldName}" (${this.fieldType}): ${this.issue}\n\nSuggestion: ${this.suggestion}`;
    }
}

/**
 * Logs type conversion details for debugging and monitoring
 */
export function logTypeConversion(
    context: {
        fieldName?: string;
        actionType?: string;
        usage?: string;
        location?: string;
    },
    originalValue: any,
    convertedValue: string,
    success: boolean = true
): void {
    if (process.env.NODE_ENV === 'development') {
        console.group(`Type Conversion ${success ? '✅' : '❌'}`);
        console.log('Context:', context);
        console.log('Original Value:', originalValue, `(${typeof originalValue})`);
        console.log('Converted Value:', convertedValue, `(${typeof convertedValue})`);
        console.log('Timestamp:', new Date().toISOString());
        console.groupEnd();
    }
}

/**
 * Validates form values before processing
 * Checks for common type-related issues
 */
export function validateFormValues(
    values: Record<string, any>,
    context: { actionType?: string } = {}
): TypeConversionError[] {
    const errors: TypeConversionError[] = [];

    for (const [fieldName, value] of Object.entries(values)) {
        // Check for problematic object types that can't be stringified properly
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            try {
                JSON.stringify(value);
            } catch (error) {
                errors.push(new TypeConversionError(
                    value,
                    'string',
                    'object',
                    `Object contains circular references or non-serializable data`,
                    { fieldName, ...context }
                ));
            }
        }

        // Check for functions (shouldn't happen but good to catch)
        if (typeof value === 'function') {
            errors.push(new TypeConversionError(
                value,
                'string',
                'function',
                'Functions cannot be converted to string',
                { fieldName, ...context }
            ));
        }
    }

    return errors;
}