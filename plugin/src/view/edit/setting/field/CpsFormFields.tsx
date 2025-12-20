import { useCallback, useMemo, useState } from "react";
import useSortable from "src/hooks/useSortable";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField, FormField } from "src/model/field/IFormField";
import { IOptionsField } from "src/model/field/ISelectField";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import generateSequenceName from "src/utils/generateSequenceName";
import { Strings } from "src/utils/Strings";
import { v4 } from "uuid";
import { CpsFormFieldItemEditing } from "./CpsFormFieldItemEditing";
import "./CpsFormFields.css";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import { NewFieldGridPopover } from "./common/new-field-grid/NewFieldGridPopover";

export default function CpsFormFields(props: {
    fields: IFormField[];
    onSave: (fields: IFormField[], modified: IFormField[]) => void;
    selectMode?: boolean;
    onToggleSelectMode?: () => void;
    onSelectAll?: () => void;
    onSelectNone?: () => void;
    onDeleteSelected?: () => void;
    selectedIds?: string[];
    onToggleSelection?: (id: string) => void;
}) {
    const { fields } = props;
    const [internalSelectMode, setInternalSelectMode] = useState(false);
    const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);

    const selectMode = props.selectMode ?? internalSelectMode;
    const selectedIds = props.selectedIds ?? internalSelectedIds;
	useSortable({
		items: fields || [],
		getId: (item) => item.id,
		onChange: (orders) => {
			props.onSave(orders, []);
		},
	});

	const onFieldSave = useCallback(
		(field: IFormField) => {
			const modified = fields.find((f) => f.id === field.id);
			let newFields;
			if (fields.find((f) => f.id === field.id)) {
				newFields = updateField(field, fields);
			} else {
				newFields = [...fields, field];
			}
			props.onSave(newFields, modified ? [modified] : []);
		},
		[fields, props.onSave]
	);

	const onFieldDeleted = useCallback(
		(field: IFormField) => {
			const newFields = fields.filter((f) => f.id !== field.id);
			props.onSave(newFields, []);
		},
		[fields, props.onSave]
	);

	const onFieldAdd = useCallback((fieldType: FormFieldType) => {
		const names = fields.map((f) => f.label);
		const newField = {
			id: v4(),
			label: generateSequenceName(names),
			type: fieldType,
		};
		const newFields = [...fields, newField];
		props.onSave(newFields, []);
	}, [fields, props.onSave]);

    const onDuplicate = useCallback(
        (field: IFormField) => {
			const newField = {
				...field,
				id: v4(),
			};
			const newFields = fields.flatMap((f) => {
				if (f.id === field.id) {
					return [newField, f];
				}
				return [f];
			});
			props.onSave(newFields, []);
		},
		[fields, props.onSave]
    );

    const handleToggleSelectMode = () => {
        if (props.onToggleSelectMode) {
            props.onToggleSelectMode();
        } else {
            setInternalSelectMode(!internalSelectMode);
        }
    };

    const handleToggleSelection = (id: string) => {
        if (props.onToggleSelection) {
            props.onToggleSelection(id);
        } else {
            setInternalSelectedIds(prev => {
                const s = new Set(prev);
                if (s.has(id)) {
                    s.delete(id);
                } else {
                    s.add(id);
                }
                return Array.from(s);
            });
        }
    };

    return (
        <div className="form--CpsFormFieldsSetting">
            {fields.map((field, index) => {
                return (
                    <div key={field.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {selectMode && (
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(field.id)}
                                onChange={() => handleToggleSelection(field.id)}
                            />
                        )}
                        <CpsFormFieldItemEditing
                            index={index}
                            field={field as FormField}
                            onDelete={onFieldDeleted}
                            onChange={onFieldSave}
                            onDuplicate={onDuplicate}
                        />
                    </div>
                );
            })}
            <NewFieldGridPopover onSelect={onFieldAdd}>
                <button className="form--AddButton">
                    +{localInstance.add_field}
                </button>
            </NewFieldGridPopover>
        </div>
    );
}

function updateField(updated: IFormField, fields: IFormField[]) {
	const original = fields.find((f) => f.id === updated.id);
	if (!original) {
		return fields;
	}
	return fields.map((field) => {
		if (field.id === updated.id) {
			return updated;
		}
		if (!field.condition) {
			return field;
		}
		const newCondition = updateCondition(
			field.condition,
			original,
			updated
		);
		return {
			...field,
			condition: newCondition,
		};
	});
}

function updateCondition(
	condition: Filter,
	original: IFormField,
	updated: IFormField
) {
	if (!condition) {
		return condition;
	}
	if (condition.type === FilterType.group) {
		const conditions = condition.conditions || [];
		const newConditions = conditions.map((c) => {
			return updateCondition(c, original, updated);
		});
		condition.conditions = newConditions;
		return condition;
	}

	if (condition.property !== updated.id) {
		return condition;
	}

	// original is select
	const isSelectField = (field: IFormField) =>
		[FormFieldType.SELECT, FormFieldType.RADIO].includes(field.type);
	if (isSelectField(original) && isSelectField(updated)) {
		const originalOptionsField = original as IOptionsField;
		const updatedOptionsField = updated as IOptionsField;
		const originalOptions = originalOptionsField.options || [];
		const updatedOptions = updatedOptionsField.options || [];
		
		// 处理enableCustomValue配置变更
		const originalEnableCustomValue = originalOptionsField.enableCustomValue === true;
		const updatedEnableCustomValue = updatedOptionsField.enableCustomValue === true;
		
		// 查找匹配的原始选项
		const originalOption = originalOptions.find(
			(o) => o.value === condition.value || o.label === condition.value
		);
		
		if (!originalOption) {
			// 如果没有找到原始选项，直接返回
			return condition;
		}
		
		// 根据option.id查找更新后的选项
		const updatedOption = updatedOptions.find(
			(o) => o.id === originalOption.id
		);
		
		if (updatedOption) {
			// 根据新的enableCustomValue配置设置条件值
			if (updatedEnableCustomValue) {
				// 使用value（如果value为空，则使用label）
				condition.value = Strings.isNotEmpty(updatedOption.value) 
					? updatedOption.value 
					: updatedOption.label;
			} else {
				// 使用label
				condition.value = updatedOption.label;
			}
		}
	}
	return condition;
}
