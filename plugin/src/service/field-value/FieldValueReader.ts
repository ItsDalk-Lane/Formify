import { IFormField } from "src/model/field/IFormField";

/**
 * 字段选项接口
 */
export interface FieldOption {
    id: string;
    label: string;
    value: any;
}

/**
 * 字段值读取器接口
 * 提供统一的字段值规范化、比较和选项获取功能
 */
export interface FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * @param field 字段定义
     * @param rawValue 原始值
     * @returns 规范化后的值
     */
    getFieldValue(field: IFormField, rawValue: any): any;

    /**
     * 将任意值规范化为字段期望的类型
     * @param field 字段定义
     * @param value 待规范化的值
     * @returns 规范化后的值
     */
    normalizeValue(field: IFormField, value: any): any;

    /**
     * 使用字段特定逻辑比较两个值是否相等
     * @param field 字段定义
     * @param value1 第一个值
     * @param value2 第二个值
     * @returns 是否相等
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean;

    /**
     * 获取字段的可选值列表（用于条件设置界面）
     * @param field 字段定义
     * @returns 选项数组
     */
    getFieldOptions(field: IFormField): FieldOption[];
}
