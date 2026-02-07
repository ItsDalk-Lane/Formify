import { FormFieldType } from "../enums/FormFieldType";
import { IFormField } from "./IFormField";

export interface IFolderPathField extends IFormField {
    type: FormFieldType.FOLDER_PATH;
    folderPath?: string; // 限制文件夹选择范围的文件夹路径
}
