import { useState, useEffect, useRef, useMemo } from "react";
import { ButtonFormAction } from "src/model/action/ButtonFormAction";
import { localInstance } from "src/i18n/locals";
import CpsFormItem from "src/view/shared/CpsFormItem";
import useFormConfig from "src/hooks/useFormConfig";
import { useVariables } from "src/hooks/useVariables";
import CodeEditor from "../common/code-editor/CodeEditor";
import { timeTemplatePreviewExtension } from "../common/code-editor/FormTimeVariableWidget";
import { createFormVariableSuggestions } from "../common/code-editor/FormVariableSuggest";
import { formVariableExtension } from "../common/code-editor/FormVariableWidget";

export function OpenUrlSetting(props: {
	value: ButtonFormAction;
	onChange: (value: ButtonFormAction) => void;
}) {
	const { value } = props;
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const formConfig = useFormConfig();
	const fieldNames = useVariables(value.id, formConfig);

	// 自动调整 textarea 高度
	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = textarea.scrollHeight + 'px';
		}
	}, [value.url]);

	// 创建变量建议
	const variableSuggestions = useMemo(() => {
		return fieldNames.map(f => ({
			label: f.label,
			info: f.info,
		}));
	}, [fieldNames]);

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const url = e.target.value;
		const newAction: ButtonFormAction = {
			...value,
			url,
		};
		props.onChange(newAction);
	};

	return (
		<>
			<CpsFormItem
				label={localInstance.url}
				style={{
					flexDirection: "column",
					alignItems: "initial",
				}}
			>
				<textarea
					ref={textareaRef}
					value={value.url || ""}
					onChange={handleInput}
					placeholder="https://example.com"
					style={{
						width: "100%",
						minHeight: "32px",
						maxHeight: "300px",
						resize: "none",
						overflow: "auto",
						fontFamily: "inherit",
						fontSize: "inherit",
						padding: "8px",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "4px",
						backgroundColor: "var(--background-primary)",
						color: "var(--text-normal)",
					}}
				/>
			</CpsFormItem>
		</>
	);
}
