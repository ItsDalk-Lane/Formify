import { IFormField } from "src/model/field/IFormField";
import { ISelectField, IOptionsField } from "src/model/field/ISelectField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";
import { Strings } from "src/utils/Strings";

/**
 * SELECT和RADIO字段值读取器
 * 处理enableCustomValue配置，确保值类型一致性
 */
export class SelectFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 根据enableCustomValue配置返回value或label
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        const optionsField = field as IOptionsField;
        const enableCustomValue = optionsField.enableCustomValue === true;
        
        if (rawValue === undefined || rawValue === null) {
            return this.getDefaultValue(field);
        }

        // 如果是数组（多选）
        if (Array.isArray(rawValue)) {
            return rawValue.map(v => this.normalizeValue(field, v));
        }

        return this.normalizeValue(field, rawValue);
    }

    /**
     * 将任意值规范化为字段期望的类型
     */
    normalizeValue(field: IFormField, value: any): any {
        if (value === undefined || value === null) {
            return "";
        }

        const optionsField = field as IOptionsField;
        const enableCustomValue = optionsField.enableCustomValue === true;
        const options = optionsField.options || [];

        // 尝试在选项中查找匹配的值
        const matchedOption = options.find(opt => 
            opt.value === value || opt.label === value || opt.id === value
        );

        if (matchedOption) {
            // 根据enableCustomValue返回对应的值
            return enableCustomValue 
                ? (Strings.isNotEmpty(matchedOption.value) ? matchedOption.value : matchedOption.label)
                : matchedOption.label;
        }

        // 如果没有匹配到选项，直接返回值
        return String(value);
    }

    /**
     * 使用字段特定逻辑比较两个值
     * 支持数组比较（多选）
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.getFieldValue(field, value1);
        const normalized2 = this.getFieldValue(field, value2);

        // 都是数组
        if (Array.isArray(normalized1) && Array.isArray(normalized2)) {
            if (normalized1.length !== normalized2.length) {
                return false;
            }
            // 检查数组元素是否完全相同（不考虑顺序）
            return normalized1.every(v => normalized2.includes(v)) &&
                   normalized2.every(v => normalized1.includes(v));
        }

        // 一个是数组，一个不是
        if (Array.isArray(normalized1) || Array.isArray(normalized2)) {
            return false;
        }

        // 都不是数组，直接比较
        return normalized1 === normalized2;
    }

    /**
     * 获取字段的可选值列表
     * 返回的选项值类型与enableCustomValue一致
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        const optionsField = field as IOptionsField;
        const enableCustomValue = optionsField.enableCustomValue === true;
        const options = optionsField.options || [];

        return options.map(opt => ({
            id: opt.id,
            label: opt.label,
            value: enableCustomValue 
                ? (Strings.isNotEmpty(opt.value) ? opt.value : opt.label)
                : opt.label
        }));
    }

    /**
     * 获取字段的默认值
     */
    private getDefaultValue(field: IFormField): any {
        const selectField = field as ISelectField;
        if (selectField.multiple) {
            return [];
        }
        return "";
    }
}
