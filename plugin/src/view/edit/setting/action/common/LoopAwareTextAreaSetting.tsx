import { useMemo } from "react";
import useFormConfig from "src/hooks/useFormConfig";
import { useVariablesWithLoop } from "src/hooks/useVariablesWithLoop";
import { useLoopContext } from "src/contexts/LoopContext";
import { localInstance } from "src/i18n/locals";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CodeEditor from "./code-editor/CodeEditor";
import { timeTemplatePreviewExtension } from "./code-editor/FormTimeVariableWidget";
import { createFormVariableSuggestions } from "./code-editor/FormVariableSuggest";
import { formVariableExtension } from "./code-editor/FormVariableWidget";
import { internalFieldNames } from "./variable-quoter/InternalVariablePopover";

export default function LoopAwareTextAreaSetting(props: {
	actionId: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
	label?: string;
	required?: boolean;
	description?: string;
}) {
	const { actionId, value, onChange, placeholder, label, required, description } = props;
	const formConfig = useFormConfig();
	const loopContext = useLoopContext();
	const isInsideLoop = loopContext.isInsideLoop;

	const internalVariableNames = internalFieldNames.map((f) => {
		return {
			label: f.name,
			detail: f.description,
		};
	});

	// 根据是否在循环内选择合适的hook
	const fieldNames = isInsideLoop
		? useVariablesWithLoop(actionId, formConfig, isInsideLoop)
		: [] as any; // 非循环时暂时用空数组，避免类型错误

	const extensionKey = useMemo(() => {
		return fieldNames.map((f: any) => f.label).join("|");
	}, [fieldNames]);

	const editorExtensions = useMemo(() => {
		return [
			formVariableExtension,
			createFormVariableSuggestions(fieldNames),
			timeTemplatePreviewExtension,
		];
	}, [fieldNames]);

	return (
		<CpsFormItem
			label={label || localInstance.text_content}
			description={description}
			required={required}
			style={{
				flexDirection: "column",
				alignItems: "initial",
			}}
		>
			<CodeEditor
				height="150px"
				initialValue={value || ""}
				onChange={(value) => {
					onChange(value);
				}}
				language="markdown"
				extensions={editorExtensions}
				extensionsKey={extensionKey}
				placeholder={placeholder}
			/>
		</CpsFormItem>
	);
}