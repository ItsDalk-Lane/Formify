
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
import { Filter, FilterType } from "src/model/filter/Filter";

type FieldVisibilityResolution = {
    isVisible: boolean;
};

export class FormVisibilies {
    private static resolveFieldValue(values: FormIdValues, field: IFormField) {
        if (Object.prototype.hasOwnProperty.call(values, field.id)) {
            const currentValue = values[field.id];
            if (currentValue !== undefined) {
                return currentValue;
            }
        }
        return getFieldDefaultValue(field);
    }

    /**
     * 获取可见字段列表
     * @param fields 所有字段
     * @param values 字段值
     * @param app Obsidian App 实例（可选，用于扩展条件评估）
     */
    static visibleFields(fields: IFormField[], values: FormIdValues, app?: App) {
        const fieldById = new Map(fields.map((field) => [field.id, field]));
        const cyclicFieldIds = this.collectCyclicFieldIds(fields, fieldById);
        const formConfigForResolver = this.createFormConfigForResolver(fields);
        const extendedContext = this.createExtendedContext(formConfigForResolver, values, app);
        const resolvedValueCache = new Map<string, any>();
        const visibilityCache = new Map<string, FieldVisibilityResolution>();
        const visitingFieldIds = new Set<string>();

        const resolveConditionValue = (value: any) => {
            if (value === undefined) {
                return undefined;
            }
            return ConditionVariableResolver.resolve(value, {
                formConfig: formConfigForResolver,
                formValues: values,
            });
        };

        const resolveVisibleFieldValue = (field: IFormField) => {
            if (!resolvedValueCache.has(field.id)) {
                resolvedValueCache.set(field.id, this.resolveFieldValue(values, field));
            }
            return resolvedValueCache.get(field.id);
        };

        const evaluateVisibility = (field: IFormField): FieldVisibilityResolution => {
            const cached = visibilityCache.get(field.id);
            if (cached) {
                return cached;
            }

            if (cyclicFieldIds.has(field.id) || visitingFieldIds.has(field.id)) {
                const resolution = { isVisible: false };
                visibilityCache.set(field.id, resolution);
                return resolution;
            }

            visitingFieldIds.add(field.id);

            try {
                const isVisible = !field.condition || FilterService.match(
                    field.condition,
                    (property) => {
                        if (!property || cyclicFieldIds.has(property)) {
                            return undefined;
                        }

                        const dependencyField = fieldById.get(property);
                        if (!dependencyField) {
                            return undefined;
                        }

                        const dependencyVisibility = evaluateVisibility(dependencyField);
                        if (!dependencyVisibility.isVisible) {
                            return undefined;
                        }

                        return resolveVisibleFieldValue(dependencyField);
                    },
                    resolveConditionValue,
                    fields,
                    extendedContext
                );

                const resolution = { isVisible };
                visibilityCache.set(field.id, resolution);
                return resolution;
            } finally {
                visitingFieldIds.delete(field.id);
            }
        };

        fields.forEach((field) => {
            evaluateVisibility(field);
        });

        return fields.filter((field) => visibilityCache.get(field.id)?.isVisible === true);
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
            formLabelValues[field.label] = this.resolveFieldValue(values, field);
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
            visibleIdValues[field.id] = this.resolveFieldValue(values, field);
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

    private static createFormConfigForResolver(fields: IFormField[]): FormConfig {
        return {
            fields: fields as any,
        } as FormConfig;
    }

    private static createExtendedContext(
        formConfig: FormConfig,
        values: FormIdValues,
        app?: App
    ): ExtendedConditionContext | undefined {
        if (!app) {
            return undefined;
        }

        return {
            app,
            currentFile: app.workspace.getActiveFile(),
            formConfig,
            formValues: values,
        };
    }

    private static collectCyclicFieldIds(
        fields: IFormField[],
        fieldById: Map<string, IFormField>
    ): Set<string> {
        const dependenciesByFieldId = new Map<string, string[]>();
        const visitState = new Map<string, "visiting" | "visited">();
        const cyclicFieldIds = new Set<string>();
        const path: string[] = [];

        fields.forEach((field) => {
            const dependencies = Array.from(this.collectConditionDependencies(field.condition)).filter(
                (dependencyId) => fieldById.has(dependencyId)
            );
            dependenciesByFieldId.set(field.id, dependencies);
        });

        const visit = (fieldId: string) => {
            const currentState = visitState.get(fieldId);
            if (currentState === "visited") {
                return;
            }

            if (currentState === "visiting") {
                const cycleStartIndex = path.indexOf(fieldId);
                const cycleFieldIds = cycleStartIndex >= 0 ? path.slice(cycleStartIndex) : [fieldId];
                cycleFieldIds.forEach((cycleFieldId) => cyclicFieldIds.add(cycleFieldId));
                return;
            }

            visitState.set(fieldId, "visiting");
            path.push(fieldId);

            const dependencyIds = dependenciesByFieldId.get(fieldId) || [];
            dependencyIds.forEach((dependencyId) => {
                visit(dependencyId);
            });

            path.pop();
            visitState.set(fieldId, "visited");
        };

        fields.forEach((field) => {
            visit(field.id);
        });

        return cyclicFieldIds;
    }

    private static collectConditionDependencies(condition?: Filter): Set<string> {
        const dependencies = new Set<string>();
        if (!condition) {
            return dependencies;
        }

        const visit = (currentCondition: Filter) => {
            if (currentCondition.type === FilterType.group) {
                (currentCondition.conditions || []).forEach((childCondition) => {
                    visit(childCondition);
                });
                return;
            }

            if (currentCondition.type === FilterType.filter && currentCondition.property) {
                dependencies.add(currentCondition.property);
            }
        };

        visit(condition);
        return dependencies;
    }
}
