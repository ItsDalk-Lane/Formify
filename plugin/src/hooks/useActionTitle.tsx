import { normalizePath } from "obsidian";
import { useMemo } from "react";
import { CreateFileFormAction } from "../model/action/CreateFileFormAction";
import { IFormAction } from "../model/action/IFormAction";
import { InsertTextFormAction } from "../model/action/InsertTextFormAction";
import {
	RunScriptFormAction,
	ScriptSourceType,
} from "../model/action/RunScriptFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { WaitFormAction } from "../model/action/WaitFormAction";
import { ButtonFormAction } from "../model/action/ButtonFormAction";
import { TextFormAction } from "../model/action/TextFormAction";
import { AIFormAction } from "../model/action/AIFormAction";
import { AI_MODEL_SELECT_ON_SUBMIT } from "../model/action/AIFormActionConstants";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { RunCommandFormAction } from "src/model/action/RunCommandFormAction";
import { CollectDataFormAction } from "src/model/action/CollectDataFormAction";
import { LoopType } from "src/model/enums/LoopType";
import { CommandSourceMode } from "src/model/enums/CommandSourceMode";
import { FormActionType } from "../model/enums/FormActionType";
import { ButtonActionType } from "../model/enums/ButtonActionType";
import { TargetFileType } from "../model/enums/TargetFileType";
import { allFormActionTypeOptions } from "../view/edit/setting/action/common/ActionTypeSelect";
import { allFormInsertPositionOptions } from "../view/edit/setting/action/common/InsertPositionSelect";
import { localInstance } from "src/i18n/locals";
import { Strings } from "src/utils/Strings";
import { TextCleanupType } from "src/model/enums/TextCleanupType";

