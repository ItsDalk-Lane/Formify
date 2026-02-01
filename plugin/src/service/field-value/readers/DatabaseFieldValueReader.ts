import { IFormField } from "src/model/field/IFormField";
import { DatabaseFieldOutputFormat, IDatabaseField } from "src/model/field/IDatabaseField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";

/**
 * DATABASE字段值读取器
 * 确保输出格式与配置一致（数组或字符串）
 */
export class DatabaseFieldValueReader implements FieldValueReader {
    getFieldValue(field: IFormField, rawValue: any): any {
        return this.normalizeValue(field, rawValue);
    }

    normalizeValue(field: IFormField, value: any): any {
        const databaseField = field as IDatabaseField;
        const outputFormat = databaseField.outputFormat === DatabaseFieldOutputFormat.STRING
            ? DatabaseFieldOutputFormat.STRING
            : DatabaseFieldOutputFormat.ARRAY;

        if (outputFormat === DatabaseFieldOutputFormat.STRING) {
            if (value === undefined || value === null) {
                return "";
            }
            if (Array.isArray(value)) {
                return value.map((item) => String(item ?? "")).join("\n");
            }
            return String(value);
        }

        if (value === undefined || value === null) {
            return [];
        }
        if (Array.isArray(value)) {
            return value;
        }
        return [value];
    }

    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.normalizeValue(field, value1);
        const normalized2 = this.normalizeValue(field, value2);

        if (Array.isArray(normalized1) && Array.isArray(normalized2)) {
            if (normalized1.length !== normalized2.length) {
                return false;
            }
            return normalized1.every(v => normalized2.includes(v)) &&
                   normalized2.every(v => normalized1.includes(v));
        }

        if (Array.isArray(normalized1) || Array.isArray(normalized2)) {
            return false;
        }

        return normalized1 === normalized2;
    }

    getFieldOptions(field: IFormField): FieldOption[] {
        return [];
    }
}
