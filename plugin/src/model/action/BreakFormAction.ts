import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";

export class BreakFormAction extends BaseFormAction {
    type: FormActionType.BREAK;

    constructor(partial?: Partial<BreakFormAction>) {
        super(partial);
        this.type = FormActionType.BREAK;
        Object.assign(this, partial);
    }
}





