import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";

export class ContinueFormAction extends BaseFormAction {
    type: FormActionType.CONTINUE;

    constructor(partial?: Partial<ContinueFormAction>) {
        super(partial);
        this.type = FormActionType.CONTINUE;
        Object.assign(this, partial);
    }
}







