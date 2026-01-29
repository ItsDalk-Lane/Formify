import { CircleAlert, Network } from "lucide-react";
import { useMemo, useState } from "react";
import { v4 } from "uuid";
import CpsFormSelectFieldSetting from "../select/CpsFormSelectFieldSetting";
import "./CpsFormFieldSettingContent.css";
import { DescriptionSetting } from "./description/DescriptionSetting";
import { SelectFieldSettingHeader } from "./SelectFieldSettingHeader";
import Dialog2 from "src/component/dialog/Dialog2";
import { FilterRoot } from "src/component/filter/FilterRoot";
import { localInstance } from "src/i18n/locals";
import { IFormField } from "src/model/field/IFormField";
import { IOptionsField } from "src/model/field/ISelectField";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { FormValidator } from "src/service/validator/FormValidator";
import { CpsFormFieldControl } from "src/view/shared/control/CpsFormFieldControl";
import { FormCondition } from "src/view/shared/filter-content/FormCondition";

export function CpsFormFieldSettingContent(props: {
	field: IFormField;
	onChange: (field: IFormField) => void;
}) {
	const { field, onChange } = props;
	const [openCondition, setOpenCondition] = useState(false);
	const [isOptionsEditing, setInOptionsEditing] = useState(false);
	const condition: Filter = field.condition ?? {
		id: v4(),
		type: FilterType.group,
		operator: OperatorType.And,
		conditions: [],
	};

	const fieldConditionLength = useMemo(() => {
		if (!field.condition || !field.condition.conditions) {
			return 0;
		}

		// 递归计算实际有效的过滤条件数量
		const countValidFilters = (conditions: any[]): number => {
			if (!conditions || conditions.length === 0) {
				return 0;
			}

			return conditions.reduce((count, condition) => {
				if (condition.type === FilterType.group) {
					// 递归计算组内的条件
					return count + countValidFilters(condition.conditions || []);
				} else if (condition.type === FilterType.timeCondition ||
					condition.type === FilterType.fileCondition ||
					condition.type === FilterType.scriptCondition) {
					// 时间条件、文件条件或脚本条件视为有效条件
					return condition.extendedConfig ? count + 1 : count;
				} else if (condition.type === FilterType.filter) {
					// 字段过滤条件，检查是否有有效的属性和操作符
					return (condition.property && condition.operator) ? count + 1 : count;
				}
				return count;
			}, 0);
		};

		return countValidFilters(field.condition.conditions);
	}, [field.condition]);

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
				<button
					className="form--VisibilityConditionButton"
					data-has-condition={fieldConditionLength > 0}
					onClick={() => {
						setOpenCondition(true);
					}}
				>
					<Network size={14} />
					{localInstance.visibility_condition}
					{fieldConditionLength > 0 && ` + ${fieldConditionLength}`}
				</button>
				<SelectFieldSettingHeader
					field={field as IOptionsField}
					setInEditing={setInOptionsEditing}
				/>
			</div>

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
			<Dialog2
				open={openCondition}
				onOpenChange={function (open: boolean): void {
					setOpenCondition(open);
				}}
			>
				{(close) => {
					return (
						<FilterRoot
							filter={condition}
							onFilterChange={(filter: Filter) => {
								const newField = {
									...field,
									condition: filter,
								};
								onChange(newField);
							}}
							filterContentComponent={FormCondition}
						/>
					);
				}}
			</Dialog2>
		</div>
	);
}
