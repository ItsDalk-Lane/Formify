import { useEffect } from "react";
import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { ActionGroup } from "src/model/ActionGroup";
import { FormConfig } from "src/model/FormConfig";
import { FormActionType } from "src/model/enums/FormActionType";
import { LoopType } from "src/model/enums/LoopType";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";
import { CountConfigForm } from "./CountConfigForm";
import { ListDataSourceInput } from "./ListDataSourceInput";
import { ConditionExpressionInput } from "./ConditionExpressionInput";
import { LoopTypeSelect } from "./LoopTypeSelect";
import { LoopVariableNames } from "./LoopVariableNames";
import { LoopControlConfig } from "./LoopControlConfig";
import { PaginationConfigForm } from "./PaginationConfigForm";
import { NestedActionsEditor } from "./NestedActionsEditor";
import "./LoopSetting.css";

export function LoopSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
	formConfig: FormConfig;
}) {
	const { value, onChange, formConfig } = props;

	if (value.type !== FormActionType.LOOP) {
		return null;
	}

	const loopAction = value as LoopFormAction;

	useEffect(() => {
		if (
			!loopAction.actionGroupId ||
			!formConfig.actionGroups.find((group) => group.id === loopAction.actionGroupId)
		) {
			const newGroup = new ActionGroup();
			formConfig.actionGroups = [...formConfig.actionGroups, newGroup];
			const updatedAction: LoopFormAction = {
				...loopAction,
				actionGroupId: newGroup.id,
			};
			onChange(updatedAction);
		}
	}, [loopAction.actionGroupId, formConfig, loopAction, onChange]);

	const actionGroup = loopAction.actionGroupId
		? formConfig.actionGroups.find((group) => group.id === loopAction.actionGroupId)
		: undefined;

	const handleActionChange = (partial: Partial<LoopFormAction>) => {
		const nextAction: LoopFormAction = {
			...loopAction,
			...partial,
		};
		onChange(nextAction);
	};

	const handleGroupActionsChange = (actions: IFormAction[]) => {
		if (!actionGroup) {
			return;
		}
		actionGroup.actions = actions;
		formConfig.actionGroups = [...formConfig.actionGroups];
		onChange({ ...loopAction });
	};

	const renderLoopContent = () => {
		switch (loopAction.loopType) {
			case LoopType.LIST:
				return (
					<CpsFormItem label={localInstance.loop_data_source} layout="horizontal">
						<ListDataSourceInput
							value={loopAction.listDataSource}
							onChange={(dataSource) => {
								handleActionChange({ listDataSource: dataSource });
							}}
						/>
					</CpsFormItem>
				);
			case LoopType.CONDITION:
				return (
					<CpsFormItem label={localInstance.loop_condition_expression} layout="horizontal">
						<ConditionExpressionInput
							value={loopAction.conditionExpression}
							onChange={(expression) => {
								handleActionChange({ conditionExpression: expression });
							}}
						/>
					</CpsFormItem>
				);
			case LoopType.COUNT:
				return (
					<CountConfigForm
						action={loopAction}
						onChange={(partial) => handleActionChange(partial)}
					/>
				);
			case LoopType.PAGINATION:
				return (
					<PaginationConfigForm
						value={loopAction.paginationConfig}
						onChange={(config) => {
							handleActionChange({ paginationConfig: config });
						}}
					/>
				);
			default:
				return null;
		}
	};

	return (
		<CpsForm layout="horizontal" className="form--LoopSetting">
			<CpsFormItem label={localInstance.loop_type} layout="horizontal">
				<LoopTypeSelect
					value={loopAction.loopType}
					onChange={(loopType) => {
						handleActionChange({ loopType });
					}}
				/>
			</CpsFormItem>

			{renderLoopContent()}

			<LoopVariableNames action={loopAction} onChange={handleActionChange} />

			<LoopControlConfig action={loopAction} onChange={handleActionChange} />

			{actionGroup && (
				<NestedActionsEditor
					loopAction={loopAction}
					formConfig={formConfig}
					actions={actionGroup.actions || []}
					onActionsChange={handleGroupActionsChange}
				/>
			)}
		</CpsForm>
	);
}