export function useActionTitle(value: IFormAction) {
	const heading = useMemo(() => {
		const typeLabel =
			allFormActionTypeOptions.find((t) => t.value === value.type)?.label ||
			"";

		// 优先使用自定义标题
		if (value.customTitle && value.customTitle.trim()) {
			return {
				type: typeLabel,
				title: value.customTitle.trim(),
			};
		}

		let title = "";

		if (value.type === FormActionType.SUGGEST_MODAL) {
			const suggestAction = value as SuggestModalFormAction;
			if (!suggestAction.fieldName || suggestAction.fieldName === "") {
				title = localInstance.unnamed;
			} else {
				title = suggestAction.fieldName;
			}
		}

		if (value.type === FormActionType.RUN_SCRIPT) {
			const scriptAction = value as RunScriptFormAction;
			if (scriptAction.scriptSource === ScriptSourceType.INLINE) {
				title = scriptAction.title || "";
			}
		}

		if (value.type === FormActionType.CREATE_FILE) {
			const createFileAction = value as CreateFileFormAction;

			if (Strings.isEmpty(createFileAction.filePath)) {
				title = localInstance.file_path_required;
			} else {
				title = normalizePath(createFileAction.filePath);
			}
		}

		if (value.type === FormActionType.INSERT_TEXT) {
			const insertTextAction = value as InsertTextFormAction;
			let file = "";
			let position = "";
			if (
				insertTextAction.targetFileType === TargetFileType.CURRENT_FILE
			) {
				file = localInstance.in_current_file;
				position = "";
			} else {
				if (Strings.isEmpty(insertTextAction.filePath)) {
					title = localInstance.file_path_required;
				} else {
					title = normalizePath(insertTextAction.filePath);
				}
				position =
					allFormInsertPositionOptions.find(
						(p) => p.value === insertTextAction.position
					)?.label || "";
			}

			title = file + " " + position;
		}

		if (value.type === FormActionType.WAIT) {
			const waitAction = value as WaitFormAction;
			const time = waitAction.waitTime ?? 300;
			const unitLabel = localInstance.milliseconds;
			
			title = `${time} ${unitLabel}`;
		}

		if (value.type === FormActionType.RUN_COMMAND) {
			const runCommandAction = value as RunCommandFormAction;
			
			// 根据命令来源模式显示不同的标题
			const mode = runCommandAction.commandSourceMode || CommandSourceMode.FIXED;
			
			if (mode === CommandSourceMode.FIXED) {
				title =
					runCommandAction.commandName ||
					runCommandAction.commandId ||
					localInstance.no_command_selected;
			} else if (mode === CommandSourceMode.ALL_COMMANDS) {
				title = localInstance.command_source_mode_all;
			} else if (mode === CommandSourceMode.SINGLE_PLUGIN) {
				title = runCommandAction.sourcePluginId 
					? `${localInstance.command_source_mode_single_plugin}: ${runCommandAction.sourcePluginId}`
					: localInstance.no_plugin_selected;
			} else if (mode === CommandSourceMode.SELECTED_COMMANDS) {
				const count = runCommandAction.selectedCommands?.length || 0;
				title = count > 0 
					? `${localInstance.command_source_mode_selected} (${count})`
					: localInstance.no_commands_selected;
			}
		}

		if (value.type === FormActionType.BUTTON) {
			const buttonAction = value as ButtonFormAction;
			switch (buttonAction.buttonActionType) {
				case ButtonActionType.OPEN_URL:
					title = buttonAction.url || localInstance.url_required;
					break;
				case ButtonActionType.OPEN_FILE:
					title = buttonAction.filePath || localInstance.file_path_required;
					break;
				case ButtonActionType.SUBMIT_FORM:
					title = buttonAction.formFilePath || localInstance.form_file_required;
					break;
				default:
					title = localInstance.unnamed;
					break;
			}
		}

		if (value.type === FormActionType.TEXT) {
			const textAction = value as TextFormAction;
			const modeLabel =
				textAction.mode === "operation"
					? localInstance.text_action_operation
					: localInstance.text_action_cleanup;
			let detail = "";
			if (textAction.mode === "cleanup") {
				const cleanupType =
					textAction.textCleanupConfig?.type ?? TextCleanupType.CLEAR_FORMAT;
				switch (cleanupType) {
					case TextCleanupType.DELETE_FILE:
						detail = localInstance.text_action_cleanup_feature_delete_file;
						break;
					case TextCleanupType.DELETE_CONTENT:
						detail = localInstance.text_action_cleanup_feature_delete_content;
						break;
					case TextCleanupType.CLEAR_FORMAT:
					default:
						detail = localInstance.text_action_cleanup_feature_clear_format;
						break;
				}
			}
			title = detail ? `${modeLabel} · ${detail}` : modeLabel;
		}

		if (value.type === FormActionType.AI) {
			const aiAction = value as AIFormAction;
			// 如果是"请选择"标记，不显示任何内容
			if (aiAction.modelTag === AI_MODEL_SELECT_ON_SUBMIT) {
				title = "";
			} else if (aiAction.modelTag) {
				title = aiAction.modelTag;
			} else {
				title = localInstance.ai_no_model_configured;
			}
		}

		if (value.type === FormActionType.LOOP) {
			const loopAction = value as LoopFormAction;
			let loopLabel = "";
			switch (loopAction.loopType) {
				case LoopType.LIST:
					loopLabel = localInstance.loop_type_list;
					break;
				case LoopType.CONDITION:
					loopLabel = localInstance.loop_type_condition;
					break;
				case LoopType.COUNT:
					loopLabel = localInstance.loop_type_count;
					break;
				case LoopType.PAGINATION:
					loopLabel = localInstance.loop_type_pagination;
					break;
				default:
					loopLabel = localInstance.loop;
			}

			let detail = "";
			if (loopAction.loopType === LoopType.LIST) {
				detail = loopAction.listDataSource || localInstance.loop_data_source;
			} else if (loopAction.loopType === LoopType.CONDITION) {
				detail =
					loopAction.conditionExpression ||
					localInstance.loop_condition_expression;
			} else if (loopAction.loopType === LoopType.COUNT) {
				detail = `${loopAction.countStart ?? 0} ~ ${loopAction.countEnd ?? 0}`;
			} else if (loopAction.loopType === LoopType.PAGINATION) {
				detail = loopAction.paginationConfig?.currentPageVariable || "";
			}

			title = detail ? `${loopLabel} · ${detail}` : loopLabel;
		}

		if (value.type === FormActionType.BREAK) {
			title = localInstance.break_loop;
		}

		if (value.type === FormActionType.CONTINUE) {
			title = localInstance.continue_loop;
		}

		if (value.type === FormActionType.COLLECT_DATA) {
			const collectDataAction = value as CollectDataFormAction;
			if (collectDataAction.outputVariableName && collectDataAction.outputVariableName.trim()) {
				title = collectDataAction.outputVariableName.trim();
			} else {
				title = localInstance.unnamed;
			}
		}

		return {
			type: typeLabel,
			title: title,
		};
	}, [value]);
	return heading;
}
