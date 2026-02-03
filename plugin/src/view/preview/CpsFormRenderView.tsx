import { HTMLAttributes, useEffect, useRef, useState } from "react";
import { useAnotherKeyToSubmitForm } from "src/hooks/useAnotherKeyToSubmitForm";
import { useAutoFocus } from "src/hooks/useAutoFocus";
import { IFormField } from "src/model/field/IFormField";
import { FormIdValues } from "src/service/FormValues";
import { getFieldDefaultValue } from "src/utils/getFieldDefaultValue";
import CpsForm from "../shared/CpsForm";
import CalloutBlock from "src/component/callout-block/CalloutBlock";
import { FormConfig } from "src/model/FormConfig";
import { resolveDefaultFormIdValues } from "src/utils/resolveDefaultFormIdValues";
import { FormFieldList } from "./components/FormFieldList";
import { FormSubmitButton } from "./components/FormSubmitButton";
import { useFormSubmission } from "./hooks/useFormSubmission";

type Props = {
	fields: IFormField[];
	/**
	 * 用户点击提交的瞬间触发（不等待动作链执行完成）。
	 * 用于在“调用表单/严格串行”场景中立即关闭 UI，但仍可在动作链完成后再继续后续流程。
	 */
	onUserSubmit?: (values: FormIdValues) => void;
	onSubmit: (
		values: FormIdValues,
		abortSignal?: AbortSignal,
		hooks?: {
			onBackgroundExecutionStart?: () => void;
			onBackgroundExecutionFinish?: () => void;
		}
	) => Promise<void>;
	afterSubmit?: (values: FormIdValues) => void;
	/**
	 * 强制将 afterSubmit 延迟到 onSubmit 完成后再触发（即：动作链执行完成后再关闭模态框）
	 * 用于“调用表单”这类需要严格串行的场景。
	 */
	deferAfterSubmitUntilFinish?: boolean;
	/**
	 * 嵌套执行：复用全局执行管理器的 AbortController，避免中断父级执行。
	 */
	nestedExecution?: boolean;
	showSubmitSuccessToast?: boolean;  // 是否显示提交成功提示
	formConfig?: FormConfig;  // 表单配置，用于获取超时控制设置
} & Omit<HTMLAttributes<HTMLDivElement>, "defaultValue">;

export function CpsFormRenderView(props: Props) {
	const { fields, onUserSubmit, onSubmit, afterSubmit, deferAfterSubmitUntilFinish, nestedExecution, showSubmitSuccessToast = true, formConfig, className, ...rest } = props;
	const [formIdValues, setFormIdValues] = useState<FormIdValues>(
		resolveDefaultFormIdValues(fields)
	);
	const formRef = useRef<HTMLFormElement>(null);
	const settingRef = useRef<HTMLDivElement>(null);
	const submitButtonRef = useRef<HTMLButtonElement>(null);

	// 当字段列表变化时，更新formIdValues以包含新字段的默认值
	useEffect(() => {
		const currentFieldIds = new Set(Object.keys(formIdValues));
		const newFieldIds = new Set(fields.map(f => f.id));
		
		// 检查是否有新增的字段
		let hasNewFields = false;
		for (const fieldId of newFieldIds) {
			if (!currentFieldIds.has(fieldId)) {
				hasNewFields = true;
				break;
			}
		}
		
		// 如果有新字段，添加它们的默认值
		if (hasNewFields) {
			const newValues = { ...formIdValues };
			fields.forEach(field => {
				if (!currentFieldIds.has(field.id)) {
					newValues[field.id] = getFieldDefaultValue(field);
				}
			});
			setFormIdValues(newValues);
		}
	}, [fields]);

	const { submitState, submit, clearError } = useFormSubmission({
		fields,
		formIdValues,
		setFormIdValues,
		onUserSubmit,
		onSubmit,
		afterSubmit,
		deferAfterSubmitUntilFinish,
		nestedExecution,
		showSubmitSuccessToast,
		formConfig,
	});
	
	// 停止表单执行已由全局管理器处理，不再需要本地实现

	useAnotherKeyToSubmitForm(
		() => {
			// 注意：这里不传递 abortSignal，因为快捷键提交时没有超时控制
			onSubmit(formIdValues);
		},
		settingRef,
		formRef
	);
	useAutoFocus(formRef);

	return (
		<form
			className="form--CpsFormPreview"
			ref={formRef}
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
			autoFocus={true}
		>
			<CpsForm
				ref={settingRef}
				className="form--CpsFormPreviewBody"
				layout="vertical"
			>
				<FormFieldList
					fields={fields}
					values={formIdValues}
					onValuesChange={setFormIdValues}
				/>
			</CpsForm>

			{submitState.error && (
				<CalloutBlock
					type="error"
					// title={localInstance.submit_failed}
					content={submitState.errorMessage}
					closeable={true}
					onClose={clearError}
				/>
			)}

			<div className="form--CpsFormPreviewFooter">
				<FormSubmitButton
					ref={submitButtonRef}
					submitting={submitState.submitting}
				/>
			</div>
		</form>
	);
}
