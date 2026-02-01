import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { DatabaseFieldOutputFormat } from "src/model/field/IDatabaseField";

export function applyFieldTypeChange(
    field: IFormField,
    nextType: FormFieldType
): IFormField {
    if (field.type === nextType) {
        return field;
    }

    const nextField: any = {
        ...field,
        type: nextType,
    };

    if (nextType === FormFieldType.DATABASE) {
        nextField.sourceFields = [];
        nextField.outputFormat = DatabaseFieldOutputFormat.ARRAY;
        nextField.defaultValue = [];
        return nextField as IFormField;
    }

    if (field.type === FormFieldType.DATABASE) {
        delete nextField.sourceFields;
        delete nextField.outputFormat;
    }

    return nextField as IFormField;
}
