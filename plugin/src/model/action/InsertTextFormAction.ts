import { FormActionType } from "../enums/FormActionType";
import { TextInsertPosition } from "../enums/TextInsertPosition";
import { TargetFileType } from "../enums/TargetFileType";
import { FileBaseFormAction } from "./FileBaseFormAction";
import { OpenPageInType } from "../enums/OpenPageInType";

export class InsertTextFormAction extends FileBaseFormAction {

    type: FormActionType.INSERT_TEXT

    openPageIn: OpenPageInType;

    newFileTemplate: string;

    targetFileType: TargetFileType;

    /*
    * position settings
    */
    position: TextInsertPosition;

    heading: string;

    content: string;

    /**
     * 自定义位置模板
     * 用于定位插入位置，使用 {{{content}}} 作为占位符
     * 例如: "## 我的代码\n```javascript\n{{{content}}}\n```"
     */
    positionTemplate: string;

    constructor(partial?: Partial<InsertTextFormAction>) {
        super(partial);
        this.type = FormActionType.INSERT_TEXT;
        this.openPageIn = OpenPageInType.current;
        this.newFileTemplate = "";
        this.targetFileType = TargetFileType.SPECIFIED_FILE;
        this.position = TextInsertPosition.END_OF_CONTENT;
        this.heading = "";
        this.content = "";
        this.positionTemplate = "";
        Object.assign(this, partial);
    }
}

