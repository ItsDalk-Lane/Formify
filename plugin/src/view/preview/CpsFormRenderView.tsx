import { HTMLAttributes, useState, useRef, useMemo, useEffect } from "react";
import { useAnotherKeyToSubmitForm } from "src/hooks/useAnotherKeyToSubmitForm";
import { useAutoFocus } from "src/hooks/useAutoFocus";
import { SubmitState } from "src/hooks/useSubmitForm";
import { localInstance } from "src/i18n/locals";
import { IFormField } from "src/model/field/IFormField";
import { FormVisibilies } from "src/service/condition/FormVisibilies";
import { FormIdValues } from "src/service/FormValues";
import { resolveDefaultFormIdValues } from "src/utils/resolveDefaultFormIdValues";
import { getFieldDefaultValue } from "src/utils/getFieldDefaultValue";
import ActionFlow from "../shared/action-flow/ActionFlow";
import { CpsFormFieldControl } from "../shared/control/CpsFormFieldControl";
import CpsForm from "../shared/CpsForm";
import CpsFormItem from "../shared/CpsFormItem";
import { ToastManager } from "../../component/toast/ToastManager";
import CpsFormButtonLoading from "./animation/CpsFormButtonLoading";
import CalloutBlock from "src/component/callout-block/CalloutBlock";
import { FormConfig } from "src/model/FormConfig";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { FormExecutionManager } from "src/service/FormExecutionManager";

type Props = {
	fields: IFormField[];
	onSubmit: (values: FormIdValues, abortSignal?: AbortSignal) => Promise<void>;
	afterSubmit?: (values: FormIdValues) => void;
	showSubmitSuccessToast?: boolean;  // 是否显示提交成功提示
	formConfig?: FormConfig;  // 表单配置，用于获取超时控制设置
} & Omit<HTMLAttributes<HTMLDivElement>, "defaultValue">;

export function CpsFormRenderView(props: Props) {
	const { fields, onSubmit, afterSubmit, showSubmitSuccessToast = true, formConfig, className, ...rest } = props;
	const app = useObsidianApp();
	const [formIdValues, setFormIdValues] = useState<FormIdValues>(
		resolveDefaultFormIdValues(fields)
	);
	
	const [submitState, setSubmitState] = useState<SubmitState>({
		submitting: false,
		error: false,
		errorMessage: "",
	});
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

	const submit = async () => {
		if (submitState.submitting) {
			return;
		}

		const shouldDeferAfterSubmit = !!formConfig?.enableExecutionTimeout;
		const submittedValues = { ...formIdValues };
		let aborted = false;

		// 使用全局执行管理器
		const executionManager = FormExecutionManager.getInstance(app);
		const abortController = executionManager.startExecution(
			formConfig?.enableExecutionTimeout ?? false,
			formConfig?.executionTimeoutThreshold ?? 30
		);
	
		setSubmitState({
			submitting: true,
			error: false,
			errorMessage: "",
		});

		// 立即调用 afterSubmit，关闭模态框（如果有）
		// 当启用超时控制时延迟到执行完成后再关闭，方便用户查看停止按钮
		if (!shouldDeferAfterSubmit) {
			afterSubmit?.(submittedValues);
		}

		try {
			await onSubmit(formIdValues, abortController.signal);
			
			// 检查是否被中断
			if (abortController.signal.aborted) {
				aborted = true;
				return;
			}
			
			setSubmitState({
				submitting: false,
				error: false,
				errorMessage: "",
			});
			// 根据配置决定是否显示提交成功提示
			if (showSubmitSuccessToast) {
				ToastManager.success(localInstance.submit_success);
			}
		} catch (e) {
			// 检查是否被中断
			if (abortController.signal.aborted) {
				aborted = true;
				return;
			}
			
			setSubmitState({
				submitting: false,
				error: true,
				errorMessage: e?.message || localInstance.unknown_error,
			});
			ToastManager.error(e.message || localInstance.unknown_error, 3000);
			return;
		} finally {
			executionManager.finishExecution();
			if (shouldDeferAfterSubmit && !aborted) {
				afterSubmit?.(submittedValues);
			}
		}
		setFormIdValues(resolveDefaultFormIdValues(fields));
	};
	
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

	const visibleFields = useMemo(() => {
		const newFields = FormVisibilies.visibleFields(fields, formIdValues);
		return newFields;
	}, [fields, formIdValues]);

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
				{visibleFields.map((field, index) => (
					<CpsFormItem
						required={field.required}
						label={field.label}
						key={field.id}
						description={field.description}
					>
						<CpsFormFieldControl
							field={field}
							value={formIdValues[field.id]}
							autoFocus={index === 0}
							onValueChange={(value) => {
								const newValues = {
									...formIdValues,
									[field.id]: value,
								};
								setFormIdValues(newValues);
							}}
						/>
					</CpsFormItem>
				))}
				{fields.length === 0 && <ActionFlow />}
			</CpsForm>

			{submitState.error && (
				<CalloutBlock
					type="error"
					// title={localInstance.submit_failed}
					content={submitState.errorMessage}
					closeable={true}
					onClose={() => {
						setSubmitState({
							submitting: false,
							error: false,
							errorMessage: "",
						});
					}}
				/>
			)}

			<div className="form--CpsFormPreviewFooter">
				<button
					className="form--CpsFormSubmitButton mod-cta"
					type="submit"
					ref={submitButtonRef}
					disabled={submitState.submitting}
				>
					{submitState.submitting ? (
						<CpsFormButtonLoading size={18} />
					) : (
						<>
							{localInstance.submit}
							<span className="form--CpsFormSubmitButtonKey">
								↵
							</span>
						</>
					)}
				</button>
			</div>
		</form>
	);
}
