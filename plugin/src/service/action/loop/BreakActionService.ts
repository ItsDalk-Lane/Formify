import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { LoopBreakError } from "./LoopControlError";

export class BreakActionService implements IActionService {
    accept(action: IFormAction): boolean {
        return action.type === FormActionType.BREAK;
    }

    async run(action: IFormAction, context: ActionContext, _chain: ActionChain): Promise<void> {
        if (!context.loopContext?.canBreak) {
            throw new Error(localInstance.loop_break_outside_error);
        }

        context.loopContext.breakRequested = true;
        context.loopContext.continueRequested = false;

        throw new LoopBreakError();
    }
}

