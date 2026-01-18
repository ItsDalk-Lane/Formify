import { IFormAction } from "src/model/action/IFormAction";
import { RunScriptFormAction, ScriptSourceType } from "src/model/action/RunScriptFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { ScriptExecutionService } from "src/service/ScriptExecutionService";

export default class RunScriptActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.RUN_SCRIPT;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<any> {
        const scriptAction = action as RunScriptFormAction;
        const state = context.state;
        const extraContext = {
            form: state.values,
        }
        const scriptService = new ScriptExecutionService(context.app);

        if (scriptAction.scriptSource === ScriptSourceType.INLINE) {
            const result = await scriptService.executeScript({
                source: "form-inline",
                script: scriptAction.code,
                context: extraContext,
            });
            if (!result.success) {
                throw new Error(result.error || "Invalid script code");
            }
        } else {
            const result = await scriptService.executeScript({
                source: "form-expression",
                script: scriptAction.expression,
                context: extraContext,
            });
            if (!result.success) {
                throw new Error(result.error || "Invalid script expression");
            }
        }

        // do next
        if (chain) {
            return await chain.next(context);
        }
    }

}