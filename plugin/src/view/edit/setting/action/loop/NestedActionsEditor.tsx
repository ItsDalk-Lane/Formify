import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { FormConfig } from "src/model/FormConfig";
import { LoopType } from "src/model/enums/LoopType";
import { CpsFormActions } from "../CpsFormActions";
import { LoopProvider } from "src/contexts/LoopContext";

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

	// 循环上下文值
	const baseLoopVariables = [
		loopAction.indexVariableName || "index",
	];

	// 非条件循环才添加item和total变量
	if (loopAction.loopType !== LoopType.CONDITION) {
		baseLoopVariables.push(
			loopAction.itemVariableName || "item",
			loopAction.totalVariableName || "total"
		);
	}

	const loopContextValue = {
		isInsideLoop: true,
		loopVariables: baseLoopVariables,
		loopType: loopAction.loopType
	};

	return (
		<div className="form--LoopNestedActions">
			<div className="form--LoopNestedActionsHeader">
				<div className="form--LoopNestedActionsTitle">
					{localInstance.loop_nested_actions}
				</div>
			</div>

			<LoopProvider value={loopContextValue}>
				<CpsFormActions config={nestedConfig} onChange={onActionsChange} />
			</LoopProvider>
		</div>
	);
}

