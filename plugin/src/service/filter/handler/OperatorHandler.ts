import { Filter } from "src/model/filter/Filter";
import { IFormField } from "src/model/field/IFormField";
import { FieldValueReader } from "src/service/field-value/FieldValueReader";

export interface OperatorHandler {

    accept(filter: Filter): boolean;

    apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean;

}

export interface OperatorHandleContext {
    filter: Filter;
    /**
     * 当前比较的字段定义
     */
    fieldDefinition?: IFormField;
    /**
     * 字段值读取器实例
     */
    valueReader?: FieldValueReader;
}