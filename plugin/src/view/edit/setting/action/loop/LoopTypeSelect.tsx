import { localInstance } from "src/i18n/locals";
import { LoopType } from "src/model/enums/LoopType";

const loopTypeOptions = [
	{
		value: LoopType.LIST,
		label: localInstance.loop_type_list,
	},
	{
		value: LoopType.CONDITION,
		label: localInstance.loop_type_condition,
	},
	{
		value: LoopType.COUNT,
		label: localInstance.loop_type_count,
	},
	{
		value: LoopType.PAGINATION,
		label: localInstance.loop_type_pagination,
	},
];

export function LoopTypeSelect(props: {
	value: LoopType;
	onChange: (value: LoopType) => void;
}) {
	const { value, onChange } = props;

	return (
		<select
			value={value}
			onChange={(event) => {
				onChange(event.target.value as LoopType);
			}}
		>
			{loopTypeOptions.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}





