import { CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import CpsFormSelectFieldSetting from "../select/CpsFormSelectFieldSetting";
import "./CpsFormFieldSettingContent.css";
import { DescriptionSetting } from "./description/DescriptionSetting";
import { SelectFieldSettingHeader } from "./SelectFieldSettingHeader";
import { IFormField } from "src/model/field/IFormField";
import { IOptionsField } from "src/model/field/ISelectField";
import { FormValidator } from "src/service/validator/FormValidator";
import { CpsFormFieldControl } from "src/view/shared/control/CpsFormFieldControl";
import CpsFormDatabaseFieldSetting from "../database/CpsFormDatabaseFieldSetting";
import { FormFieldType } from "src/model/enums/FormFieldType";

export function CpsFormFieldSettingContent(props: {
	field: IFormField;
	onChange: (field: IFormField) => void;
}) {
	const { field, onChange } = props;
	const [isOptionsEditing, setInOptionsEditing] = useState(false);
	const error = useMemo(() => {
		const res = FormValidator.validateField(field);
		if (res.valid) {
			return null;
		}
		return res.message;
	}, [field]);

	return (
		<div className="form--CpsFormFieldSettingContent">
			{field.enableDescription && (
				<DescriptionSetting field={field} onChange={onChange} />
			)}

			{error && (
				<div className="form--CpsFormFieldSettingError">
					<CircleAlert size={14} /> {error}
				</div>
			)}

			<div className="form--CpsFormFieldSettingContentHeader">
				<SelectFieldSettingHeader
					field={field as IOptionsField}
					setInEditing={setInOptionsEditing}
				/>
			</div>

			{field.type !== FormFieldType.DATABASE && (
				<div className="form--CpsFormFieldSettingControlPreview">
					{isOptionsEditing ? (
						<CpsFormSelectFieldSetting
							field={field as IOptionsField}
							onFieldChange={onChange}
						/>
					) : (
						<CpsFormFieldControl
							field={field}
							value={field.defaultValue}
							onValueChange={(v) => {
								const newField = { ...field, defaultValue: v };
								onChange(newField);
							}}
						/>
					)}
				</div>
			)}

			{field.type === FormFieldType.DATABASE && (
				<div className="form--CpsFormFieldSettingDatabase">
					<CpsFormDatabaseFieldSetting field={field} onChange={onChange} />
				</div>
			)}
		</div>
	);
}
