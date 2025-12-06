import { IFormField } from "src/model/field/IFormField";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { FieldOption, FieldValueReader } from "../FieldValueReader";
import { DateTime } from "luxon";

/**
 * DATE/TIME/DATETIME字段值读取器
 * 统一时间格式，支持时间戳比较
 */
export class TimeFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 返回标准化的时间字符串
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        return this.normalizeValue(field, rawValue);
    }

    /**
     * 将任意值规范化为标准时间格式
     */
    normalizeValue(field: IFormField, value: any): any {
        if (value === undefined || value === null) {
            return null;
        }

        // 已经是标准格式的字符串
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') {
                return null;
            }

            // 尝试解析时间字符串
            try {
                const dt = DateTime.fromISO(trimmed);
                if (dt.isValid) {
                    return this.formatDateTime(field, dt);
                }

                // 尝试其他格式
                const dt2 = DateTime.fromSQL(trimmed);
                if (dt2.isValid) {
                    return this.formatDateTime(field, dt2);
                }

                // 尝试作为时间戳
                const timestamp = parseInt(trimmed);
                if (!isNaN(timestamp)) {
                    const dt3 = DateTime.fromMillis(timestamp);
                    if (dt3.isValid) {
                        return this.formatDateTime(field, dt3);
                    }
                }
            } catch (e) {
                return null;
            }

            // 无法解析，返回原值
            return trimmed;
        }

        // 数字类型（时间戳）
        if (typeof value === 'number') {
            const dt = DateTime.fromMillis(value);
            if (dt.isValid) {
                return this.formatDateTime(field, dt);
            }
            return null;
        }

        // Date对象
        if (value instanceof Date) {
            const dt = DateTime.fromJSDate(value);
            if (dt.isValid) {
                return this.formatDateTime(field, dt);
            }
            return null;
        }

        return null;
    }

    /**
     * 使用时间戳比较
     * 确保两边都转换为时间戳后再比较
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const timestamp1 = this.toTimestamp(field, value1);
        const timestamp2 = this.toTimestamp(field, value2);

        // 都是null，视为相等
        if (timestamp1 === null && timestamp2 === null) {
            return true;
        }

        // 一个是null，一个不是，视为不相等
        if (timestamp1 === null || timestamp2 === null) {
            return false;
        }

        // 时间戳比较
        return timestamp1 === timestamp2;
    }

    /**
     * 获取字段的可选值列表
     * TIME字段没有预定义的选项
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        return [];
    }

    /**
     * 根据字段类型格式化时间
     */
    private formatDateTime(field: IFormField, dt: DateTime): string {
        switch (field.type) {
            case FormFieldType.DATE:
                return dt.toISODate() || "";
            case FormFieldType.TIME:
                return dt.toFormat("HH:mm:ss");
            case FormFieldType.DATETIME:
                return dt.toISO() || "";
            default:
                return dt.toISO() || "";
        }
    }

    /**
     * 将值转换为时间戳（用于比较）
     */
    private toTimestamp(field: IFormField, value: any): number | null {
        const normalized = this.normalizeValue(field, value);
        if (normalized === null) {
            return null;
        }

        try {
            const dt = DateTime.fromISO(String(normalized));
            if (dt.isValid) {
                return dt.toMillis();
            }
        } catch (e) {
            // 解析失败
        }

        return null;
    }
}
