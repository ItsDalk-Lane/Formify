import { useMemo } from "react";
import { GenerateFormAction } from "../model/action/OpenFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { AIFormAction } from "../model/action/AIFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { FormConfig } from "../model/FormConfig";
import { LoopVariableScope, LoopVariableMeta } from "../utils/LoopVariableScope";
import { VariableSource } from "../types/variable";
import { localInstance } from "src/i18n/locals";

// 定义变量项的类型
export interface VariableItem {
    label: string;
    info?: string;
    detail?: string;
    type: "variable" | "loop";
    source: VariableSource;
    priority: number;
}

export function useVariablesWithLoop(
    actionId: string,
    formConfig: FormConfig,
    isInsideLoop: boolean = false
): VariableItem[] {
    return useMemo(() => {
        const actions = formConfig.actions || [];
        const fields: VariableItem[] = (formConfig.fields || []).map((f) => {
            return {
                label: f.label,
                info: f.description,
                type: "variable",
                source: VariableSource.FORM_FIELD,
                priority: 2
            };
        });

        // 收集动态生成的字段（表单变量）
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
                    priority: 3
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
                            priority: 3
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
                        priority: 4
                    });
                }
            }
        }

        // 收集循环变量（仅在循环内部）
        if (isInsideLoop) {
            let loopVars: LoopVariableMeta[] = [];

            if (LoopVariableScope.isInsideLoop()) {
                // 运行时：从实际作用域获取
                loopVars = LoopVariableScope.getAvailableVariables();
            } else {
                // 编辑时：提供模拟数据用于自动补全
                loopVars = [
                    { name: "item", description: "当前循环元素", isStandard: true },
                    { name: "index", description: "当前循环索引（从0开始）", isStandard: true },
                    { name: "total", description: "循环总次数", isStandard: true },
                    { name: "iteration", description: "当前迭代次数（从1开始）", isStandard: true }
                ];
            }

            // 将循环变量添加到字段列表中
            const loopVariables: VariableItem[] = loopVars.map((meta: LoopVariableMeta) => ({
                label: meta.name,
                info: meta.description || localInstance.loop_variable,
                type: "loop" as const,
                source: VariableSource.LOOP_VAR,
                priority: 0
            }));

            fields.push(...loopVariables);
        }

        return fields;
    }, [formConfig, actionId, isInsideLoop]);
}