import { IFormField } from "src/model/field/IFormField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";

/**
 * CHECKBOX和TOGGLE字段值读取器
 * 统一返回布尔类型，支持多种布尔值表示形式转换
 */
export class BooleanFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 统一返回布尔类型
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        return this.normalizeValue(field, rawValue);
    }

    /**
     * 将任意值规范化为布尔类型
     * 支持多种布尔值表示形式
     */
    normalizeValue(field: IFormField, value: any): any {
        // null或undefined返回false
        if (value === undefined || value === null) {
            return false;
        }

        // 已经是布尔类型
        if (typeof value === 'boolean') {
            return value;
        }

        // 字符串类型
        if (typeof value === 'string') {
            const lowercased = value.toLowerCase().trim();
            if (lowercased === 'true' || lowercased === '1' || lowercased === 'yes') {
                return true;
            }
            if (lowercased === 'false' || lowercased === '0' || lowercased === 'no' || lowercased === '') {
                return false;
            }
            // 其他非空字符串视为true
            return true;
        }

        // 数字类型
        if (typeof value === 'number') {
            return value !== 0;
        }

        // 其他类型使用JavaScript的真值判断
        return Boolean(value);
    }

    /**
     * 使用布尔值比较
     * 确保两边都转换为布尔值后再比较
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.normalizeValue(field, value1);
        const normalized2 = this.normalizeValue(field, value2);
        return normalized1 === normalized2;
    }

    /**
     * 获取字段的可选值列表
     * 布尔字段返回true/false选项
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        return [
            {
                id: 'true',
                label: 'True',
                value: true
            },
            {
                id: 'false',
                label: 'False',
                value: false
            }
        ];
    }
}
