import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import OpenPageTypeSelect from "../common/OpenPageTypeSelect";
import { AllFilePathFormItem } from "src/view/edit/setting/action/button/AllFilePathFormItem";

export function OpenFileSetting(props: {
	value: ButtonFormAction;
	onChange: (value: ButtonFormAction) => void;
}) {
	const { value } = props;

	return (
		<>
			<CpsFormItem label={localInstance.open_page_in}>
				<OpenPageTypeSelect
					value={value.openPageIn || OpenPageInType.tab}
					onChange={(openPageIn) => {
						const newAction: ButtonFormAction = {
							...value,
							openPageIn,
						};
						props.onChange(newAction);
					}}
				/>
			</CpsFormItem>

			<AllFilePathFormItem
				label={localInstance.file_path}
				value={value.filePath || ""}
				actionId={value.id}
				onChange={(filePath: string) => {
					const newAction: ButtonFormAction = {
						...value,
						filePath,
					};
					props.onChange(newAction);
				}}
			/>
		</>
	);
}
