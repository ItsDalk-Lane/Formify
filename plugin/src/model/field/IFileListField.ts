import { FormFieldType } from "../enums/FormFieldType";
import { IFormField } from "./IFormField";

export interface IFileListField extends IFormField {
    type: FormFieldType.FILE_LIST;
    internalLink?: boolean;
    multiple?: boolean;
    extractContent?: boolean; // 是否提取文件内容而非存储路径
    includeMetadata?: boolean; // 提取内容时是否包含元数据(YAML Frontmatter)
    folderPath?: string; // 限制文件选择范围的文件夹路径
}