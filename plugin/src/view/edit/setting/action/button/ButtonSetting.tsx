import { IFormAction } from "src/model/action/IFormAction";
import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ButtonActionType } from "src/model/enums/ButtonActionType";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { ButtonActionTypeSelect } from "./ButtonActionTypeSelect";
import { OpenUrlSetting } from "./OpenUrlSetting";
import { OpenFileSetting } from "./OpenFileSetting";
import { SubmitFormSetting } from "./SubmitFormSetting";

export function ButtonSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
}) {
	const { value } = props;
	if (value.type !== FormActionType.BUTTON) {
		return null;
	}

	const action = value as ButtonFormAction;

	return (
		<>
			<CpsFormItem label={localInstance.button_action_type}>
				<ButtonActionTypeSelect
					value={action.buttonActionType || ButtonActionType.OPEN_URL}
					onChange={(buttonActionType: ButtonActionType) => {
						const newAction: ButtonFormAction = {
							...action,
							buttonActionType,
						};
						props.onChange(newAction);
					}}
				/>
			</CpsFormItem>

			{action.buttonActionType === ButtonActionType.OPEN_URL && (
				<OpenUrlSetting value={action} onChange={props.onChange} />
			)}

			{action.buttonActionType === ButtonActionType.OPEN_FILE && (
				<OpenFileSetting value={action} onChange={props.onChange} />
			)}

			{action.buttonActionType === ButtonActionType.SUBMIT_FORM && (
				<SubmitFormSetting value={action} onChange={props.onChange} />
			)}
		</>
	);
}
