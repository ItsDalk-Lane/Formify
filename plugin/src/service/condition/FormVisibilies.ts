
import { IFormField } from "src/model/field/IFormField";
import { getFieldDefaultValue } from "src/utils/getFieldDefaultValue";
import { FilterService } from "../filter/FilterService";
import { FormIdValues, FormLabelValues } from "../FormValues";

export class FormVisibilies {

    static visibleFields(fields: IFormField[], values: FormIdValues) {
        const visibleFields: IFormField[] = [];
        const visibleFormIdValues: FormIdValues = {};

        const isVisible = (id: string) => visibleFields.some(f => f.id === id);
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            let isMatch;
            if (!field.condition) {
                isMatch = true;
            } else {
                isMatch = FilterService.match(field.condition,
                    (property) => {
                        if (!property) {
                            return undefined;
                        }
                        if (!isVisible(property)) {
                            return undefined;
                        }
                        return visibleFormIdValues[property];
                    },
                    (value) => {
                        if (value === undefined) {
                            return undefined;
                        }
                        return value;
                    },
                    fields  // 传递字段定义数组
                );
            }
            if (isMatch) {
                visibleFields.push(field);
                visibleFormIdValues[field.id] = values[field.id] || getFieldDefaultValue(field);
            }
        }
        return visibleFields;
    }

    static toFormLabelValues(fields: IFormField[], values: FormIdValues): FormLabelValues {
        const visibleFields = this.visibleFields(fields, values);
        const formLabelValues: FormLabelValues = {};
        visibleFields.forEach((field) => {
            const defaultValue = getFieldDefaultValue(field);
            formLabelValues[field.label] = values[field.id] || defaultValue;
        });
        return formLabelValues;
    }

    static getVisibleIdValues(fields: IFormField[], values: FormIdValues): FormIdValues {
        const visibleFields = this.visibleFields(fields, values);
        const visibleIdValues: FormIdValues = {};
        visibleFields.forEach((field) => {
            visibleIdValues[field.id] = values[field.id];
        });
        
        // 保留所有虚拟字段（以 __ 开头的字段 ID，如运行时 AI 字段）的值
        // 虚拟字段不在 fields 数组中，但需要传递到后续处理逻辑
        Object.keys(values).forEach((id) => {
            if (id.startsWith('__') && !(id in visibleIdValues)) {
                visibleIdValues[id] = values[id];
            }
        });
        
        return visibleIdValues;
    }
}