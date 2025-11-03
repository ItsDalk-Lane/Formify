import { localInstance } from "src/i18n/locals";
import { ButtonActionType } from "src/model/enums/ButtonActionType";

export function ButtonActionTypeSelect(props: {
	value: ButtonActionType;
	onChange: (value: ButtonActionType) => void;
}) {
	const { value } = props;
	return (
		<select
			className="dropdown"
			value={value || ButtonActionType.OPEN_URL}
			onChange={(e) => props.onChange(e.target.value as ButtonActionType)}
		>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}

const options = [
	{
		label: localInstance.open_url,
		value: ButtonActionType.OPEN_URL,
	},
	{
		label: localInstance.open_file,
		value: ButtonActionType.OPEN_FILE,
	},
	{
		label: localInstance.submit_form,
		value: ButtonActionType.SUBMIT_FORM,
	},
];
