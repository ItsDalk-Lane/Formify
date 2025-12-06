import { IFormField } from "src/model/field/IFormField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";

/**
 * NUMBER字段值读取器
 * 确保数值类型的一致性，处理字符串到数字的转换
 */
export class NumberFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 将字符串转换为数字类型
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        return this.normalizeValue(field, rawValue);
    }

    /**
     * 将任意值规范化为数字类型
     * 处理空值、NaN、Infinity等边界情况
     */
    normalizeValue(field: IFormField, value: any): any {
        // null或undefined返回null
        if (value === undefined || value === null) {
            return null;
        }

        // 已经是数字类型
        if (typeof value === 'number') {
            // 检查NaN和Infinity
            if (isNaN(value) || !isFinite(value)) {
                return null;
            }
            return value;
        }

        // 字符串类型转换
        if (typeof value === 'string') {
            // 空字符串视为null
            if (value.trim() === '') {
                return null;
            }

            const parsed = parseFloat(value);
            
            // 转换失败返回null
            if (isNaN(parsed) || !isFinite(parsed)) {
                return null;
            }

            return parsed;
        }

        // 布尔值转换为0或1
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }

        // 其他类型尝试转换
        const parsed = Number(value);
        if (isNaN(parsed) || !isFinite(parsed)) {
            return null;
        }

        return parsed;
    }

    /**
     * 使用数值比较逻辑
     * 确保两边都转换为数字后再比较
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.normalizeValue(field, value1);
        const normalized2 = this.normalizeValue(field, value2);

        // 都是null，视为相等
        if (normalized1 === null && normalized2 === null) {
            return true;
        }

        // 一个是null，一个不是，视为不相等
        if (normalized1 === null || normalized2 === null) {
            return false;
        }

        // 数值比较
        return normalized1 === normalized2;
    }

    /**
     * 获取字段的可选值列表
     * NUMBER字段没有预定义的选项
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        return [];
    }
}
