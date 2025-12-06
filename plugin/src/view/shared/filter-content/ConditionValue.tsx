import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { ISelectField } from "src/model/field/ISelectField";
import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { CpsFormFieldControl } from "../control/CpsFormFieldControl";
import SelectControl from "../control/SelectControl";
import { FieldValueReaderFactory } from "src/service/field-value/FieldValueReaderFactory";

export function ConditionValue(props: {
	filter: Filter;
	value: any;
	onChange: (value: any) => void;
}) {
	const formConfig = useFormConfig();
	const { filter } = props;
	const propertyId = filter.property || "";
	const field = formConfig.fields.find((f) => f.id === propertyId);
  const { value, onChange } = props;
  if (!field) {
		return (
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={localInstance.value}
			/>
		);
  }

  if (filter.operator === OperatorType.RegexMatch) {
    return (
      <input
        type="text"
        value={typeof value === 'string' ? value : (value?.pattern ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={localInstance.regex_match}
      />
    );
  }

  if (
    filter.operator === OperatorType.ArrayLengthEquals ||
    filter.operator === OperatorType.ArrayLengthGreater ||
    filter.operator === OperatorType.ArrayLengthLess
  ) {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : (value ? parseInt(String(value)) || 0 : 0)}
        onChange={(e) => onChange(parseInt(e.target.value))}
        placeholder={localInstance.value}
      />
    );
  }
	// 对于NUMBER字段，确保存储为数字类型
	if (field.type === FormFieldType.NUMBER) {
		const reader = FieldValueReaderFactory.getReader(field.type);
		const normalizedValue = reader.normalizeValue(field, value);
		return (
			<input
				type="number"
				step="any"
				value={normalizedValue !== null ? normalizedValue : ''}
				onChange={(e) => {
					const numValue = parseFloat(e.target.value);
					onChange(isNaN(numValue) ? null : numValue);
				}}
				placeholder={localInstance.value}
			/>
		);
	}

	if (
		field.type === FormFieldType.RADIO ||
		field.type === FormFieldType.SELECT
	) {
		const selectField = field as ISelectField;
		const isMultiple =
			filter.operator === OperatorType.Contains ||
			filter.operator === OperatorType.NotContains;
		const multipleSelect = {
			...selectField,
			multiple: isMultiple,
		};
		return (
			<SelectControl
				field={multipleSelect}
				value={value}
				onValueChange={onChange}
			/>
		);
	}
	return (
		<CpsFormFieldControl
			field={field}
			value={value}
			onValueChange={(v) => {
				onChange(v);
			}}
		/>
	);
}
