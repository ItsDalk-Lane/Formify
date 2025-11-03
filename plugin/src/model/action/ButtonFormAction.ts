import { FormActionType } from "../enums/FormActionType";
import { ButtonActionType } from "../enums/ButtonActionType";
import { OpenPageInType } from "../enums/OpenPageInType";
import { BaseFormAction } from "./BaseFormAction";

export class ButtonFormAction extends BaseFormAction {
    type: FormActionType.BUTTON;
    buttonActionType: ButtonActionType;
    
    // 用于打开 URL
    url?: string;
    
    // 用于打开文件
    filePath?: string;
    openPageIn?: OpenPageInType;
    
    // 用于提交表单
    formFilePath?: string;

    constructor(partial?: Partial<ButtonFormAction>) {
        super(partial);
        this.type = FormActionType.BUTTON;
        this.buttonActionType = ButtonActionType.OPEN_URL; // 默认值
        Object.assign(this, partial);
    }
}
