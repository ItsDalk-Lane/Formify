import { FormFieldType } from "../model/enums/FormFieldType";
import { IFormField } from "../model/field/IFormField";
import { ISelectField } from "../model/field/ISelectField";
import { IPropertyValueField } from "../model/field/IPropertyValueField";
import { DatabaseFieldOutputFormat, IDatabaseField } from "../model/field/IDatabaseField";
import { isTimeFormField } from "./isTimeFormField";
import { DateTime } from "luxon";
import { BaseTimeField, TimeFieldDefaultValueType } from "../model/field/time/BaseTimeField";
import { Strings } from "./Strings";

export const OBSIDIAN_DATETIME_YAML_VALUE_FORMAT = "yyyy-MM-dd'T'HH:mm";

export function getFieldDefaultValue(
    curr: IFormField
): any {
    if (curr.type === FormFieldType.SELECT) {
        const selectField = curr as ISelectField;
        const options = selectField.options || [];
        const enableCustomValue = selectField.enableCustomValue === true;
        const values = options.map(o => {
            if (enableCustomValue) {
                return o.value;
            } else {
                return o.label;
            }
        });

        if (selectField.multiple) {
            const def = Array.isArray(selectField.defaultValue) ? selectField.defaultValue : [];
            return def.filter(v => values.includes(v));
        } else {
            if (selectField.defaultValue && values.includes(selectField.defaultValue)) {
                return selectField.defaultValue;
            }
            return undefined;
        }
    }

    if (isTimeFormField(curr.type)) {
        const field = curr as BaseTimeField;
        if (field.defaultValueType === TimeFieldDefaultValueType.CURRENT) {
            switch (field.type) {
                case FormFieldType.DATE:
                    return DateTime.now().toISODate();
                case FormFieldType.TIME:
                    return DateTime.now().toFormat("HH:mm:ss");
                case FormFieldType.DATETIME:
                    return DateTime.now().toFormat(OBSIDIAN_DATETIME_YAML_VALUE_FORMAT);
            }
        } else {
            return field.defaultValue;
        }
    }

    if (curr.type === FormFieldType.CHECKBOX || curr.type === FormFieldType.TOGGLE) {
        if (Strings.isEmpty(curr.defaultValue)) {
            return false;
        }
        return curr.defaultValue ?? false;
    }

    if (curr.type === FormFieldType.FILE_LIST) {
        const defaultValue = curr.defaultValue;
        if (Array.isArray(defaultValue)) {
            return defaultValue;
        }
        return defaultValue ? [defaultValue] : [];
    }

    if (curr.type === FormFieldType.FOLDER_PATH) {
        return curr.defaultValue || "";
    }

    if (curr.type === FormFieldType.DATABASE) {
        const databaseField = curr as IDatabaseField;
        if (databaseField.outputFormat === DatabaseFieldOutputFormat.STRING) {
            return "";
        }
        return [];
    }

    // 属性值列表字段：根据 multiple 属性处理默认值格式
    if (curr.type === FormFieldType.PROPERTY_VALUE_SUGGESTION) {
        const propertyField = curr as IPropertyValueField;
        const defaultValue = curr.defaultValue;

        if (propertyField.multiple) {
            // 多选模式：确保返回数组格式
            if (Array.isArray(defaultValue)) {
                return defaultValue;
            }
            // 如果是逗号分隔的字符串，分割成数组
            if (typeof defaultValue === 'string' && defaultValue.includes('，')) {
                return defaultValue.split('，').map(v => v.trim()).filter(v => v.length > 0);
            }
            if (typeof defaultValue === 'string' && defaultValue.includes(',')) {
                return defaultValue.split(',').map(v => v.trim()).filter(v => v.length > 0);
            }
            // 单个值转为单元素数组
            return defaultValue ? [defaultValue] : [];
        } else {
            // 单选模式：返回字符串或 undefined
            if (Array.isArray(defaultValue)) {
                return defaultValue[0];
            }
            return defaultValue || undefined;
        }
    }

    return curr.defaultValue;
}
