import { useState, useMemo, useEffect } from "react";
import {
	ChevronDown,
	ChevronRight,
	Trash2,
	Copy,
	Terminal,
	MousePointerClick,
	Rocket,
	Timer,
} from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { ActionTrigger } from "src/model/ActionTrigger";
import { IFormAction } from "src/model/action/IFormAction";
import { FormConfig } from "src/model/FormConfig";
import { useActionTitle } from "src/hooks/useActionTitle";
import { useActionTypeStyle } from "src/hooks/useActionTypeStyle";
import { getActionsCompatible } from "src/utils/getActionsCompatible";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { StartupConditionEditor } from "../startup-condition/StartupConditionEditor";
import { StartupConditionsConfig } from "src/model/startup-condition/StartupCondition";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import "./ActionTrigger.css";

/**
 * 单个动作复选框项 - 显示动作类型和标题
 */
function ActionCheckboxItem(props: {
	action: IFormAction;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { action, checked, onChange } = props;
	const heading = useActionTitle(action);
	const typeStyle = useActionTypeStyle(action.type);

	return (
		<label className="form--TriggerActionCheckbox">
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span
				className="form--TriggerActionTypeBadge"
				style={typeStyle as React.CSSProperties}
			>
				{action.type}
			</span>
			<span className="form--TriggerActionTitle">
				{heading.title || localInstance.unnamed}
			</span>
		</label>
	);
}

interface ActionTriggerItemProps {
	trigger: ActionTrigger;
	formConfig: FormConfig;
	filePath: string;
	onChange: (trigger: ActionTrigger) => void;
	onDelete: (triggerId: string) => void;
	onDuplicate: (trigger: ActionTrigger) => void;
	defaultOpen?: boolean;
	forceOpen?: boolean;
}

export function ActionTriggerItem(props: ActionTriggerItemProps) {
	const { trigger, formConfig, filePath, onChange, onDelete, onDuplicate, defaultOpen, forceOpen } = props;
	const [open, setOpen] = useState(defaultOpen === true);

	useEffect(() => {
		if (forceOpen) {
			setOpen(true);
		}
	}, [forceOpen]);

	const actions = useMemo(() => getActionsCompatible(formConfig), [formConfig]);
	const selectedCount = trigger.actionIds.length;
	const totalCount = actions.length;

	// 是否显示启动条件编辑器
	const showStartupConditions = trigger.runOnStartup === true || trigger.autoTriggerEnabled === true;

	/** 更新触发器 */
	const updateTrigger = (partial: Partial<ActionTrigger>) => {
		const updated = new ActionTrigger({ ...trigger, ...partial });
		updated.id = trigger.id;
		onChange(updated);
	};

	/** 切换动作选中状态 */
	const toggleAction = (actionId: string, checked: boolean) => {
		const newIds = checked
			? [...trigger.actionIds, actionId]
			: trigger.actionIds.filter((id) => id !== actionId);
		updateTrigger({ actionIds: newIds });
	};

	/** 全选/取消全选 */
	const toggleSelectAll = () => {
		if (selectedCount === totalCount) {
			updateTrigger({ actionIds: [] });
		} else {
			updateTrigger({ actionIds: actions.map((a) => a.id) });
		}
	};

	return (
		<div className="form--ActionTriggerItem">
			{/* 头部 */}
			<div
				className="form--ActionTriggerHeader"
				onClick={() => setOpen(!open)}
			>
				<div className="form--ActionTriggerHeaderLeft">
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					<span className="form--ActionTriggerName">
						{trigger.name || localInstance.trigger_unnamed}
					</span>
					<span className="form--ActionTriggerCount">
						({selectedCount}/{totalCount})
					</span>
				</div>
				<div className="form--ActionTriggerHeaderRight">
					{/* 启用的调用方式图标 */}
					{trigger.commandEnabled && <span title={localInstance.trigger_command}><Terminal size={12} /></span>}
					{trigger.contextMenuEnabled && <span title={localInstance.trigger_context_menu}><MousePointerClick size={12} /></span>}
					{trigger.runOnStartup && <span title={localInstance.trigger_run_on_startup}><Rocket size={12} /></span>}
					{trigger.autoTriggerEnabled && <span title={localInstance.trigger_auto_trigger}><Timer size={12} /></span>}

					<button
						className="form--ActionTriggerIconBtn clickable-icon"
						onClick={(e) => {
							e.stopPropagation();
							onDuplicate(trigger);
						}}
						title={localInstance.copy}
					>
						<Copy size={14} />
					</button>
					<ConfirmPopover
						title={localInstance.trigger_delete_confirm}
						onConfirm={() => onDelete(trigger.id)}
					>
						<button
							className="form--ActionTriggerIconBtn clickable-icon"
							onClick={(e) => e.stopPropagation()}
							title={localInstance.delete}
						>
							<Trash2 size={14} />
						</button>
					</ConfirmPopover>
				</div>
			</div>

			{/* 展开内容 */}
			{open && (
				<div className="form--ActionTriggerContent">
					{/* 触发器名称 */}
					<CpsFormItem label={localInstance.trigger_name}>
						<input
							type="text"
							className="form--TriggerNameInput"
							value={trigger.name}
							placeholder={localInstance.trigger_name_placeholder}
							onChange={(e) => updateTrigger({ name: e.target.value })}
							onClick={(e) => e.stopPropagation()}
						/>
					</CpsFormItem>

					{/* 动作选择 */}
					<CpsFormItem label={localInstance.trigger_actions}>
						<div className="form--TriggerActionList">
							<label className="form--TriggerActionCheckbox form--TriggerSelectAll">
								<input
									type="checkbox"
									checked={selectedCount === totalCount && totalCount > 0}
									ref={(el) => {
										if (el) {
											el.indeterminate = selectedCount > 0 && selectedCount < totalCount;
										}
									}}
									onChange={toggleSelectAll}
								/>
								<span>{localInstance.trigger_select_all}</span>
							</label>
							{actions.map((action) => (
								<ActionCheckboxItem
									key={action.id}
									action={action}
									checked={trigger.actionIds.includes(action.id)}
									onChange={(checked) => toggleAction(action.id, checked)}
								/>
							))}
							{actions.length === 0 && (
								<span className="form--TriggerEmptyHint">
									{localInstance.trigger_no_actions}
								</span>
							)}
						</div>
					</CpsFormItem>

					{/* 调用方式 */}
					<CpsFormItem label={localInstance.trigger_invocation}>
						<div className="form--TriggerToggleGroup">
							<div className="form--TriggerToggleRow">
								<div className="form--TriggerToggleInfo">
									<Terminal size={14} />
									<span>{localInstance.trigger_command}</span>
								</div>
								<ToggleControl
									value={trigger.commandEnabled === true}
									onValueChange={(v: boolean) => updateTrigger({ commandEnabled: v })}
								/>
							</div>
							<div className="form--TriggerToggleRow">
								<div className="form--TriggerToggleInfo">
									<MousePointerClick size={14} />
									<span>{localInstance.trigger_context_menu}</span>
								</div>
								<ToggleControl
									value={trigger.contextMenuEnabled === true}
									onValueChange={(v: boolean) => updateTrigger({ contextMenuEnabled: v })}
								/>
							</div>
							<div className="form--TriggerToggleRow">
								<div className="form--TriggerToggleInfo">
									<Rocket size={14} />
									<span>{localInstance.trigger_run_on_startup}</span>
								</div>
								<ToggleControl
									value={trigger.runOnStartup === true}
									onValueChange={(v: boolean) => updateTrigger({ runOnStartup: v })}
								/>
							</div>
							<div className="form--TriggerToggleRow">
								<div className="form--TriggerToggleInfo">
									<Timer size={14} />
									<span>{localInstance.trigger_auto_trigger}</span>
								</div>
								<ToggleControl
									value={trigger.autoTriggerEnabled === true}
									onValueChange={(v: boolean) => updateTrigger({ autoTriggerEnabled: v })}
								/>
							</div>
						</div>
					</CpsFormItem>

					{/* 启动条件（当启动执行或自动触发启用时显示） */}
					{showStartupConditions && (
						<CpsFormItem label={localInstance.trigger_startup_conditions}>
							<StartupConditionEditor
								config={trigger.startupConditions}
								formFilePath={filePath}
								formConfig={formConfig}
								onChange={(conditions: StartupConditionsConfig) => {
									updateTrigger({ startupConditions: conditions });
								}}
							/>
						</CpsFormItem>
					)}
				</div>
			)}
		</div>
	);
}
