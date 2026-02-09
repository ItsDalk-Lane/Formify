import { Select2, SelectOption2 } from "src/component/select2/Select";
import { localInstance } from "src/i18n/locals";
import { CreateFileMode } from "src/model/enums/CreateFileMode";

const options: SelectOption2[] = [
	{
		value: CreateFileMode.SINGLE_FILE,
		label: localInstance.create_mode_single_file,
	},
	{
		value: CreateFileMode.BATCH_FILES,
		label: localInstance.create_mode_batch_files,
	},
	{
		value: CreateFileMode.SINGLE_FOLDER,
		label: localInstance.create_mode_single_folder,
	},
	{
		value: CreateFileMode.BATCH_FOLDERS,
		label: localInstance.create_mode_batch_folders,
	},
];

export default function CreateFileModeSelect(props: {
	value: CreateFileMode;
	onChange: (value: CreateFileMode) => void;
}) {
	return (
		<Select2
			value={props.value}
			onChange={(value) => props.onChange(value as CreateFileMode)}
			options={options}
		/>
	);
}
