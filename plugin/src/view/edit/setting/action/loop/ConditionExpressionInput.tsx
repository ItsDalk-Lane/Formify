import { localInstance } from "src/i18n/locals";

export function ConditionExpressionInput(props: {
	value?: string;
	onChange: (value: string) => void;
}) {
	const { value, onChange } = props;

	return (
		<input
			type="text"
			placeholder={localInstance.loop_condition_expression_placeholder}
			value={value ?? ""}
			onChange={(event) => {
				onChange(event.target.value);
			}}
		/>
	);
}


