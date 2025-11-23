import { useMemo } from "react";
import { FormService, FormSubmitOptions } from "src/service/FormService";
import { FormConfig } from "../../model/FormConfig";
import "./CpsFormActionView.css";
import { CpsFormRenderView } from "./CpsFormRenderView";
import { FormIdValues } from "src/service/FormValues";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";
import { FormDisplayRules } from "src/utils/FormDisplayRules";

type Props = {
	formConfig: FormConfig;
	options?: {
		afterSubmit?: (state: Record<string, any>) => void;
		showOnlyFieldsNeedingInput?: boolean;  // 是否只显示需要用户输入的字段
	};
} & React.HTMLAttributes<HTMLDivElement>;

export default function (props: Props) {
	const viewOptions = props.options || {};
	const app = useObsidianApp();
	const { formConfig } = props;
	
	// 确定要显示的字段
	const displayFields = useMemo(() => {
		const runtimeFields = AIRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
		const allFields = [...formConfig.fields, ...runtimeFields];

		// 如果启用了字段过滤，只显示需要用户输入的字段
		if (viewOptions.showOnlyFieldsNeedingInput) {
			const fieldsNeedingInput = FormDisplayRules.getFieldsNeedingInput(formConfig);
			const fieldsNeedingInputIds = new Set(fieldsNeedingInput.map(f => f.id));

			// 过滤出需要用户输入的字段和运行时AI字段
			return allFields.filter(field => {
				// 运行时AI字段总是需要显示（注意字段ID格式是 __ai_runtime_）
				if (field.id.startsWith('__ai_runtime_')) {
					return true;
				}
				// 检查是否是需要用户输入的字段
				return fieldsNeedingInputIds.has(field.id);
			});
		}

		return allFields;
	}, [formConfig.fields, formConfig.actions, app, viewOptions.showOnlyFieldsNeedingInput]);
	
	const formService = new FormService();
	
	const submit = async (idValues: FormIdValues, abortSignal?: AbortSignal) => {
		await formService.submit(idValues, formConfig, {
			app: app,
			abortSignal: abortSignal,
		});
	};

	return (
		<CpsFormRenderView
			fields={displayFields}
			onSubmit={submit}
			afterSubmit={(state) => {
				viewOptions.afterSubmit?.(state);
			}}
			showSubmitSuccessToast={formConfig.showSubmitSuccessToast}
			formConfig={formConfig}
		/>
	);
}
