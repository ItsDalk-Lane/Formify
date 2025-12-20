import { useMemo } from "react";
import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { localInstance } from "src/i18n/locals";
import CpsFormItem from "src/view/shared/CpsFormItem";
import useFormConfig from "src/hooks/useFormConfig";
import { useVariables } from "src/hooks/useVariables";
import { useVariablesWithLoop } from "src/hooks/useVariablesWithLoop";
import { useLoopContext } from "src/context/LoopContext";
import CodeEditor from "../common/code-editor/CodeEditor";
import { timeTemplatePreviewExtension } from "../common/code-editor/FormTimeVariableWidget";
import { createFormVariableSuggestions } from "../common/code-editor/FormVariableSuggest";
import { createFormVariableWidgetExtension } from "../common/code-editor/FormVariableWidget";

export function OpenUrlSetting(props: {
	value: ButtonFormAction;
	onChange: (value: ButtonFormAction) => void;
}) {
	const { value } = props;
	const formConfig = useFormConfig();
	const loopContext = useLoopContext();
	const isInsideLoop = loopContext.isInsideLoop;

	// 根据是否在循环内选择合适的hook
	const fieldNames = isInsideLoop
		? useVariablesWithLoop(value.id, formConfig, isInsideLoop, loopContext.loopType)
		: useVariables(value.id, formConfig);

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

	const handleUrlChange = (url: string) => {
		const newAction: ButtonFormAction = {
			...value,
			url,
		};
		props.onChange(newAction);
	};

	return (
		<CpsFormItem
			label={localInstance.url}
			style={{
				flexDirection: "column",
				alignItems: "initial",
			}}
		>
			<CodeEditor
				height="40px"
				initialValue={value.url || ""}
				onChange={handleUrlChange}
				placeholder="https://example.com"
				language="text"
				extensions={editorExtensions}
				extensionsKey={extensionKey}
			/>
		</CpsFormItem>
	);
}
