import { useMemo, useCallback, useState } from "react";
import { IFormAction } from "src/model/action/IFormAction";
import { RunCommandFormAction, CommandOption } from "src/model/action/RunCommandFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { CommandSourceMode } from "src/model/enums/CommandSourceMode";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { ObsidianCommandAutocomplete } from "./ObsidianCommandAutocomplete";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { CommandRuntimeFieldsGenerator } from "src/utils/CommandRuntimeFieldsGenerator";
import { localInstance } from "src/i18n/locals";
import { PlusIcon, X } from "lucide-react";
import "./RunCommandSetting.css";

export function RunCommandSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
}) {
	const { value, onChange } = props;
	const app = useObsidianApp();
	
	if (value.type !== FormActionType.RUN_COMMAND) {
		return null;
	}

	const action = value as RunCommandFormAction;
	
	// 获取当前的命令来源模式，默认为 FIXED
	const currentMode = action.commandSourceMode || CommandSourceMode.FIXED;

	// 构建命令来源模式选项
	const sourceModeOptions: SelectOption2[] = useMemo(() => [
		{
			label: localInstance.command_source_mode_fixed,
			value: CommandSourceMode.FIXED
		},
		{
			label: localInstance.command_source_mode_all,
			value: CommandSourceMode.ALL_COMMANDS
		},
		{
			label: localInstance.command_source_mode_single_plugin,
			value: CommandSourceMode.SINGLE_PLUGIN
		},
		{
			label: localInstance.command_source_mode_selected,
			value: CommandSourceMode.SELECTED_COMMANDS
		}
	], []);

	// 获取可用的插件列表
	const pluginOptions: SelectOption2[] = useMemo(() => {
		const plugins = CommandRuntimeFieldsGenerator.getInstalledPlugins(app);
		// 注意：Select2 不允许使用空字符串作为 value，所以直接返回插件列表
		return plugins.map(p => ({ label: p.name, value: p.id }));
	}, [app]);

	// 处理动作变更
	const handleActionChange = useCallback((changes: Partial<RunCommandFormAction>) => {
		const newAction: RunCommandFormAction = {
			...action,
			...changes
		};
		onChange(newAction);
	}, [action, onChange]);

	// 处理模式切换
	const handleModeChange = useCallback((newMode: string) => {
		const mode = newMode as CommandSourceMode;
		const changes: Partial<RunCommandFormAction> = {
			commandSourceMode: mode
		};
		
		// 当切换到固定命令模式时，清除其他模式的配置
		if (mode === CommandSourceMode.FIXED) {
			changes.sourcePluginId = undefined;
			changes.selectedCommands = undefined;
		} else {
			// 当切换到其他模式时，清除固定命令配置
			changes.commandId = undefined;
			changes.commandName = undefined;
		}
		
		handleActionChange(changes);
	}, [handleActionChange]);

	// 处理添加命令到选择列表
	const handleAddCommand = useCallback((command: { id: string; name: string }) => {
		const currentCommands = action.selectedCommands || [];
		// 检查是否已存在
		if (currentCommands.some(c => c.id === command.id)) {
			return;
		}
		handleActionChange({
			selectedCommands: [...currentCommands, command]
		});
	}, [action.selectedCommands, handleActionChange]);

	// 处理从选择列表移除命令
	const handleRemoveCommand = useCallback((commandId: string) => {
		const currentCommands = action.selectedCommands || [];
		handleActionChange({
			selectedCommands: currentCommands.filter(c => c.id !== commandId)
		});
	}, [action.selectedCommands, handleActionChange]);

	return (
		<>
			{/* 命令来源模式选择 */}
			<CpsFormItem
				label={localInstance.command_source_mode}
				className="form--RunCommandSettingItem"
			>
				<Select2
					options={sourceModeOptions}
					value={currentMode}
					onChange={handleModeChange}
				/>
			</CpsFormItem>

			{/* 固定命令模式 - 显示命令选择器 */}
			{currentMode === CommandSourceMode.FIXED && (
				<CpsFormItem
					label={localInstance.command}
					className="form--RunCommandSettingItem"
				>
					<ObsidianCommandAutocomplete
						commandId={action.commandId || ""}
						onChange={(path: { id: string; name: string }) => {
							handleActionChange({
								commandId: path.id,
								commandName: path.name,
							});
						}}
					/>
				</CpsFormItem>
			)}

			{/* 单个插件模式 - 显示插件选择器 */}
			{currentMode === CommandSourceMode.SINGLE_PLUGIN && (
				<CpsFormItem
					label={localInstance.command_source_plugin}
					className="form--RunCommandSettingItem"
				>
					<Select2
						options={pluginOptions}
						value={action.sourcePluginId || ""}
						onChange={(value) => {
							handleActionChange({ sourcePluginId: value });
						}}
					/>
				</CpsFormItem>
			)}

			{/* 选定命令模式 - 显示命令列表和添加按钮 */}
			{currentMode === CommandSourceMode.SELECTED_COMMANDS && (
				<>
					<CpsFormItem
						label={localInstance.add_command}
						className="form--RunCommandSettingItem"
					>
						<ObsidianCommandAutocomplete
							commandId=""
							customTriggerElement={
								<button type="button" aria-label={localInstance.add_command}>
									<PlusIcon size={16} />
								</button>
							}
							onChange={(command: { id: string; name: string }) => {
								if (command.id) {
									handleAddCommand(command);
								}
							}}
						/>
					</CpsFormItem>
					
					{/* 已选择的命令列表 */}
					<CpsFormItem
						label={localInstance.command_source_selected_commands}
						className="form--RunCommandSettingItem"
					>
						<div className="form--SelectedCommandsList">
							{(!action.selectedCommands || action.selectedCommands.length === 0) ? (
								<div className="form--SelectedCommandsEmpty">
									{localInstance.no_commands_selected}
								</div>
							) : (
								action.selectedCommands.map((cmd) => (
									<div key={cmd.id} className="form--SelectedCommandItem">
										<span className="form--SelectedCommandName">{cmd.name}</span>
										<button
											type="button"
											className="form--SelectedCommandRemove"
											onClick={() => handleRemoveCommand(cmd.id)}
											aria-label={localInstance.delete}
										>
											<X size={14} />
										</button>
									</div>
								))
							)}
						</div>
					</CpsFormItem>
				</>
			)}

			{/* 显示提示：运行时选择模式的说明 */}
			{currentMode !== CommandSourceMode.FIXED && (
				<div className="form--RunCommandModeHint">
					{localInstance.select_command_to_run}
				</div>
			)}
		</>
	);
}
