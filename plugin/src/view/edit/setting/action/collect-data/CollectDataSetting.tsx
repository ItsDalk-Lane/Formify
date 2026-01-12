import React from "react";
import { IFormAction } from "src/model/action/IFormAction";
import { CollectDataFormAction } from "src/model/action/CollectDataFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { StorageMode } from "src/model/enums/StorageMode";
import { VariableType } from "src/model/enums/VariableType";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import { localInstance } from "src/i18n/locals";
import LoopAwareTextAreaSetting from "../common/LoopAwareTextAreaSetting";

type CollectDataSettingProps = {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
};

export function CollectDataSetting(props: CollectDataSettingProps) {
	const { value, onChange } = props;

	if (value.type !== FormActionType.COLLECT_DATA) {
		return null;
	}

	const action = value as CollectDataFormAction;

	const storageModeOptions: SelectOption2[] = [
		{
			label: localInstance.collect_data_storage_mode_append,
			value: StorageMode.APPEND,
		},
		{
			label: localInstance.collect_data_storage_mode_replace,
			value: StorageMode.REPLACE,
		},
	];

	const variableTypeOptions: SelectOption2[] = [
		{
			label: localInstance.collect_data_variable_type_string,
			value: VariableType.STRING,
		},
		{
			label: localInstance.collect_data_variable_type_array,
			value: VariableType.ARRAY,
		},
	];

	const handleActionChange = (changes: Partial<CollectDataFormAction>) => {
		const newAction: CollectDataFormAction = {
			...action,
			...changes,
		};
		onChange(newAction);
	};

	return (
		<>
			{/* 输出变量名称 */}
			<CpsFormItem label={localInstance.collect_data_output_variable_name}>
				<input
					type="text"
					value={action.outputVariableName}
					placeholder={localInstance.collect_data_output_variable_name_placeholder}
					onChange={(e) =>
						handleActionChange({ outputVariableName: e.target.value })
					}
				/>
			</CpsFormItem>

			{/* 变量类型 */}
			<CpsFormItem label={localInstance.collect_data_variable_type}>
				<Select2
					value={action.variableType}
					options={variableTypeOptions}
					onChange={(value) =>
						handleActionChange({ variableType: value as VariableType })
					}
				/>
			</CpsFormItem>

			{/* 存储模式 */}
			<CpsFormItem label={localInstance.collect_data_storage_mode}>
				<Select2
					value={action.storageMode}
					options={storageModeOptions}
					onChange={(value) =>
						handleActionChange({ storageMode: value as StorageMode })
					}
				/>
			</CpsFormItem>

			{/* 文本内容 */}
			<LoopAwareTextAreaSetting
				actionId={action.id}
				value={action.content}
				placeholder={localInstance.collect_data_content_placeholder}
				onChange={(content) => handleActionChange({ content })}
				label={localInstance.collect_data_content}
			/>
		</>
	);
}
