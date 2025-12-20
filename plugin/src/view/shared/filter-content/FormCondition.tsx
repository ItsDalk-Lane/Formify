import { Select2 } from "src/component/select2/Select";
import useFormConfig from "src/hooks/useFormConfig";
import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { useFormField } from "../../edit/setting/field/hooks/FormFieldContext";
import { ConditionOperator } from "./ConditionOperator";
import { ConditionValue } from "./ConditionValue";
import "./FormCondition.css";
import { normalizeValue } from "./util/normalizeValue";
import { useLoopContext } from "src/context/LoopContext";
import { useVariablesWithLoop, VariableItem } from "src/hooks/useVariablesWithLoop";
import { useMemo, useRef, useEffect } from "react";

export function FormCondition(props: {
	filter: Filter;
	onChange: (filter: Filter) => void;
}) {
	const { filter, onChange } = props;
	const formConfig = useFormConfig();
	const formField = useFormField();
	const isMountedRef = useRef(true);

	// 组件卸载时标记
	useEffect(() => {
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// 安全的onChange函数，防止组件卸载后调用
	const safeOnChange = (newFilter: Filter) => {
		if (isMountedRef.current) {
			onChange(newFilter);
		}
	};

	// 安全获取循环上下文
	let loopContext: any = null;
	try {
		loopContext = useLoopContext();
	} catch (error) {
		// 如果不在循环上下文中，使用默认值
		console.debug("[FormCondition] Not in loop context:", error);
		loopContext = { isInsideLoop: false };
	}

	// 获取循环变量，避免在useMemo内部调用hook
	let variables: VariableItem[] = [];
	try {
		variables = useVariablesWithLoop(
			"", // actionId, 对于条件判断可能不需要特定actionId
			formConfig,
			loopContext?.isInsideLoop || false,
			loopContext?.loopType
		) || [];
	} catch (error) {
		console.error("[FormCondition] Error getting variables:", error);
		variables = [];
	}

	// 获取包含循环变量的选项列表
	const allOptions = useMemo(() => {
		try {
			// 转换为Select2需要的格式
			const formFields = (formConfig?.fields || [])
				.filter((f) => (formField ? f.id !== formField.field.id : true))
				.map((f) => ({
					label: f.label,
					value: f.id,
					info: f.description,
				}));

			// 添加循环变量选项（仅在循环内部）
			const loopVarOptions = (loopContext?.isInsideLoop ? variables : [])
				.filter(v => v && v.type === "loop")
				.map(v => ({
					label: v.label,
					value: v.label,
					info: v.info,
				}));

			// 合并选项，循环变量优先显示
			return [...loopVarOptions, ...formFields];
		} catch (error) {
			console.error("[FormCondition] Error generating options:", error);
			// 发生错误时只返回表单字段
			return (formConfig?.fields || [])
				.filter((f) => (formField ? f.id !== formField.field.id : true))
				.map((f) => ({
					label: f.label,
					value: f.id,
					info: f.description,
				}));
		}
	}, [formConfig?.fields, formField, variables, loopContext?.isInsideLoop]);

	const hideValue =
		filter.operator === OperatorType.HasValue ||
		filter.operator === OperatorType.NoValue ||
		filter.operator === OperatorType.Checked ||
		filter.operator === OperatorType.Unchecked;

	return (
		<>
			<Select2
				value={filter.property || ""}
				onChange={(value) => {
					const newFilter = {
						...filter,
						property: value,
					};
					safeOnChange(newFilter);
				}}
				options={allOptions}
			/>
			<ConditionOperator
				propertyId={filter.property || ""}
				operator={filter.operator}
				onChange={(operator) => {
					const newFilter = {
						...filter,
						operator: operator,
						value: normalizeValue(operator, filter.value),
					};
					safeOnChange(newFilter);
				}}
			/>

			{!hideValue && (
				<ConditionValue
					filter={filter}
					value={filter.value}
					onChange={(value) => {
						const newFilter = {
							...filter,
							value: value,
						};
						safeOnChange(newFilter);
					}}
				/>
			)}
		</>
	);
}
