import { useEffect, useMemo, useState } from "react";
import { v4 } from "uuid";
import { ListBox } from "src/component/list-box/ListBox";
import Dialog2 from "src/component/dialog/Dialog2";
import { FilterRoot } from "src/component/filter/FilterRoot";
import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { DatabaseFieldSource, IDatabaseField } from "src/model/field/IDatabaseField";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { FormCondition } from "src/view/shared/filter-content/FormCondition";
import "./CpsFormDatabaseFieldSetting.css";

function ensureFilter(filter?: Filter): Filter {
    if (filter) {
        return filter;
    }
    return {
        id: v4(),
        type: FilterType.group,
        operator: OperatorType.And,
        conditions: [],
    };
}

function countValidFilters(filter?: Filter): number {
    if (!filter || !filter.conditions) {
        return 0;
    }
    const countValid = (conditions: Filter[]): number => {
        if (!conditions || conditions.length === 0) {
            return 0;
        }
        return conditions.reduce((count, condition) => {
            if (condition.type === FilterType.group) {
                return count + countValid(condition.conditions || []);
            }
            if (
                condition.type === FilterType.timeCondition ||
                condition.type === FilterType.fileCondition ||
                condition.type === FilterType.scriptCondition
            ) {
                return condition.extendedConfig ? count + 1 : count;
            }
            if (condition.type === FilterType.filter) {
                return condition.property && condition.operator ? count + 1 : count;
            }
            return count;
        }, 0);
    };

    return countValid(filter.conditions);
}

function sourcesEqual(a: DatabaseFieldSource[] = [], b: DatabaseFieldSource[] = []): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        const left = a[i];
        const right = b[i];
        if (!left || !right) {
            return false;
        }
        if (left.field !== right.field) {
            return false;
        }
        if (left.condition !== right.condition) {
            return false;
        }
    }
    return true;
}

export default function CpsFormDatabaseFieldSetting(props: {
    field: IFormField;
    onChange: (field: IFormField) => void;
}) {
    const { field, onChange } = props;
    const formConfig = useFormConfig();
    const [activeConditionFieldId, setActiveConditionFieldId] = useState<string | null>(null);

    if (field.type !== FormFieldType.DATABASE) {
        return null;
    }

    const databaseField = field as IDatabaseField;

    const selectableFields = useMemo(
        () =>
            (formConfig.fields || []).filter(
                (f) => f.id !== field.id && f.type !== FormFieldType.DATABASE
            ),
        [formConfig.fields, field.id]
    );

    const fieldById = useMemo(() => {
        return new Map(selectableFields.map((f) => [f.id, f]));
    }, [selectableFields]);

    const fieldByLabel = useMemo(() => {
        return new Map(selectableFields.map((f) => [f.label, f]));
    }, [selectableFields]);

    const normalizedSources = useMemo<DatabaseFieldSource[]>(() => {
        const sources = databaseField.sourceFields || [];
        const next: DatabaseFieldSource[] = [];
        sources.forEach((source) => {
            const rawRef = source?.field?.trim();
            if (!rawRef) {
                return;
            }
            const resolved = fieldById.get(rawRef) || fieldByLabel.get(rawRef);
            if (!resolved) {
                return;
            }
            next.push({
                ...source,
                field: resolved.id,
            });
        });
        return next;
    }, [databaseField.sourceFields, fieldById, fieldByLabel]);

    useEffect(() => {
        const originalSources = databaseField.sourceFields || [];
        if (!sourcesEqual(originalSources, normalizedSources)) {
            onChange({
                ...databaseField,
                sourceFields: normalizedSources,
            });
        }
    }, [databaseField, normalizedSources, onChange]);

    const selectedSourceIds = normalizedSources.map((source) => source.field);

    const sourceOptions = useMemo(
        () =>
            selectableFields.map((f) => ({
                id: f.id,
                label: f.label,
                value: f.id,
            })),
        [selectableFields]
    );

    const handleSourceFieldsChange = (value: string[] | null) => {
        const nextIds = Array.isArray(value) ? value : [];
        const existingMap = new Map(
            normalizedSources.map((source) => [source.field, source])
        );
        const nextSources = nextIds.map((id) => {
            return existingMap.get(id) || { field: id };
        });
        onChange({
            ...databaseField,
            sourceFields: nextSources,
        });
    };

    const updateSourceCondition = (fieldId: string, condition: Filter) => {
        const nextSources = normalizedSources.map((source) =>
            source.field === fieldId ? { ...source, condition } : source
        );
        onChange({
            ...databaseField,
            sourceFields: nextSources,
        });
    };

    const activeSource = normalizedSources.find(
        (source) => source.field === activeConditionFieldId
    );

    return (
        <>
            <div className="form--DatabaseFieldSetting">
                <div className="form--DatabaseFieldSettingHeader">
                    <div className="form--DatabaseFieldSettingTitle">
                        {localInstance.database_source_fields}
                    </div>
                    <div className="form--DatabaseFieldSettingDesc">
                        {localInstance.database_source_fields_description}
                    </div>
                </div>
                <div className="form--DatabaseFieldSettingBody">
                    <ListBox
                        value={selectedSourceIds}
                        options={sourceOptions}
                        onChange={handleSourceFieldsChange}
                        renderOptionSuffix={(option, isSelected) => {
                            if (!isSelected) {
                                return null;
                            }
                            const source = normalizedSources.find(
                                (item) => item.field === option.value
                            );
                            const count = countValidFilters(source?.condition);
                            return (
                                <button
                                    type="button"
                                    className="form--ListBoxOptionAction"
                                    data-has-condition={count > 0}
                                    onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                    }}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setActiveConditionFieldId(option.value);
                                    }}
                                >
                                    {localInstance.database_include_condition}
                                    {count > 0 && ` + ${count}`}
                                </button>
                            );
                        }}
                    />

                    {normalizedSources.length === 0 && (
                        <div className="form--DatabaseFieldEmpty">
                            {localInstance.database_source_fields_empty}
                        </div>
                    )}
                </div>
            </div>

            <Dialog2
                open={!!activeConditionFieldId}
                onOpenChange={(open) => {
                    if (!open) {
                        setActiveConditionFieldId(null);
                    }
                }}
                closeOnInteractOutside={false}
            >
                {() => {
                    if (!activeSource) {
                        return null;
                    }
                    return (
                        <FilterRoot
                            filter={ensureFilter(activeSource.condition)}
                            onFilterChange={(filter: Filter) => {
                                updateSourceCondition(activeSource.field, filter);
                            }}
                            filterContentComponent={FormCondition}
                        />
                    );
                }}
            </Dialog2>
        </>
    );
}
