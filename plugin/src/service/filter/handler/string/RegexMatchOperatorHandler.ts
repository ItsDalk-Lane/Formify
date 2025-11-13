import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

type RegexValue = { pattern: string; flags?: string } | string;

export class RegexMatchOperatorHandler implements OperatorHandler {
    accept(filter: Filter) {
        return filter.operator === OperatorType.RegexMatch;
    }

    apply(fieldValue: any, value: RegexValue, context: OperatorHandleContext): boolean {
        const v = this.toArray(fieldValue);
        const r = this.buildRegex(value);
        if (!r) {
            return false;
        }
        for (const item of v) {
            if (typeof item === 'string' && r.test(item)) {
                return true;
            }
        }
        return false;
    }

    private toArray(value: any): any[] {
        if (Array.isArray(value)) return value;
        if (value === undefined || value === null) return [];
        return [value];
    }

    private buildRegex(value: RegexValue): RegExp | null {
        try {
            if (typeof value === 'string') {
                return new RegExp(value);
            }
            if (!value || !value.pattern) {
                return null;
            }
            return new RegExp(value.pattern, value.flags || undefined);
        } catch {
            return null;
        }
    }
}

