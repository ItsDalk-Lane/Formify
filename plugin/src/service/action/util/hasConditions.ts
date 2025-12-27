import { IFormAction } from "src/model/action/IFormAction";
import { FilterType } from "src/model/filter/Filter";

/**
 * 检查动作是否具有有效的执行条件
 * @param action 表单动作
 * @returns 是否有有效条件
 */
export function hasConditions(action: IFormAction): boolean {
    // 没有条件配置
    if (!action.condition) {
        return false;
    }

    // 条件数组为空或未定义
    if (!action.condition.conditions || action.condition.conditions.length === 0) {
        return false;
    }

    // 递归检查条件是否包含有效的过滤条件
    return hasValidFilters(action.condition.conditions);
}

/**
 * 递归检查条件数组中是否包含有效的过滤条件
 * @param conditions 条件数组
 * @returns 是否包含有效过滤条件
 */
function hasValidFilters(conditions: any[]): boolean {
    if (!conditions || conditions.length === 0) {
        return false;
    }

    return conditions.some(condition => {
        // 如果是组类型，递归检查子条件
        if (condition.type === FilterType.group) {
            return hasValidFilters(condition.conditions || []);
        }

        // 如果是时间条件、文件条件或脚本条件，检查是否有扩展配置
        if (condition.type === FilterType.timeCondition || 
            condition.type === FilterType.fileCondition ||
            condition.type === FilterType.scriptCondition) {
            return !!condition.extendedConfig;
        }

        // 如果是过滤条件，检查是否有有效的属性和操作符
        return condition.property && condition.operator;
    });
}
