import { useMemo, useState } from "react";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { fieldTypeOptions } from "../FieldTypeSelect";
import "./NewFieldGrid.css";

type Props = {
	onSelect: (fieldType: FormFieldType) => void;
	contentProps?: React.HTMLAttributes<HTMLDivElement>;
};

export function NewFieldGrid(props: Props) {
	const [query, setQuery] = useState("");
	const { onSelect } = props;

	const filteredOptions = useMemo(() => {
		return fieldTypeOptions.filter((item) => {
			return (
				item.label.toLowerCase().includes(query.toLowerCase()) ||
				item.value.toLowerCase().includes(query.toLowerCase())
			);
		});
	}, [query]);

	const handleSelect = (item: FormFieldType) => {
		setQuery("");
		onSelect(item);
	};

	const { className: contentClassName, ...contentProps } =
		props.contentProps || {};

	return (
		<div
			className={`form--NewFieldGridContent ${contentClassName || ""}`}
			{...contentProps}
		>
			<div className="form--NewFieldGridHeader">
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="form--NewFieldGridSearch"
					autoFocus={true}
					placeholder={localInstance.typing}
				/>
			</div>

			<div className="form--NewFieldGridBody">
				<div className="form--NewFieldGridGrid">
					{filteredOptions.map((item) => (
						<div
							key={item.value}
							className="form--NewFieldGridGridItem"
							onClick={() => handleSelect(item.value)}
						>
							<div className="form--NewFieldGridGridItemIcon">
								{item.icon}
							</div>
							<span className="form--NewFieldGridGridItemText">
								{item.label}
							</span>
						</div>
					))}
				</div>

				{filteredOptions.length === 0 && (
					<div className="form--NewFieldGridEmpty">
						<span className="form--NewFieldGridEmptyText">
							{localInstance.none}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
