import { useMemo } from "react";
import { GenerateFormAction } from "../model/action/OpenFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { AIFormAction } from "../model/action/AIFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { FormConfig } from "../model/FormConfig";
import { VariableSource } from "../types/variable";
import type { VariableItem } from "./useVariablesWithLoop";
import { localInstance } from "src/i18n/locals";

export function useVariables(actionId: string, formConfig: FormConfig) {
	return useMemo(() => {
		const actions = formConfig.actions || [];
		const fields: VariableItem[] = (formConfig.fields || []).map((f) => {
			return {
				label: f.label,
				info: f.description,
				type: "variable",
				source: VariableSource.FORM_FIELD,
				priority: 2,
			};
		});
		const currentIndex = actions.findIndex((a) => a.id === actionId);
		for (let i = currentIndex - 1; i >= 0; i--) {
			const action = actions[i];
			if (action.type === FormActionType.SUGGEST_MODAL) {
				const a = action as SuggestModalFormAction;
				if (fields.find((f) => f.label === a.fieldName)) {
					continue;
				}
				fields.push({
					label: a.fieldName,
					info: "",
					type: "variable",
					source: VariableSource.SUGGEST_MODAL,
					priority: 3,
				});
			}

			if (action.type === FormActionType.GENERATE_FORM) {
				const a = action as GenerateFormAction;
				const afields = a.fields || [];
				afields.forEach((f) => {
					if (!fields.find((ff) => ff.label === f.label)) {
						fields.push({
							label: f.label,
							info: f.description,
							type: "variable",
							source: VariableSource.FORM_FIELD,
							priority: 3,
						});
					}
				});
			}

			if (action.type === FormActionType.AI) {
				const aiAction = action as AIFormAction;
				if (aiAction.outputVariableName && !fields.find((f) => f.label === aiAction.outputVariableName)) {
					fields.push({
						label: aiAction.outputVariableName,
						info: localInstance.ai_output_variable,
						type: "variable",
						source: VariableSource.AI_OUTPUT,
						priority: 4,
					});
				}
			}
		}

		return fields;
	}, [formConfig]);
}

