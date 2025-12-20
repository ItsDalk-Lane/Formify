import { useVariablesWithLoop, VariableItem } from "./useVariablesWithLoop";
import { FormConfig } from "../model/FormConfig";

/**
 * 获取当前动作可用的表单变量
 * 
 * 这是 useVariablesWithLoop 的简化版本，不包含循环变量。
 * 用于不需要循环变量支持的场景。
 * 
 * @param actionId - 当前动作的ID
 * @param formConfig - 表单配置
 * @returns 可用的变量列表
 */
export function useVariables(actionId: string, formConfig: FormConfig): VariableItem[] {
	// 委托给 useVariablesWithLoop，传入 isInsideLoop=false 以排除循环变量
	return useVariablesWithLoop(actionId, formConfig, false);
}

