import { useMemo } from "react";
import { GenerateFormAction } from "../model/action/OpenFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { AIFormAction } from "../model/action/AIFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { LoopType } from "../model/enums/LoopType";
import { FormConfig } from "../model/FormConfig";
import { LoopVariableScope, LoopVariableMeta } from "../utils/LoopVariableScope";
import { VariableSource } from "../types/variable";
import { localInstance } from "src/i18n/locals";

/**
 * 根据循环类型获取对应的循环变量列表
 */
function getLoopVariablesByType(loopType?: LoopType): LoopVariableMeta[] {
    // 基础变量：所有循环类型都有
    const baseVars: LoopVariableMeta[] = [
        { name: "index", description: "当前循环索引（从0开始）", isStandard: true },
        { name: "iteration", description: "当前迭代次数（从1开始）", isStandard: true }
    ];

    if (!loopType) {
        // 如果没有指定循环类型，返回基础变量
        return baseVars;
    }

    switch (loopType) {
        case LoopType.LIST:
            // 列表循环：item, index, total, iteration
            return [
                { name: "item", description: "当前循环元素", isStandard: true },
                ...baseVars,
                { name: "total", description: "循环总次数", isStandard: true }
            ];

        case LoopType.CONDITION:
            // 条件循环：只有 index, iteration（不包含item和total，因为它们在条件循环中无意义）
            return baseVars;

        case LoopType.COUNT:
            // 计数循环：item, index, total, iteration
            return [
                { name: "item", description: "当前计数值", isStandard: true },
                ...baseVars,
                { name: "total", description: "计数目标值", isStandard: true }
            ];

        case LoopType.PAGINATION:
            // 分页循环：item, index, total, iteration, currentPage, pageSize, totalPage
            return [
                { name: "item", description: "当前页数据项", isStandard: true },
                ...baseVars,
                { name: "total", description: "总数据条数", isStandard: true },
                { name: "currentPage", description: "当前页码（从1开始）", isStandard: true },
                { name: "pageSize", description: "每页大小", isStandard: true },
                { name: "totalPage", description: "总页数", isStandard: true }
            ];

        default:
            // 未知循环类型，返回基础变量
            return baseVars;
    }
}

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
    isInsideLoop: boolean = false,
    loopType?: LoopType
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
                // 编辑时：根据循环类型提供模拟数据用于自动补全
                loopVars = getLoopVariablesByType(loopType);
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
    }, [formConfig, actionId, isInsideLoop, loopType]);
}