import { useMemo } from "react";
import { FormService, FormSubmitOptions } from "src/service/FormService";
import { FormConfig } from "../../model/FormConfig";
import "./CpsFormActionView.css";
import { CpsFormRenderView } from "./CpsFormRenderView";
import { FormIdValues } from "src/service/FormValues";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";

type Props = {
	formConfig: FormConfig;
	options?: {
		afterSubmit?: (state: Record<string, any>) => void;
	};
} & React.HTMLAttributes<HTMLDivElement>;

export default function (props: Props) {
	const viewOptions = props.options || {};
	const app = useObsidianApp();
	const { formConfig } = props;
	
	// 生成运行时AI字段
	const fieldsWithRuntime = useMemo(() => {
		const runtimeFields = AIRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
		return [...formConfig.fields, ...runtimeFields];
	}, [formConfig.fields, formConfig.actions, app]);
	
	const formService = new FormService();
	
	const submit = async (idValues: FormIdValues, abortSignal?: AbortSignal) => {
		await formService.submit(idValues, formConfig, {
			app: app,
			abortSignal: abortSignal,
		});
	};

	return (
		<CpsFormRenderView
			fields={fieldsWithRuntime}
			onSubmit={submit}
			afterSubmit={(state) => {
				viewOptions.afterSubmit?.(state);
			}}
			showSubmitSuccessToast={formConfig.showSubmitSuccessToast}
			formConfig={formConfig}
		/>
	);
}
