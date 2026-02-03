import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { SubmitState } from "src/hooks/useSubmitForm";
import { localInstance } from "src/i18n/locals";
import { FormConfig } from "src/model/FormConfig";
import { IFormField } from "src/model/field/IFormField";
import { FormExecutionManager } from "src/service/FormExecutionManager";
import { FormIdValues } from "src/service/FormValues";
import { resolveDefaultFormIdValues } from "src/utils/resolveDefaultFormIdValues";
import { ToastManager } from "src/component/toast/ToastManager";

export type FormSubmissionOptions = {
	fields: IFormField[];
	formIdValues: FormIdValues;
	setFormIdValues: Dispatch<SetStateAction<FormIdValues>>;
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
	deferAfterSubmitUntilFinish?: boolean;
	nestedExecution?: boolean;
	showSubmitSuccessToast?: boolean;
	formConfig?: FormConfig;
};

export function useFormSubmission({
	fields,
	formIdValues,
	setFormIdValues,
	onUserSubmit,
	onSubmit,
	afterSubmit,
	deferAfterSubmitUntilFinish,
	nestedExecution,
	showSubmitSuccessToast = true,
	formConfig,
}: FormSubmissionOptions) {
	const app = useObsidianApp();
	const [submitState, setSubmitState] = useState<SubmitState>({
		submitting: false,
		error: false,
		errorMessage: "",
	});

	const submit = useCallback(async () => {
		if (submitState.submitting) {
			return;
		}

		const shouldDeferAfterSubmit =
			!!formConfig?.enableExecutionTimeout ||
			deferAfterSubmitUntilFinish === true;
		const submittedValues = { ...formIdValues };
		let aborted = false;

		onUserSubmit?.(submittedValues);

		const executionManager = FormExecutionManager.getInstance(app);
		const abortController = executionManager.startExecution(
			formConfig?.enableExecutionTimeout ?? false,
			formConfig?.executionTimeoutThreshold ?? 30,
			{ allowNestedReuse: nestedExecution === true }
		);
		const backgroundStartedRef = { current: false };
		const onBackgroundExecutionStart = () => {
			backgroundStartedRef.current = true;
		};
		const onBackgroundExecutionFinish = () => {
			executionManager.finishExecution();
		};

		setSubmitState({
			submitting: true,
			error: false,
			errorMessage: "",
		});

		if (!shouldDeferAfterSubmit) {
			afterSubmit?.(submittedValues);
		}

		try {
			await onSubmit(formIdValues, abortController.signal, {
				onBackgroundExecutionStart,
				onBackgroundExecutionFinish,
			});

			if (abortController.signal.aborted) {
				aborted = true;
				return;
			}

			setSubmitState({
				submitting: false,
				error: false,
				errorMessage: "",
			});
			if (showSubmitSuccessToast && !backgroundStartedRef.current) {
				ToastManager.success(localInstance.submit_success);
			}
		} catch (e) {
			if (abortController.signal.aborted) {
				aborted = true;
				return;
			}

			const errorMessage =
				(e as { message?: string })?.message ||
				localInstance.unknown_error;
			setSubmitState({
				submitting: false,
				error: true,
				errorMessage,
			});
			ToastManager.error(errorMessage, 3000);
			return;
		} finally {
			if (!backgroundStartedRef.current) {
				executionManager.finishExecution();
			}
			if (shouldDeferAfterSubmit && !aborted) {
				afterSubmit?.(submittedValues);
			}
		}
		setFormIdValues(resolveDefaultFormIdValues(fields));
	}, [
		afterSubmit,
		app,
		deferAfterSubmitUntilFinish,
		fields,
		formConfig,
		formIdValues,
		nestedExecution,
		onSubmit,
		onUserSubmit,
		setFormIdValues,
		showSubmitSuccessToast,
		submitState.submitting,
	]);

	const clearError = useCallback(() => {
		setSubmitState({
			submitting: false,
			error: false,
			errorMessage: "",
		});
	}, []);

	return {
		submitState,
		submit,
		clearError,
	};
}
