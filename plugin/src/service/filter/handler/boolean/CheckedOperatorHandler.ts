import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

/**
 * Checked（已选中）操作符处理器
 * 用于判断 CHECKBOX/TOGGLE 字段是否为选中状态
 */
export class CheckedOperatorHandler implements OperatorHandler {

    accept(filter: Filter) {
        return filter.operator === OperatorType.Checked;
    }

    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
        // 将字段值规范化为布尔值
        const boolValue = this.toBooleanValue(fieldValue);
        // 检查是否为 true（选中状态）
        return boolValue === true;
    }

    /**
     * 将任意值转换为布尔值
     */
    private toBooleanValue(value: any): boolean {
        if (value === undefined || value === null) {
            return false;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const lowercased = value.toLowerCase().trim();
            if (lowercased === 'true' || lowercased === '1' || lowercased === 'yes') {
                return true;
            }
            if (lowercased === 'false' || lowercased === '0' || lowercased === 'no' || lowercased === '') {
                return false;
            }
            return true; // 非空字符串视为 true
        }

        if (typeof value === 'number') {
            return value !== 0;
        }

        return Boolean(value);
    }
}
