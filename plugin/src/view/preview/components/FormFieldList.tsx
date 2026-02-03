import { Dispatch, SetStateAction, memo, useCallback, useMemo } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { IFormField } from "src/model/field/IFormField";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { FormVisibilies } from "src/service/condition/FormVisibilies";
import { FormIdValues } from "src/service/FormValues";
import ActionFlow from "../../shared/action-flow/ActionFlow";
import { CpsFormFieldControl } from "../../shared/control/CpsFormFieldControl";
import CpsFormItem from "../../shared/CpsFormItem";

type FormFieldControlProps = {
	field: IFormField;
	value: FormIdValues[string];
	autoFocus: boolean;
	onValueChange: (fieldId: string, value: FormIdValues[string]) => void;
};

const FormFieldControl = memo(function FormFieldControl({
	field,
	value,
	autoFocus,
	onValueChange,
}: FormFieldControlProps) {
	const handleValueChange = useCallback(
		(nextValue: FormIdValues[string]) => {
			onValueChange(field.id, nextValue);
		},
		[field.id, onValueChange]
	);

	return (
		<CpsFormItem
			required={field.required}
			label={field.label}
			description={field.description}
		>
			<CpsFormFieldControl
				field={field}
				value={value}
				autoFocus={autoFocus}
				onValueChange={handleValueChange}
			/>
		</CpsFormItem>
	);
});

export type FormFieldListProps = {
	fields: IFormField[];
	values: FormIdValues;
	onValuesChange: Dispatch<SetStateAction<FormIdValues>>;
};

export const FormFieldList = memo(function FormFieldList({
	fields,
	values,
	onValuesChange,
}: FormFieldListProps) {
	const app = useObsidianApp();

	const handleValueChange = useCallback(
		(fieldId: string, value: FormIdValues[string]) => {
			onValuesChange((prevValues) => ({
				...prevValues,
				[fieldId]: value,
			}));
		},
		[onValuesChange]
	);

	const visibleFields = useMemo(() => {
		return FormVisibilies.visibleFields(fields, values, app);
	}, [fields, values, app]);

	const renderFields = useMemo(
		() => visibleFields.filter((field) => field.type !== FormFieldType.DATABASE),
		[visibleFields]
	);

	const fieldElements = useMemo(() => {
		return renderFields.map((field, index) => (
			<FormFieldControl
				key={field.id}
				field={field}
				value={values[field.id]}
				autoFocus={index === 0}
				onValueChange={handleValueChange}
			/>
		));
	}, [handleValueChange, renderFields, values]);

	return (
		<>
			{fieldElements}
			{fields.length === 0 && <ActionFlow />}
		</>
	);
});
