import { useMemo } from "react";
import { MultipleComboboxSuggestion } from "./MultipleComboboxSuggestion";
import { isMultiTextProperty } from "src/utils/isMultiTextProperty";
import ComboboxSuggestion from "./ComboboxSuggestion";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { getPropertyValues } from "src/utils/getPropertyValues";

export function PropertyValueSuggestInput(props: {
	id?: string;
	label?: string;
	placeholder?: string;
	name: string;
	value: string | string[];
	onChange: (value: string | string[] | null) => void;
	multiple?: boolean;
}) {
	const app = useObsidianApp();
	const { name, value, onChange, multiple } = props;
	const items = useMemo(() => {
		app.metadataTypeManager.getAllProperties().find;
		const options = getPropertyValues(app, name)
			.filter((f) => {
				if (f == null || f == undefined) {
					return false;
				}
				return true;
			})
			.map((v, index) => {
				return {
					label: v + "",
					value: v,
				};
			});
		return options;
	}, [name]);

	// 优先使用传入的 multiple 配置，如果没有则根据 Obsidian 属性类型检测
	const isMultiple = multiple !== undefined ? multiple : isMultiTextProperty(app, name);

	return isMultiple ? (
		<MultipleComboboxSuggestion
			id={props.id}
			label={props.label}
			placeholder={props.placeholder}
			value={value}
			onChange={onChange}
			options={items}
		/>
	) : (
		<ComboboxSuggestion
			label={props.label}
			id={props.id}
			placeholder={props.placeholder}
			value={value}
			onChange={onChange}
			options={items}
		/>
	);
}
