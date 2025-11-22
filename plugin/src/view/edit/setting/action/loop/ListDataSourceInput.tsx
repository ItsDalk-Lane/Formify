import { localInstance } from "src/i18n/locals";

export function ListDataSourceInput(props: {
	value?: string;
	onChange: (value: string) => void;
}) {
	const { value, onChange } = props;

	return (
		<textarea
			rows={3}
			placeholder={localInstance.loop_data_source_placeholder}
			value={value ?? ""}
			onChange={(event) => {
				onChange(event.target.value);
			}}
		/>
	);
}

