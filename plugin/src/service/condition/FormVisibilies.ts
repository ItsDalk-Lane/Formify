
import { App } from "obsidian";
import { IFormField } from "src/model/field/IFormField";
import { getFieldDefaultValue } from "src/utils/getFieldDefaultValue";
import { FilterService } from "../filter/FilterService";
import { FormIdValues, FormLabelValues } from "../FormValues";
import type { ExtendedConditionContext } from "../filter/ExtendedConditionEvaluator";
import { ConditionVariableResolver } from "src/utils/ConditionVariableResolver";
import { FormConfig } from "src/model/FormConfig";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { DatabaseFieldOutputFormat, IDatabaseField } from "src/model/field/IDatabaseField";

export class FormVisibilies {

    /**
     * 获取可见字段列表
     * @param fields 所有字段
     * @param values 字段值
     * @param app Obsidian App 实例（可选，用于扩展条件评估）
     */
    static visibleFields(fields: IFormField[], values: FormIdValues, app?: App) {
        const visibleFields: IFormField[] = [];
        const visibleFormIdValues: FormIdValues = {};
        
        // 创建用于变量解析的模拟 FormConfig
        const formConfigForResolver: FormConfig = {
            fields: fields as any,
        } as FormConfig;
        
        // 创建扩展条件评估上下文
        const extendedContext: ExtendedConditionContext | undefined = app ? {
            app,
            currentFile: app.workspace.getActiveFile(),
            formConfig: formConfigForResolver,
            formValues: values,
        } : undefined;

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
                        // 使用变量解析器解析条件值中的变量引用
                        // 注意：使用原始 values 对象以便能引用任何字段的值
                        return ConditionVariableResolver.resolve(value, {
                            formConfig: formConfigForResolver,
                            formValues: values,
                        });
                    },
                    fields,  // 传递字段定义数组
                    extendedContext  // 传递扩展条件上下文
                );
            }
            if (isMatch) {
                visibleFields.push(field);
                visibleFormIdValues[field.id] = values[field.id] || getFieldDefaultValue(field);
            }
        }
        return visibleFields;
    }

    static toFormLabelValues(fields: IFormField[], values: FormIdValues, app?: App): FormLabelValues {
        const visibleFields = this.visibleFields(fields, values, app);
        const databaseValues = this.computeDatabaseFieldValues(visibleFields, fields, values, app);
        const formLabelValues: FormLabelValues = {};
        visibleFields.forEach((field) => {
            const defaultValue = getFieldDefaultValue(field);
            if (field.type === FormFieldType.DATABASE) {
                const databaseValue = databaseValues[field.id];
                formLabelValues[field.label] = databaseValue ?? defaultValue;
                return;
            }
            formLabelValues[field.label] = values[field.id] || defaultValue;
        });
        return formLabelValues;
    }

    static getVisibleIdValues(fields: IFormField[], values: FormIdValues, app?: App): FormIdValues {
        const visibleFields = this.visibleFields(fields, values, app);
        const visibleIdValues: FormIdValues = {};
        visibleFields.forEach((field) => {
            visibleIdValues[field.id] = values[field.id];
        });

        const databaseValues = this.computeDatabaseFieldValues(visibleFields, fields, values, app);
        Object.entries(databaseValues).forEach(([fieldId, value]) => {
            visibleIdValues[fieldId] = value;
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

    private static computeDatabaseFieldValues(
        visibleFields: IFormField[],
        allFields: IFormField[],
        values: FormIdValues,
        app?: App
    ): Record<string, any> {
        const databaseValues: Record<string, any> = {};
        const databaseFields = visibleFields.filter((field) => field.type === FormFieldType.DATABASE);
        if (databaseFields.length === 0) {
            return databaseValues;
        }

        const visibleIdValues = this.buildVisibleIdValuesWithDefaults(visibleFields, values);
        const fieldById = new Map(allFields.map((field) => [field.id, field]));
        const fieldByLabel = new Map(allFields.map((field) => [field.label, field]));

        const formConfigForResolver: FormConfig = {
            fields: allFields as any,
        } as FormConfig;

        const extendedContext: ExtendedConditionContext | undefined = app ? {
            app,
            currentFile: app.workspace.getActiveFile(),
            formConfig: formConfigForResolver,
            formValues: values,
        } : undefined;

        for (const field of databaseFields) {
            const databaseField = field as IDatabaseField;
            const sourceFields = databaseField.sourceFields || [];
            const aggregatedValues: any[] = [];

            for (const source of sourceFields) {
                if (!source?.field) {
                    continue;
                }
                const sourceField = this.resolveDatabaseSourceField(source.field, fieldById, fieldByLabel);
                if (!sourceField) {
                    continue;
                }
                const sourceValue = visibleIdValues[sourceField.id];
                if (sourceValue === undefined) {
                    continue;
                }

                let shouldInclude = true;
                if (source.condition) {
                    shouldInclude = FilterService.match(
                        source.condition,
                        (property) => {
                            if (!property) {
                                return undefined;
                            }
                            if (!Object.prototype.hasOwnProperty.call(visibleIdValues, property)) {
                                return undefined;
                            }
                            return visibleIdValues[property];
                        },
                        (value) => {
                            if (value === undefined) {
                                return undefined;
                            }
                            return ConditionVariableResolver.resolve(value, {
                                formConfig: formConfigForResolver,
                                formValues: values,
                            });
                        },
                        allFields,
                        extendedContext
                    );
                }

                if (!shouldInclude) {
                    continue;
                }

                aggregatedValues.push(sourceValue);
            }

            const outputFormat = databaseField.outputFormat === DatabaseFieldOutputFormat.STRING
                ? DatabaseFieldOutputFormat.STRING
                : DatabaseFieldOutputFormat.ARRAY;

            if (outputFormat === DatabaseFieldOutputFormat.STRING) {
                databaseValues[field.id] = aggregatedValues
                    .map((value) => String(value ?? ""))
                    .join("\n");
            } else {
                databaseValues[field.id] = aggregatedValues;
            }
        }

        return databaseValues;
    }

    private static buildVisibleIdValuesWithDefaults(
        visibleFields: IFormField[],
        values: FormIdValues
    ): FormIdValues {
        const visibleIdValues: FormIdValues = {};
        visibleFields.forEach((field) => {
            const defaultValue = getFieldDefaultValue(field);
            visibleIdValues[field.id] = values[field.id] || defaultValue;
        });
        return visibleIdValues;
    }

    private static resolveDatabaseSourceField(
        fieldRef: string,
        fieldById: Map<string, IFormField>,
        fieldByLabel: Map<string, IFormField>
    ): IFormField | undefined {
        const trimmedRef = fieldRef.trim();
        if (!trimmedRef) {
            return undefined;
        }
        return fieldById.get(trimmedRef) || fieldByLabel.get(trimmedRef);
    }
}
