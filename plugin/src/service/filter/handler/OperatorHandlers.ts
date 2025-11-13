import { Filter } from "src/model/filter/Filter";
import { EqOperatorHandler } from "./common/EqOperatorHandler";
import { HasValueOperatorHandler } from "./common/HasValueOperatorHandler";
import { NotEqOperatorHandler } from "./common/NotEqOperatorHandler";
import { NoValueOperatorHandler } from "./common/NoValueOperatorHandler";
import { ContainsOperatorHandler } from "./list/ContainsOperatorHandler";
import { NotContainsOperatorHandler } from "./list/NotContainsOperatorHandler";
import { ContainsAnyOperatorHandler } from "./list/ContainsAnyOperatorHandler";
import { GteOperatorHandler } from "./number/GteOperatorHandler";
import { GtOperatorHandler } from "./number/GtOperatorHandler";
import { LteOperatorHandler } from "./number/LteOperatorHandler";
import { LtOperatorHandler } from "./number/LtOperatorHandler";
import { TimeBeforeOperatorHandler } from "./time/TimeBeforeOperatorHandler";
import { TimeAfterOperatorHandler } from "./time/TimeAfterOperatorHandler";
import { TimeBeforeOrEqualOperatorHandler } from "./time/TimeBeforeOrEqualOperatorHandler";
import { TimeAfterOrEqualOperatorHandler } from "./time/TimeAfterOrEqualOperatorHandler";
import { RegexMatchOperatorHandler } from "./string/RegexMatchOperatorHandler";
import { FileContainsOperatorHandler } from "./file/FileContainsOperatorHandler";
import { ArrayLengthEqualsOperatorHandler } from "./array/ArrayLengthEqualsOperatorHandler";
import { ArrayLengthGreaterOperatorHandler } from "./array/ArrayLengthGreaterOperatorHandler";
import { ArrayLengthLessOperatorHandler } from "./array/ArrayLengthLessOperatorHandler";

export class OperatorHandlers {

    static handlers = [
        new EqOperatorHandler(),
        new NotEqOperatorHandler(),
        new GtOperatorHandler(),
        new GteOperatorHandler(),
        new LtOperatorHandler(),
        new LteOperatorHandler(),
        new ContainsOperatorHandler(),
        new ContainsAnyOperatorHandler(),
        new NotContainsOperatorHandler(),
        new HasValueOperatorHandler(),
        new NoValueOperatorHandler(),
        new RegexMatchOperatorHandler(),
        new FileContainsOperatorHandler(),
        new ArrayLengthEqualsOperatorHandler(),
        new ArrayLengthGreaterOperatorHandler(),
        new ArrayLengthLessOperatorHandler(),
        new TimeBeforeOperatorHandler(),
        new TimeAfterOperatorHandler(),
        new TimeBeforeOrEqualOperatorHandler(),
        new TimeAfterOrEqualOperatorHandler()
        // new InOperatorHandler(),
        // new NInOperatorHandler(),
        // new LikeOperatorHandler(),
        // new NotLikeOperatorHandler(),
    ]

    static apply(filter: Filter, fieldValue: any, value: any): boolean {
        const handler = this.handlers.find(h => h.accept(filter));
        if (handler) {
            return handler.apply(fieldValue, value, {
                filter: filter
            });
        }
        return false;
    }
}
