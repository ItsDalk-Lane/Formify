import { Presentation, Settings, Download } from "lucide-react";
import { useState } from "react";
import { useForm } from "../../hooks/useForm";
import { FormConfig } from "../../model/FormConfig";
import CpsFormEditView from "../edit/CpsFormEditView";
import CpsFormActionView from "./CpsFormActionView";
import "./CpsFormFileView.css";
import { FormConfigContext } from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormImportDialog } from "../edit/setting/import/FormImportDialog";

type Props = {
	filePath: string;
	formConfig: FormConfig;
	options?: {
		hideHeader?: boolean;
		showFilePath?: boolean;
		afterSubmit?: (state: Record<string, any>) => void;
		showOnlyFieldsNeedingInput?: boolean;
	};
} & React.HTMLAttributes<HTMLDivElement>;

export function CpsFormFileView(props: Props) {
	const viewOptions = props.options || {};
	const [inEditing, setInEditing] = useState<boolean>(false);
	const [showImportDialog, setShowImportDialog] = useState<boolean>(false);
	const { filePath, options, className, formConfig: config, ...rest } = props;
	const { formConfig, formFile } = useForm(filePath, props.formConfig);
	const fileName = formFile.split("/").pop() || "";
	const fileBasename = fileName.split(".")[0] || "";

	// 处理导入完成
	const handleImportComplete = (importedConfig: FormConfig) => {
		// 合并导入的配置到当前表单
		const mergedConfig = new FormConfig(formConfig.id);
		Object.assign(mergedConfig, {
			...formConfig,
			// 合并字段
			fields: [...formConfig.fields, ...importedConfig.fields],
			// 合并动作
			actions: [...formConfig.actions, ...importedConfig.actions],
			// 合并其他设置（如果导入的设置存在）
			...(importedConfig.showSubmitSuccessToast !== undefined && {
				showSubmitSuccessToast: importedConfig.showSubmitSuccessToast
			}),
			...(importedConfig.enableExecutionTimeout !== undefined && {
				enableExecutionTimeout: importedConfig.enableExecutionTimeout
			}),
			...(importedConfig.executionTimeoutThreshold !== undefined && {
				executionTimeoutThreshold: importedConfig.executionTimeoutThreshold
			}),
		});

		// 这里需要触发表单配置的更新
		// 由于这是在预览视图中，我们需要通过某种方式通知父组件
		setShowImportDialog(false);
	};

	return (
		<FormConfigContext.Provider value={formConfig}>
			<div
				className={`form--CpsFormFileView ${className ?? ""}`}
				{...rest}
			>
				{viewOptions.hideHeader !== true && (
					<div
						className="form--CpsFormFileViewHeader"
						data-editing={inEditing}
					>
						{<div>{fileBasename}</div>}
						{inEditing ? (
							<div style={{ display: 'flex', gap: '8px' }}>
								<button
									style={{
										padding: '6px 12px',
										background: 'var(--interactive-accent)',
										color: 'var(--text-on-accent)',
										border: 'none',
										borderRadius: '4px',
										fontSize: '12px',
										fontWeight: '500',
										cursor: 'pointer',
										whiteSpace: 'nowrap',
										display: 'flex',
										alignItems: 'center',
										transition: 'background-color 0.2s ease',
									}}
									onClick={() => setShowImportDialog(true)}
									title={localInstance.import_form || '导入表单'}
									onMouseOver={(e) => {
										e.currentTarget.style.background = 'var(--interactive-accent-hover)';
									}}
									onMouseOut={(e) => {
										e.currentTarget.style.background = 'var(--interactive-accent)';
									}}
								>
									{localInstance.import_form || '导入表单'}
								</button>
								<button
									className="form--CpsFormFileViewModeButton"
									onClick={() => setInEditing(false)}
								>
									<Presentation size={16} />
									{localInstance.click_switch_to_preview_mode}
								</button>
							</div>
						) : (
							<button
								className="form--CpsFormFileViewModeButton"
								onClick={() => setInEditing(true)}
							>
								<Settings size={16} />
							</button>
						)}
					</div>
				)}
				{inEditing === true ? (
					<CpsFormEditView
						defaultConfig={formConfig}
						filePath={formFile}
					/>
				) : (
					<CpsFormActionView
						formConfig={formConfig}
						options={props.options}
					/>
				)}

			{/* 导入对话框 */}
			{showImportDialog && (
				<FormImportDialog
					app={(window as any).app}
					currentConfig={formConfig}
					onClose={() => setShowImportDialog(false)}
					onComplete={handleImportComplete}
				/>
			)}
			</div>
		</FormConfigContext.Provider>
	);
}
