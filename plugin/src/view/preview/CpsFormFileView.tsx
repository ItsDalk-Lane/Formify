import { Presentation, Settings, Download } from "lucide-react";
import { Notice } from "obsidian";
import { useState } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { useForm } from "../../hooks/useForm";
import { FormConfig } from "../../model/FormConfig";
import CpsFormEditView from "../edit/CpsFormEditView";
import CpsFormActionView from "./CpsFormActionView";
import "./CpsFormFileView.css";
import { FormConfigContext } from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormImportDialog } from "../edit/setting/import/FormImportDialog";
import FormVariableQuotePanel from "../edit/setting/action/common/variable-quoter/FormVariableQuotePanel";
import { recordFormifyTestEvent } from "src/testing/FormifyTestHooks";

type Props = {
	filePath: string;
	formConfig: FormConfig;
	options?: {
		hideHeader?: boolean;
		showFilePath?: boolean;
		onUserSubmit?: (state: Record<string, any>) => void;
		afterSubmit?: (state: Record<string, any>) => void;
		showOnlyFieldsNeedingInput?: boolean;
		deferAfterSubmitUntilFinish?: boolean;
		nestedExecution?: boolean;
		disableBackgroundExecutionOnAI?: boolean;
	};
} & React.HTMLAttributes<HTMLDivElement>;

export function CpsFormFileView(props: Props) {
	const viewOptions = props.options || {};
	const [inEditing, setInEditing] = useState<boolean>(false);
	const [showImportDialog, setShowImportDialog] = useState<boolean>(false);
	const { filePath, options, className, formConfig: config, ...rest } = props;
	const app = useObsidianApp();
	const { formConfig, formFile, setFormConfig, reload } = useForm(filePath, props.formConfig);
	const fileName = formFile.split("/").pop() || "";
	const fileBasename = fileName.split(".")[0] || "";

	// 处理导入对话框关闭（无论是完成导入、取消还是点击X）
	const handleImportDialogClose = () => {
		recordFormifyTestEvent("form-import-dialog-close-requested", {
			filePath: formFile,
		});
		setShowImportDialog(false);
		// 从文件重新加载表单配置，确保界面显示最新数据
		reload();
	};

	// 处理导入完成
	const handleImportComplete = (importedConfig: FormConfig) => {
		recordFormifyTestEvent("form-import-complete", {
			filePath: formFile,
			fields: importedConfig.fields?.length ?? 0,
			actions: importedConfig.actions?.length ?? 0,
		});

		// 先更新本地状态以立刻刷新界面，再写入文件确保落盘
		setFormConfig(importedConfig);
		app.vault
			.writeJson(formFile, importedConfig)
			.then(() => {
				setShowImportDialog(false);
			})
			.catch((error) => {
				console.error("导入结果写入文件失败:", error);
				new Notice("导入结果写入失败，请重试或检查存储权限。");
			});
	};

	return (
		<FormConfigContext.Provider value={formConfig}>
			<div
				className={`form--CpsFormFileView ${className ?? ""}`}
				data-editing={inEditing}
				{...rest}
			>
				{viewOptions.hideHeader !== true && (
					<div
						className="form--CpsFormFileViewHeader"
						data-editing={inEditing}
					>
						{<div>{fileBasename}</div>}
						{inEditing ? (
							<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
								<FormVariableQuotePanel formConfig={formConfig} simpleMode={true} />
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
									data-testid="formify-import-button"
									onClick={() => {
										recordFormifyTestEvent("form-import-button-clicked", {
											filePath: formFile,
										});
										setShowImportDialog(true);
									}}
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
				<div className="form--CpsFormFileViewBody">
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
				</div>

			{/* 导入对话框 */}
			{showImportDialog && (
				<FormImportDialog
					app={(window as any).app}
					currentConfig={formConfig}
					onClose={handleImportDialogClose}
					onComplete={handleImportComplete}
				/>
			)}
			</div>
		</FormConfigContext.Provider>
	);
}
