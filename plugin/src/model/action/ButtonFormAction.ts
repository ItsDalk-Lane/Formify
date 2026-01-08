import { FormActionType } from "../enums/FormActionType";
import { ButtonActionType } from "../enums/ButtonActionType";
import { OpenPageInType } from "../enums/OpenPageInType";
import { FormExecutionMode } from "../enums/FormExecutionMode";
import { FormDisplayMode } from "../enums/FormDisplayMode";
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
    
    /**
     * 多表单执行模式
     * - sequential: 依次执行（默认），每个表单的动作链完整执行完成后才执行下一个
     * - parallel: 同时执行，所有表单的动作链并行执行
     */
    formExecutionMode?: FormExecutionMode;
    
    /**
     * 多表单界面显示模式
     * - single: 逐个打开（默认），表单依次显示
     * - merged: 合并显示，所有表单字段合并到一个模态框中
     * 注意：当 formExecutionMode 为 parallel 时，此选项强制为 merged
     */
    formDisplayMode?: FormDisplayMode;

    constructor(partial?: Partial<ButtonFormAction>) {
        super(partial);
        this.type = FormActionType.BUTTON;
        this.buttonActionType = ButtonActionType.OPEN_URL; // 默认值
        Object.assign(this, partial);
    }
}
