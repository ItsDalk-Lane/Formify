import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { LoopContinueError } from "./LoopControlError";

export class ContinueActionService implements IActionService {
    accept(action: IFormAction): boolean {
        return action.type === FormActionType.CONTINUE;
    }

    async run(action: IFormAction, context: ActionContext, _chain: ActionChain): Promise<void> {
        if (!context.loopContext?.canContinue) {
            throw new Error(localInstance.loop_continue_outside_error);
        }

        context.loopContext.continueRequested = true;
        context.loopContext.breakRequested = false;

        throw new LoopContinueError();
    }
}

