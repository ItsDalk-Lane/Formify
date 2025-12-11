import { Objects } from "src/utils/Objects";
import { Strings } from "src/utils/Strings";
import { OperatorHandlers } from "./handler/OperatorHandlers";
import { Filter, FilterType } from "src/model/filter/Filter";
import { RelationType, OperatorType } from "src/model/filter/OperatorType";
import { IFormField } from "src/model/field/IFormField";
import { FieldValueReaderFactory } from "src/service/field-value/FieldValueReaderFactory";

export class FilterService {

    /**
     * 匹配条件（带字段定义支持）
     * @param root 条件根节点
     * @param getFieldValue 获取字段值的函数
     * @param getValue 获取条件值的函数
     * @param fieldDefinitions 字段定义数组（可选）
     * @returns 是否匹配
     */
    static match(
        root: Filter,
        getFieldValue: (property?: string) => any,
        getValue: (value?: any) => any,
        fieldDefinitions?: IFormField[]
    ): boolean {

        if (!root) {
            return true;
        }

        if (root.type === FilterType.group) {
            if (!root.conditions || root.conditions.length === 0) {
                return true;
            }

            const relation = root.operator as RelationType;
            if (relation === OperatorType.And) {
                return root.conditions.every((condition) => {
                    return FilterService.match(condition, getFieldValue, getValue, fieldDefinitions);
                });
            } else {
                return root.conditions.some((condition) => {
                    return FilterService.match(condition, getFieldValue, getValue, fieldDefinitions);
                });
            }
        } else {
            if (Strings.isEmpty(root.property)) {
                return true;
            }
            if (Objects.isNullOrUndefined(root.operator)) {
                return true;
            }

            // 获取字段定义
            const fieldDef = fieldDefinitions?.find(f => f.id === root.property);

            // 获取字段值和条件值
            let fieldValue = getFieldValue(root.property);
            let conditionValue = getValue(root.value);

            // 如果有字段定义，使用FieldValueReader规范化值
            if (fieldDef) {
                const reader = FieldValueReaderFactory.getReader(fieldDef.type);
                fieldValue = reader.getFieldValue(fieldDef, fieldValue);
                conditionValue = reader.getFieldValue(fieldDef, conditionValue);

                // 传递字段定义和读取器给操作符处理器
                const result = OperatorHandlers.apply(root, fieldValue, conditionValue, {
                    fieldDefinition: fieldDef,
                    valueReader: reader
                });

                return result;
            }

            // 向后兼容：如果没有字段定义，使用原始比较逻辑
            const result = OperatorHandlers.apply(root, fieldValue, conditionValue);
            return result;
        }
    }

}