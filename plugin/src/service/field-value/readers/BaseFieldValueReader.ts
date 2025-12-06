import { IFormField } from "src/model/field/IFormField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";

/**
 * 基础字段值读取器
 * 为TEXT、TEXTAREA、PASSWORD等简单字段类型提供默认实现
 */
export class BaseFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 对于基础字段，直接返回原始值的字符串形式
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        if (rawValue === undefined || rawValue === null) {
            return "";
        }
        return String(rawValue);
    }

    /**
     * 将任意值规范化为字段期望的类型
     * 对于基础字段，转换为字符串
     */
    normalizeValue(field: IFormField, value: any): any {
        if (value === undefined || value === null) {
            return "";
        }
        return String(value);
    }

    /**
     * 使用字段特定逻辑比较两个值
     * 对于基础字段，使用严格相等比较
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.normalizeValue(field, value1);
        const normalized2 = this.normalizeValue(field, value2);
        return normalized1 === normalized2;
    }

    /**
     * 获取字段的可选值列表
     * 对于基础字段，返回空数组
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        return [];
    }
}
