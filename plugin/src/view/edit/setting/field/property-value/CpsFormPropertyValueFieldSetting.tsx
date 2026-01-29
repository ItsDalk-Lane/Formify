import { PropertyNameSuggestInput } from "src/component/combobox/PropertyNameSuggestInput";
import ToggleControl from "src/view/shared/control/ToggleControl";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { IPropertyValueField } from "src/model/field/IPropertyValueField";
import CpsFormItem from "src/view/shared/CpsFormItem";

export default function CpsFormPropertyValueFieldSetting(props: {
	field: IFormField;
	onChange: (field: IFormField) => void;
}) {
	const { field, onChange } = props;
	if (field.type !== FormFieldType.PROPERTY_VALUE_SUGGESTION) {
		return null;
	}
	const propertyField = field as IPropertyValueField;
	return (
		<>
			<CpsFormItem label={localInstance.property_name}>
				<PropertyNameSuggestInput
					placeholder={field.label}
					value={propertyField.propertyName}
					onChange={(value) => {
						const newField = {
							...propertyField,
							propertyName: value,
						};
						onChange(newField);
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.multiple}>
				<ToggleControl
					value={propertyField.multiple === true}
					onValueChange={(value) => {
						const newField = {
							...propertyField,
							multiple: value,
						};
						// 如果从多选切换到单选，且默认值是数组，则只保留第一个值
						if (
							!value &&
							Array.isArray(newField.defaultValue) &&
							newField.defaultValue.length > 0
						) {
							newField.defaultValue = newField.defaultValue[0];
						}
						onChange(newField);
					}}
				/>
			</CpsFormItem>
		</>
	);
}
