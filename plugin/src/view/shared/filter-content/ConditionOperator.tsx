import { useMemo } from "react";
import { SelectOption2, Select2 } from "src/component/select2/Select";
import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { DatabaseFieldOutputFormat, IDatabaseField } from "src/model/field/IDatabaseField";
import { OperatorType } from "src/model/filter/OperatorType";

export function ConditionOperator(props: {
	propertyId: string;
	operator: OperatorType;
	onChange: (operator: OperatorType) => void;
}) {
	const { propertyId, operator, onChange } = props;
	const formConfig = useFormConfig();
	const commomOperators: SelectOption2[] = [
		{
			value: OperatorType.Equals,
			label: localInstance.equal,
		},
		{
			value: OperatorType.NotEquals,
			label: localInstance.not_equal,
		},
	];

	const numberOperators: SelectOption2[] = [
		{
			value: OperatorType.GreaterThan,
			label: localInstance.greater_than,
		},
		{
			value: OperatorType.GreaterThanOrEqual,
			label: localInstance.greater_than_or_equal,
		},
		{
			value: OperatorType.LessThan,
			label: localInstance.less_than,
		},
		{
			value: OperatorType.LessThanOrEqual,
			label: localInstance.less_than_or_equal,
		},
	];

	const checkedOperators: SelectOption2[] = [
		{
			value: OperatorType.Checked,
			label: localInstance.checked,
		},
		{
			value: OperatorType.Unchecked,
			label: localInstance.unchecked,
		},
	];

	const valueOperators = [
		{
			value: OperatorType.HasValue,
			label: localInstance.has_value,
		},
		{
			value: OperatorType.NoValue,
			label: localInstance.no_value,
		},
	];

    const timeOperators = [
        {
            value: OperatorType.TimeBefore,
            label: localInstance.time_before,
        },
        {
            value: OperatorType.TimeBeforeOrEqual,
            label: (localInstance as any).time_before_or_equal ?? localInstance.time_before,
        },
        {
            value: OperatorType.TimeAfter,
            label: localInstance.time_after,
        },
        {
            value: OperatorType.TimeAfterOrEqual,
            label: (localInstance as any).time_after_or_equal ?? localInstance.time_after,
        },
    ];

    const listOperators = [
        {
            value: OperatorType.Contains,
            label: localInstance.contains,
        },
        {
            value: OperatorType.ContainsAny,
            label: (localInstance as any).contains_any ?? localInstance.contains,
        },
        {
            value: OperatorType.NotContains,
            label: localInstance.not_contains,
        },
    ];

  const options = useMemo(() => {
    const field = formConfig.fields.find((f) => f.id === propertyId);
		if (field?.type === FormFieldType.NUMBER) {
			return [...commomOperators, ...numberOperators, ...valueOperators];
		}
		if (
			field?.type === FormFieldType.CHECKBOX ||
			field?.type === FormFieldType.TOGGLE
		) {
			return [...commomOperators, ...checkedOperators];
		}

		// 日期时间类型字段支持时间比较符
    if (
            field?.type === FormFieldType.DATE ||
            field?.type === FormFieldType.TIME ||
            field?.type === FormFieldType.DATETIME
        ) {
            return [...commomOperators, ...timeOperators, ...valueOperators];
        }

    if (field?.type === FormFieldType.DATABASE) {
            const databaseField = field as IDatabaseField;
            const outputFormat = databaseField.outputFormat;
            if (outputFormat === DatabaseFieldOutputFormat.STRING) {
                return [...commomOperators, ...valueOperators];
            }
            return [
                ...commomOperators,
                ...listOperators,
                { value: OperatorType.ArrayLengthEquals, label: localInstance.equal },
                { value: OperatorType.ArrayLengthGreater, label: localInstance.greater_than },
                { value: OperatorType.ArrayLengthLess, label: localInstance.less_than },
                ...valueOperators,
            ];
        }

    const isList = [FormFieldType.SELECT, FormFieldType.RADIO].includes(
      field?.type as FormFieldType
    );
    if (isList) {
            return [
                ...commomOperators,
                ...listOperators,
                { value: OperatorType.ArrayLengthEquals, label: localInstance.equal },
                { value: OperatorType.ArrayLengthGreater, label: localInstance.greater_than },
                { value: OperatorType.ArrayLengthLess, label: localInstance.less_than },
                ...valueOperators,
            ];
    }

        if (field?.type === FormFieldType.FILE_LIST) {
            return [
                ...commomOperators,
                { value: OperatorType.Contains, label: localInstance.contains },
                { value: OperatorType.RegexMatch, label: (localInstance as any).regex_match ?? 'Regex' },
                { value: OperatorType.FileContains, label: localInstance.content },
                { value: OperatorType.ArrayLengthEquals, label: localInstance.equal },
                { value: OperatorType.ArrayLengthGreater, label: localInstance.greater_than },
                { value: OperatorType.ArrayLengthLess, label: localInstance.less_than },
                ...valueOperators,
            ];
        }

    if (field?.type === FormFieldType.TEXT || field?.type === FormFieldType.TEXTAREA) {
            return [
                ...commomOperators,
                { value: OperatorType.RegexMatch, label: (localInstance as any).regex_match ?? 'Regex' },
                ...valueOperators,
            ];
        }

        return [...commomOperators, ...valueOperators];
	}, [propertyId, formConfig]);

	return <Select2 value={operator} onChange={onChange} options={options} />;
}
