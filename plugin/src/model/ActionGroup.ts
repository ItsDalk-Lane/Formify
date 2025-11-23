import { v4 } from "uuid";
import { ErrorHandlingStrategy } from "./enums/ErrorHandlingStrategy";
import { IFormAction } from "./action/IFormAction";

export class ActionGroup {
    id: string;
    name?: string;
    actions: IFormAction[];
    errorHandlingStrategy?: ErrorHandlingStrategy;

    constructor(partial?: Partial<ActionGroup>) {
        this.id = v4();
        this.actions = [];
        Object.assign(this, partial);
    }
}


