import { useMemo } from "react";
import useFormConfig from "src/hooks/useFormConfig";
import { useVariablesWithLoop } from "src/hooks/useVariablesWithLoop";
import { useLoopContext } from "src/context/LoopContext";
import { localInstance } from "src/i18n/locals";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CodeEditor from "./code-editor/CodeEditor";
import { timeTemplatePreviewExtension } from "./code-editor/FormTimeVariableWidget";
import { createFormVariableSuggestions } from "./code-editor/FormVariableSuggest";
import { createFormVariableWidgetExtension } from "./code-editor/FormVariableWidget";

export default function TextAreaContentSettingWithLoop(props: {
	actionId: string;
	content: string;
	placeholder?: string;
	onChange: (value: string) => void;
	isInsideLoop?: boolean; // 是否在循环内部
}) {
	const { actionId, content, onChange, isInsideLoop = false } = props;
	const formConfig = useFormConfig();
	const loopContext = useLoopContext();
	const fieldNames = useVariablesWithLoop(actionId, formConfig, isInsideLoop, loopContext.loopType);
	const extensionKey = useMemo(() => {
		return fieldNames.map((f) => f.label).join("|");
	}, [fieldNames]);

	const variableWidgetExtension = useMemo(() => {
		return createFormVariableWidgetExtension(fieldNames);
	}, [extensionKey]);

	const editorExtensions = useMemo(() => {
		return [
			...variableWidgetExtension,
			createFormVariableSuggestions(fieldNames),
			timeTemplatePreviewExtension,
		];
	}, [fieldNames, variableWidgetExtension]);

	return (
		<CpsFormItem
			label={localInstance.text_content}
			style={{
				flexDirection: "column",
				alignItems: "initial",
			}}
		>
			<CodeEditor
				height="500px"
				initialValue={content || ""}
				onChange={(value) => {
					onChange(value);
				}}
				language="markdown"
				extensions={editorExtensions}
				extensionsKey={extensionKey}
			/>
		</CpsFormItem>
	);
}