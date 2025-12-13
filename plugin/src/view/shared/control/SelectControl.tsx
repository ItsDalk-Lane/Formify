import { ListBox } from "src/component/list-box/ListBox";
import { Autocomplete, AutocompleteOption } from "src/component/autocomplete/Autocomplete";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { ISelectField } from "src/model/field/ISelectField";
import { useMemo } from "react";

export default function (props: {
	field: IFormField;
	value: any;
	onValueChange: (value: any) => void;
	autoFocus?: boolean;
}) {
	const { value, field, onValueChange, autoFocus } = props;
	const f = field as ISelectField;
	const userOptions = (f.options || []).map((o) => {
		const value = f.enableCustomValue === true ? o.value : o.label;
		return {
			id: o.id,
			label: o.label,
			value: value,
		};
	});
	const hasMatchValue = userOptions.some((v) => v.value === value);

	const autocompleteOptions = useMemo<AutocompleteOption[]>(() => {
		return userOptions.map((o) => {
			const v = o.value === undefined || o.value === null ? "" : String(o.value);
			return {
				id: o.id,
				value: v,
				label: o.label,
			};
		});
	}, [userOptions]);

	const selectedLabel = useMemo(() => {
		const v = value === undefined || value === null ? "" : String(value);
		if (!v) {
			return "";
		}
		return autocompleteOptions.find((o) => o.value === v)?.label || "";
	}, [autocompleteOptions, value]);
	const isRadio = field.type === FormFieldType.RADIO;
	if (f.multiple && !isRadio) {
		return (
			<ListBox
				value={value}
				options={userOptions}
				onChange={(v) => {
					props.onValueChange(v);
				}}
			></ListBox>
		);
	}

	if (f.searchable === true) {
		const v = value === undefined || value === null ? "" : String(value);
		const placeholder =
			f.searchPlaceholder || localInstance.search_commands;

		return (
			<>
				<Autocomplete
					label={selectedLabel || localInstance.please_select_option}
					value={v}
					onSelect={(nextValue) => onValueChange(nextValue)}
					getOptions={() => autocompleteOptions}
					searchPlaceholder={placeholder}
					allowCreate={false}
				/>
				<input
					type="text"
					required={field.required}
					value={v}
					readOnly={true}
					tabIndex={-1}
					aria-hidden={true}
					style={{
						position: "absolute",
						left: "-10000px",
						width: "1px",
						height: "1px",
						opacity: 0,
						pointerEvents: "none",
					}}
				/>
			</>
		);
	}

	return (
		<select
			id={field.id}
			data-name={field.label}
			className="dropdown"
			value={hasMatchValue ? value ?? "" : ""}
			required={field.required}
			onChange={(e) => onValueChange(e.target.value)}
			autoFocus={autoFocus}
		>
			<option value="" disabled hidden>
				{localInstance.please_select_option}
			</option>
			{userOptions.map((option) => {
				return (
					<option key={option.id} value={option.value || option.label}>
						{option.label}
					</option>
				);
			})}
		</select>
	);
}
