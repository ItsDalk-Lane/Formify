import { Objects } from "src/utils/Objects";
import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

export class TimeBeforeOrEqualOperatorHandler implements OperatorHandler {
    accept(filter: Filter) {
        return filter.operator === OperatorType.TimeBeforeOrEqual;
    }

    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
        if (Objects.isNullOrUndefined(fieldValue) || Objects.isNullOrUndefined(value)) {
            return false;
        }
        const fieldTime = this.parseTimeValue(fieldValue);
        const compareTime = this.parseTimeValue(value);
        if (fieldTime === null || compareTime === null) {
            return false;
        }
        return fieldTime <= compareTime;
    }

    private parseTimeValue(value: any): number | null {
        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "string") {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
                return date.getTime();
            }
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
                const today = new Date().toISOString().split('T')[0];
                const dateTime = new Date(`${today}T${value}`);
                if (!isNaN(dateTime.getTime())) {
                    return dateTime.getTime();
                }
            }
        }
        if (value instanceof Date) {
            return value.getTime();
        }
        return null;
    }
}

