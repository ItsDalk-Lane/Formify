import { ClipboardIcon, Wrench, Zap, Download, Search, Filter } from "lucide-react";
import { Tab } from "src/component/tab/Tab";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { IFormField } from "src/model/field/IFormField";
import { FormConfig } from "src/model/FormConfig";
import { getServiceContainer } from "src/service/ServiceContainer";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsForm from "src/view/shared/CpsForm";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { CpsFormActions } from "./action/CpsFormActions";
import "./CpsFormSetting.css";
import { CpsFormSettingGroup } from "./CpsFormSettingGroup";
import CpsFormFields from "./field/CpsFormFields";
import { AsCommandToggle, ContextMenuToggle } from "./field/common/AsCommandToggle";
import ContextMenuGroupSuggestInput from "./field/common/ContextMenuGroupSuggestInput";
import { useState, useEffect } from "react";
import { FormConfigContext } from "src/hooks/useFormConfig";
import { FormImportDialog } from "./import/FormImportDialog";

export default function CpsFormSetting(props: {
	filePath: string;
	formConfig: FormConfig;
	onChange: (config: FormConfig) => void;
}) {
	const { formConfig, onChange } = props;
	const app = useObsidianApp();
	const [commandKeys, setCommandKeys] = useState<string>("");

	// 字段批量操作状态
	const [fieldSelectMode, setFieldSelectMode] = useState(false);
	const [fieldSelectedIds, setFieldSelectedIds] = useState<string[]>([]);

	// 动作批量操作状态
	const [actionSelectMode, setActionSelectMode] = useState(false);
	const [actionSelectedIds, setActionSelectedIds] = useState<string[]>([]);

	// 导入功能状态
	const [showImportDialog, setShowImportDialog] = useState(false);

	// 异步获取快捷键
	useEffect(() => {
		let mounted = true;

		const loadShortcuts = async () => {
			try {
				const keys = await getServiceContainer().formIntegrationService.getShortcut(props.filePath, app);
				if (mounted) {
					setCommandKeys(keys.join(","));
				}
			} catch (error) {
				console.warn(`Failed to load shortcuts for ${props.filePath}:`, error);
			}
		};

		loadShortcuts();

		return () => {
			mounted = false;
		};
	}, [props.filePath, app]);

	// 递归替换对象中的标签引用
	const replaceLabelsInObject = (
		obj: any,
		labelMapping: Map<string, string>
	): any => {
		if (obj === null || obj === undefined) {
			return obj;
		}

		if (typeof obj === "string") {
			let result = obj;
			labelMapping.forEach((newLabel, oldLabel) => {
				const pattern = `{{@${oldLabel}}}`;
				if (result.includes(pattern)) {
					result = result.split(pattern).join(`{{@${newLabel}}}`);
				}
			});
			return result;
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => replaceLabelsInObject(item, labelMapping));
		}

		if (typeof obj === "object") {
			const result: Record<string, any> = {};
			for (const key in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, key)) {
					result[key] = replaceLabelsInObject(obj[key], labelMapping);
				}
			}
			return result;
		}

		return obj;
	};

	const onFieldsChanged = (fields: IFormField[], modified: IFormField[]) => {
		// 创建新的FormConfig实例
		let newConfig = new FormConfig(formConfig.id);
		Object.assign(newConfig, {
			...formConfig,
			fields: fields,
		});

		if (modified.length > 0) {
			// 创建旧标签到新标签的映射
			const labelMapping = new Map<string, string>();
			for (const field of modified) {
				const old = field.label;
				const newLabel = fields.find((f) => f.id === field.id)?.label;
				if (old !== newLabel && newLabel !== undefined) {
					labelMapping.set(old, newLabel);
				}
			}

			// 如果有需要替换的标签，递归替换对象中的标签引用
			if (labelMapping.size > 0) {
				const updatedConfig = replaceLabelsInObject(newConfig, labelMapping);
				Object.assign(newConfig, updatedConfig);
			}
		}

		onChange(newConfig);
	};

	// 字段批量操作处理函数
	const handleFieldToggleSelectMode = () => {
		if (!fieldSelectMode) {
			// 如果当前未选中，则全选所有字段
			setFieldSelectedIds(formConfig.fields.map(f => f.id));
		} else {
			// 如果当前已选中，则清空选择
			setFieldSelectedIds([]);
		}
		setFieldSelectMode(!fieldSelectMode);
	};

	const handleFieldDeleteSelected = () => {
		const toDelete = new Set(fieldSelectedIds);
		const newFields = formConfig.fields.filter(f => !toDelete.has(f.id));
		onFieldsChanged(newFields, []);
		setFieldSelectedIds([]);
		setFieldSelectMode(false);
	};

	const handleFieldToggleSelection = (id: string) => {
		setFieldSelectedIds(prev => {
			const s = new Set(prev);
			if (s.has(id)) {
				s.delete(id);
			} else {
				s.add(id);
			}
			return Array.from(s);
		});

		// 如果取消选中后没有选中的项目，则退出批量选择模式
		setFieldSelectedIds(prev => {
			if (prev.length === 0) {
				setFieldSelectMode(false);
			}
			return prev;
		});
	};

	// 动作批量操作处理函数
	const handleActionToggleSelectMode = () => {
		const actions = formConfig.actions || [];
		if (!actionSelectMode) {
			// 如果当前未选中，则全选所有动作
			setActionSelectedIds(actions.map(a => a.id));
		} else {
			// 如果当前已选中，则清空选择
			setActionSelectedIds([]);
		}
		setActionSelectMode(!actionSelectMode);
	};

	const handleActionDeleteSelected = () => {
		const toDelete = new Set(actionSelectedIds);
		const newActions = (formConfig.actions || []).filter(a => !toDelete.has(a.id));
		const newConfig = new FormConfig(formConfig.id);
		Object.assign(newConfig, {
			...formConfig,
			action: undefined,
			actions: newActions,
		});
		onChange(newConfig);
		setActionSelectedIds([]);
		setActionSelectMode(false);
	};

	const handleActionToggleSelection = (id: string) => {
		setActionSelectedIds(prev => {
			const s = new Set(prev);
			if (s.has(id)) {
				s.delete(id);
			} else {
				s.add(id);
			}
			return Array.from(s);
		});

		// 如果取消选中后没有选中的项目，则退出批量选择模式
		setActionSelectedIds(prev => {
			if (prev.length === 0) {
				setActionSelectMode(false);
			}
			return prev;
		});
	};

	// 处理导入完成
	const handleImportComplete = (importedConfig: FormConfig) => {
		// 合并导入的配置到当前表单
		const mergedConfig = new FormConfig(formConfig.id);
		Object.assign(mergedConfig, {
			...formConfig,
			// 合并字段
			fields: [
				...(formConfig.fields || []),
				...(importedConfig.fields || []),
			],
			// 合并动作
			actions: [
				...(formConfig.actions || []),
				...(importedConfig.actions || []),
			],
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
			...(importedConfig.runOnStartup !== undefined && {
				runOnStartup: importedConfig.runOnStartup
			}),
		});

		onChange(mergedConfig);
		setShowImportDialog(false);
	};

	return (
		<FormConfigContext.Provider value={formConfig}>
			{/* 导入对话框 */}
			{showImportDialog && (
				<FormImportDialog
					app={app}
					currentConfig={formConfig}
					onClose={() => setShowImportDialog(false)}
					onComplete={handleImportComplete}
				/>
			)}

		<Tab
			items={[
				{
					id: "basic",
					title: localInstance.basic_setting,
					content: (
						<CpsForm
							layout="vertical"
							className="form--CpsFormEditView"
						>
							<CpsFormSettingGroup
								icon={<ClipboardIcon />}
								title={localInstance.form_fields_setting}
								showBatchActions={true}
								selectMode={fieldSelectMode}
								onToggleSelectMode={handleFieldToggleSelectMode}
								onDeleteSelected={handleFieldDeleteSelected}
							>
								<CpsFormFields
									fields={formConfig.fields}
									onSave={onFieldsChanged}
									selectMode={fieldSelectMode}
									selectedIds={fieldSelectedIds}
									onToggleSelection={handleFieldToggleSelection}
								/>
							</CpsFormSettingGroup>

							<CpsFormSettingGroup
								icon={<Zap />}
								title={localInstance.form_action_setting}
								showBatchActions={true}
								selectMode={actionSelectMode}
								onToggleSelectMode={handleActionToggleSelectMode}
								onDeleteSelected={handleActionDeleteSelected}
							>
								<CpsFormActions
									config={formConfig}
									onChange={(action) => {
										const newConfig = new FormConfig(formConfig.id);
										Object.assign(newConfig, {
											...formConfig,
											action: undefined,
											actions: action,
										});
										onChange(newConfig);
									}}
									selectMode={actionSelectMode}
									selectedIds={actionSelectedIds}
									onToggleSelection={handleActionToggleSelection}
								/>
							</CpsFormSettingGroup>
						</CpsForm>
					),
				},
				{
					id: "other",
					title: localInstance.other_setting,
					content: (
						<CpsForm>
							<CpsFormSettingGroup
								icon={<Wrench />}
								title={localInstance.other_setting}
							>
								<CpsFormItem
									label={localInstance.register_as_command}
								>
									<a
										className="form--FormFieldLabelDescription"
										onClick={(e) => {
											app.setting.open();
											app.setting.openTabById("hotkeys");
										}}
									>
										{
											localInstance.register_as_command_description
										}
									</a>
									{commandKeys?.length > 0 && (
										<span className="form--CommandHotkeyLabel">
											{commandKeys}
										</span>
									)}
									<AsCommandToggle
										filePath={props.filePath}
									/>
								</CpsFormItem>
								<CpsFormItem
									label={localInstance.enable_context_menu}
								>
									<span className="form--FormFieldLabelDescription">
										{localInstance.enable_context_menu_description}
									</span>
									<ContextMenuToggle
										filePath={props.filePath}
									/>
								</CpsFormItem>
								<CpsFormItem
									label={localInstance.context_menu_group}
									description={localInstance.context_menu_group_description}
								>
									<ContextMenuGroupSuggestInput
										filePath={props.filePath}
										value={formConfig.contextMenuGroup ?? ""}
										placeholder={localInstance.default_value}
										className="form--ContextMenuGroupCombobox"
										onChange={(v) => {
											const newConfig = new FormConfig(formConfig.id);
											Object.assign(newConfig, {
												...formConfig,
												contextMenuGroup: v,
											});
											onChange(newConfig);
										}}
									/>
								</CpsFormItem>
								<CpsFormItem label={localInstance.run_on_startup}>
									<span className="form--FormFieldLabelDescription">
										{localInstance.run_on_startup_description}
									</span>
									<ToggleControl
										value={formConfig.runOnStartup === true}
										onValueChange={(v) => {
											const newConfig = new FormConfig(formConfig.id);
											Object.assign(newConfig, {
												...formConfig,
												runOnStartup: v,
											});
											onChange(newConfig);
										}}
									/>
								</CpsFormItem>
									<CpsFormItem label={localInstance.show_submit_success_toast}>
									<span className="form--FormFieldLabelDescription">
										{localInstance.show_submit_success_toast_description}
									</span>
									<ToggleControl
										value={formConfig.showSubmitSuccessToast !== false}
										onValueChange={(v) => {
											const newConfig = new FormConfig(formConfig.id);
											Object.assign(newConfig, {
												...formConfig,
												showSubmitSuccessToast: v,
											});
											onChange(newConfig);
										}}
									/>
								</CpsFormItem>
								<CpsFormItem label={localInstance.enable_execution_timeout}>
									<span className="form--FormFieldLabelDescription">
										{localInstance.execution_timeout_threshold_description}
									</span>
									<ToggleControl
										value={formConfig.enableExecutionTimeout === true}
										onValueChange={(v) => {
											const newConfig = new FormConfig(formConfig.id);
											Object.assign(newConfig, {
												...formConfig,
												enableExecutionTimeout: v,
											});
											onChange(newConfig);
										}}
									/>
								</CpsFormItem>
								{formConfig.enableExecutionTimeout && (
									<CpsFormItem label={localInstance.execution_timeout_threshold}>
										<input
											type="number"
											min="5"
											step="1"
											value={formConfig.executionTimeoutThreshold ?? 30}
											onChange={(e) => {
												const value = parseInt(e.target.value, 10);
												if (Number.isNaN(value)) {
													return;
												}
												const newConfig = new FormConfig(formConfig.id);
												Object.assign(newConfig, {
													...formConfig,
													executionTimeoutThreshold: value,
												});
												onChange(newConfig);
											}}
											onBlur={(e) => {
												const value = parseInt(e.target.value, 10);
												const normalizedValue = Number.isNaN(value) ? 5 : Math.max(5, value);
												if (normalizedValue !== (formConfig.executionTimeoutThreshold ?? 30)) {
													const newConfig = new FormConfig(formConfig.id);
													Object.assign(newConfig, {
														...formConfig,
														executionTimeoutThreshold: normalizedValue,
													});
													onChange(newConfig);
												}
											}}
										/>
									</CpsFormItem>
								)}
							</CpsFormSettingGroup>
						</CpsForm>
					),
				},
			]}
		/>
		</FormConfigContext.Provider>
	);
}
