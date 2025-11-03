import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { localInstance } from "src/i18n/locals";
import { FormFilePathFormItem } from "./FormFilePathFormItem";

export function SubmitFormSetting(props: {
	value: ButtonFormAction;
	onChange: (value: ButtonFormAction) => void;
}) {
	const { value } = props;

	return (
		<>
			<FormFilePathFormItem
				label={localInstance.form_file}
				value={value.formFilePath || ""}
				placeholder={localInstance.select_form_file}
				onChange={(formFilePath) => {
					const newAction: ButtonFormAction = {
						...value,
						formFilePath,
					};
					props.onChange(newAction);
				}}
			/>
		</>
	);
}
