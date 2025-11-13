import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";
import { extractContentFromEncodedValue } from "src/view/shared/control/FileListControl";

export class FileContainsOperatorHandler implements OperatorHandler {
    accept(filter: Filter) {
        return filter.operator === OperatorType.FileContains;
    }

    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
        const vals = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
        const needle = Array.isArray(value) ? value[0] : value;
        if (needle === undefined || needle === null) {
            return false;
        }
        const n = String(needle);
        for (const v of vals) {
            const content = extractContentFromEncodedValue(v, true);
            const s = typeof content === 'string' ? content : String(content);
            if (s.includes(n)) {
                return true;
            }
        }
        return false;
    }
}

