import { IFormAction } from "src/model/action/IFormAction";
import { GenerateFormAction } from "src/model/action/OpenFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { localInstance } from "src/i18n/locals";
import FormModal from "./FormModal";

export default class GenerateFormActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.GENERATE_FORM;
    }

    async run(action: IFormAction, context: ActionContext, _chain: ActionChain): Promise<void> {
        const state = context.state;
        const formAction = action as GenerateFormAction;
        return new Promise((resolve, reject) => {
            const modal = new FormModal(context.app,
                formAction.fields || [],
                async (value) => {
                    state.values = {
                        ...state.values,
                        ...value,
                    }
                    resolve();
                },
                () => {
                    reject(new Error(localInstance.cancel));
                }
            )
            modal.open();
        })
    }

}
