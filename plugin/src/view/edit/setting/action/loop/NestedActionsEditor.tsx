import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { FormConfig } from "src/model/FormConfig";
import { CpsFormActions } from "../CpsFormActions";

export function NestedActionsEditor(props: {
	loopAction: LoopFormAction;
	formConfig: FormConfig;
	actions: IFormAction[];
	onActionsChange: (actions: IFormAction[]) => void;
}) {
	const { loopAction, formConfig, actions, onActionsChange } = props;

	const nestedConfig = new FormConfig(formConfig.id);
	nestedConfig.fields = formConfig.fields;
	nestedConfig.actions = actions;
	nestedConfig.actionGroups = formConfig.actionGroups;

	const availableVariables = [
		loopAction.itemVariableName || "item",
		loopAction.indexVariableName || "index",
		loopAction.totalVariableName || "total",
	];

	return (
		<div className="form--LoopNestedActions">
			<div className="form--LoopNestedActionsHeader">
				<div className="form--LoopNestedActionsTitle">
					{localInstance.loop_nested_actions}
				</div>
				<div className="form--LoopVariableHint">
					{availableVariables.map((variable) => (
						<span key={variable}>{variable}</span>
					))}
				</div>
			</div>

			<CpsFormActions config={nestedConfig} onChange={onActionsChange} />
		</div>
	);
}

