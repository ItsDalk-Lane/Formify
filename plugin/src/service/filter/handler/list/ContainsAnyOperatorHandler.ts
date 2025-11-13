import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

export class ContainsAnyOperatorHandler implements OperatorHandler {
    accept(filter: Filter) {
        return filter.operator === OperatorType.ContainsAny;
    }

    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
        const fv = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
        const val = Array.isArray(value) ? value : [value];
        const set = new Set(fv);
        for (const v of val) {
            if (set.has(v)) {
                return true;
            }
        }
        return false;
    }
}

