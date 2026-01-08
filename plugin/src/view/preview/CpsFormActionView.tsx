import { useMemo } from "react";
import { FormService, FormSubmitOptions } from "src/service/FormService";
import { FormConfig } from "../../model/FormConfig";
import "./CpsFormActionView.css";
import { CpsFormRenderView } from "./CpsFormRenderView";
import { FormIdValues } from "src/service/FormValues";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";
import { CommandRuntimeFieldsGenerator } from "src/utils/CommandRuntimeFieldsGenerator";
import { FormDisplayRules } from "src/utils/FormDisplayRules";

type Props = {
	formConfig: FormConfig;
	options?: {
		onUserSubmit?: (state: Record<string, any>) => void;
		afterSubmit?: (state: Record<string, any>) => void;
		showOnlyFieldsNeedingInput?: boolean;  // 是否只显示需要用户输入的字段
		/**
		 * 强制将 afterSubmit 延迟到动作链完成后触发。
		 */
		deferAfterSubmitUntilFinish?: boolean;
		/**
		 * 嵌套执行：复用父级执行的 AbortController。
		 */
		nestedExecution?: boolean;
		/**
		 * 禁用“首个 AI 动作后台执行”优化。
		 * 在多表单严格串行场景下需要禁用，否则会导致动作链未完成就继续执行下一个表单。
		 */
		disableBackgroundExecutionOnAI?: boolean;
	};
} & React.HTMLAttributes<HTMLDivElement>;

export default function CpsFormActionView(props: Props) {
	const viewOptions = props.options || {};
	const app = useObsidianApp();
	const { formConfig } = props;
	
	// 确定要显示的字段
	const displayFields = useMemo(() => {
		// 生成AI运行时字段
		const aiRuntimeFields = AIRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
		// 生成命令运行时选择字段
		const commandRuntimeFields = CommandRuntimeFieldsGenerator.generateRuntimeFields(formConfig.actions, app);
		// 合并所有字段
		const allFields = [...formConfig.fields, ...aiRuntimeFields, ...commandRuntimeFields];

		// 如果启用了字段过滤，只显示需要用户输入的字段
		if (viewOptions.showOnlyFieldsNeedingInput) {
			const fieldsNeedingInput = FormDisplayRules.getFieldsNeedingInput(formConfig);
			const fieldsNeedingInputIds = new Set(fieldsNeedingInput.map(f => f.id));

			// 过滤出需要用户输入的字段和运行时字段
			return allFields.filter(field => {
				// 运行时AI字段总是需要显示（注意字段ID格式是 __ai_runtime_）
				if (field.id.startsWith('__ai_runtime_')) {
					return true;
				}
				// 运行时命令选择字段总是需要显示
				if (field.id.startsWith('__command_runtime_')) {
					return true;
				}
				// 检查是否是需要用户输入的字段
				return fieldsNeedingInputIds.has(field.id);
			});
		}

		return allFields;
	}, [formConfig.fields, formConfig.actions, app, viewOptions.showOnlyFieldsNeedingInput]);
	
	const formService = new FormService();
	
	const submit = async (
		idValues: FormIdValues,
		abortSignal?: AbortSignal,
		hooks?: {
			onBackgroundExecutionStart?: () => void;
			onBackgroundExecutionFinish?: () => void;
		}
	) => {
		await formService.submit(idValues, formConfig, {
			app: app,
			abortSignal: abortSignal,
			enableBackgroundExecutionOnAI: viewOptions.disableBackgroundExecutionOnAI !== true,
			onBackgroundExecutionStart: hooks?.onBackgroundExecutionStart,
			onBackgroundExecutionFinish: hooks?.onBackgroundExecutionFinish,
		});
	};

	return (
		<CpsFormRenderView
			fields={displayFields}
			onUserSubmit={(state) => {
				viewOptions.onUserSubmit?.(state);
			}}
			onSubmit={submit}
			afterSubmit={(state) => {
				viewOptions.afterSubmit?.(state);
			}}
			deferAfterSubmitUntilFinish={viewOptions.deferAfterSubmitUntilFinish}
			nestedExecution={viewOptions.nestedExecution}
			showSubmitSuccessToast={formConfig.showSubmitSuccessToast}
			formConfig={formConfig}
		/>
	);
}
