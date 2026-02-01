import { FormFieldType } from "../enums/FormFieldType";
import { Filter } from "../filter/Filter";
import { IFormField } from "./IFormField";

export enum DatabaseFieldOutputFormat {
    ARRAY = "array",
    STRING = "string",
}

export interface DatabaseFieldSource {
    /** 字段标识（字段 id 或 label） */
    field: string;
    /** 纳入条件，未配置则始终纳入 */
    condition?: Filter;
}

export interface IDatabaseField extends IFormField {
    type: FormFieldType.DATABASE;
    /** 源字段列表，按顺序聚合 */
    sourceFields: DatabaseFieldSource[];
    /** 输出格式：数组或字符串，默认数组 */
    outputFormat?: DatabaseFieldOutputFormat;
}
