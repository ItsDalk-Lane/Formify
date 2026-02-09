import { Select2, SelectOption2 } from "src/component/select2/Select";
import { localInstance } from "src/i18n/locals";
import { TargetFileType } from "src/model/enums/TargetFileType";

export default function TargetFileTypeSelect(props: {
	value: string;
	onChange: (value: TargetFileType) => void;
	/** 是否显示"多个文件"选项 */
	showMultiple?: boolean;
}) {
	const { value, onChange, showMultiple = false } = props;
	const options = showMultiple
		? insertTargetFileTypeOptionsWithMultiple
		: insertTargetFileTypeOptions;
	return (
		<Select2
			value={value || TargetFileType.SPECIFIED_FILE}
			onChange={(value) => onChange(value as TargetFileType)}
			options={options}
		/>
	);
}

const insertTargetFileTypeOptions: SelectOption2[] = [
	{
		value: TargetFileType.SPECIFIED_FILE,
		label: localInstance.in_specified_file,
	},
	{
		value: TargetFileType.CURRENT_FILE,
		label: localInstance.in_current_file,
	},
];

const insertTargetFileTypeOptionsWithMultiple: SelectOption2[] = [
	...insertTargetFileTypeOptions,
	{
		value: TargetFileType.MULTIPLE_FILES,
		label: localInstance.target_file_type_multiple,
	},
];
