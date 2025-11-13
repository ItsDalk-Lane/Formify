import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

export class ArrayLengthLessOperatorHandler implements OperatorHandler {
    accept(filter: Filter) {
        return filter.operator === OperatorType.ArrayLengthLess;
    }
    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
        if (!Array.isArray(fieldValue)) return false;
        const n = typeof value === 'number' ? value : parseInt(String(value));
        if (isNaN(n)) return false;
        return fieldValue.length < n;
    }
}

