import { ClipboardIcon, Wrench, Zap } from "lucide-react";
import { Tab } from "src/component/tab/Tab";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { IFormField } from "src/model/field/IFormField";
import { FormConfig } from "src/model/FormConfig";
import { formIntegrationService } from "src/service/command/FormIntegrationService";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsForm from "src/view/shared/CpsForm";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { CpsFormActions } from "./action/CpsFormActions";
import "./CpsFormSetting.css";
import { CpsFormSettingGroup } from "./CpsFormSettingGroup";
import CpsFormFields from "./field/CpsFormFields";
import { AsCommandToggle } from "./field/common/AsCommandToggle";
import { useState, useEffect } from "react";

export default function (props: {
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

	// 异步获取快捷键
	useEffect(() => {
		let mounted = true;

		const loadShortcuts = async () => {
			try {
				const keys = await formIntegrationService.getShortcut(props.filePath, app);
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
		setFieldSelectMode(!fieldSelectMode);
		if (!fieldSelectMode) {
			setFieldSelectedIds([]);
		}
	};

	const handleFieldSelectAll = () => {
		setFieldSelectedIds(formConfig.fields.map(f => f.id));
	};

	const handleFieldSelectNone = () => {
		setFieldSelectedIds([]);
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
	};

	// 动作批量操作处理函数
	const handleActionToggleSelectMode = () => {
		setActionSelectMode(!actionSelectMode);
		if (!actionSelectMode) {
			setActionSelectedIds([]);
		}
	};

	const handleActionSelectAll = () => {
		const actions = formConfig.actions || [];
		setActionSelectedIds(actions.map(a => a.id));
	};

	const handleActionSelectNone = () => {
		setActionSelectedIds([]);
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
	};

	return (
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
								onSelectAll={handleFieldSelectAll}
								onSelectNone={handleFieldSelectNone}
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
								onSelectAll={handleActionSelectAll}
								onSelectNone={handleActionSelectNone}
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
								<CpsFormItem label={localInstance.auto_submit}>
									<span className="form--FormFieldLabelDescription">
										{localInstance.auto_submit_description}
									</span>
									<ToggleControl
										value={formConfig.autoSubmit === true}
										onValueChange={(v) => {
											const newConfig = new FormConfig(formConfig.id);
											Object.assign(newConfig, {
												...formConfig,
												autoSubmit: v,
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
												const value = parseInt(e.target.value);
												if (value < 5) {
													// 如果值小于5，显示错误提示
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
												const value = parseInt(e.target.value);
												if (value < 5) {
													// 重置为最小值
													const newConfig = new FormConfig(formConfig.id);
													Object.assign(newConfig, {
														...formConfig,
														executionTimeoutThreshold: 5,
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
	);
}
