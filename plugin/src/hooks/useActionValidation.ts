import { getLanguage } from "obsidian";
import { UpdateFrontmatterFormAction } from "src/model/action/UpdateFrontmatterFormAction";
import { CreateFileFormAction } from "../model/action/CreateFileFormAction";
import { IFormAction } from "../model/action/IFormAction";
import { InsertTextFormAction } from "../model/action/InsertTextFormAction";
import { GenerateFormAction } from "../model/action/OpenFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { ButtonFormAction } from "../model/action/ButtonFormAction";
import { TextFormAction } from "src/model/action/TextFormAction";
import { AIFormAction } from "src/model/action/AIFormAction";
import { AI_MODEL_SELECT_ON_SUBMIT } from "src/model/action/AIFormActionConstants";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { RunCommandFormAction } from "src/model/action/RunCommandFormAction";
import { LoopType } from "src/model/enums/LoopType";
import { CommandSourceMode } from "src/model/enums/CommandSourceMode";
import { BreakFormAction } from "src/model/action/BreakFormAction";
import { ContinueFormAction } from "src/model/action/ContinueFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { ButtonActionType } from "../model/enums/ButtonActionType";
import { CreateFileMode } from "../model/enums/CreateFileMode";
import { TargetFileType } from "../model/enums/TargetFileType";
import { TextCleanupType } from "src/model/enums/TextCleanupType";
import { TargetMode } from "src/model/enums/TargetMode";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { PromptSourceType } from "src/model/enums/PromptSourceType";
import { Strings } from "src/utils/Strings";


type FormActionImp =
    | CreateFileFormAction
    | InsertTextFormAction
    | UpdateFrontmatterFormAction
    | GenerateFormAction
    | SuggestModalFormAction
    | ButtonFormAction
    | TextFormAction
    | AIFormAction
    | LoopFormAction
    | RunCommandFormAction
    | BreakFormAction
    | ContinueFormAction;

export function useActionValidation(action: IFormAction) {
    const formAction = action as FormActionImp;
    const validationResults = validateAction(formAction);
    return {
        isValid: validationResults.isValid,
        validationMessages: validationResults.messages
    };
}

function validateAction(action: FormActionImp) {
    const messages: string[] = [];
    const i18n = {
        "en": {
            target_folder_required: "Target folder is required",
            file_path_required: "File path is required",
            content_required: "Content is required",
            properties_must_not_be_empty: "At least one property update is required",
            property_configure_incompleted: "One or more property updates are incomplete",
            at_leat_one_field_required: "At least one field is required",
            url_required: "URL is required",
            form_file_required: "Form file is required",
            heading_required: "Heading title is required",
            ai_model_required: "AI model is required",
            ai_prompt_required: "Prompt content is required",
            ai_template_file_required: "Template file is required",
            loop_action_group_required: "Loop requires at least one nested action",
            loop_data_source_required: "Loop data source is required",
            loop_condition_required: "Loop condition expression is required",
            loop_count_range_required: "Count loop requires start and end values",
            loop_pagination_config_required: "Pagination loop requires full configuration",
            command_required: "Please select a command",
            plugin_required: "Please select a plugin",
            commands_required: "Please select at least one command"
        },
        "zh-CN": {
            target_folder_required: "请填写目标文件夹",
            file_path_required: "请指定文件路径",
            content_required: "请填写内容",
            properties_must_not_be_empty: "至少填写一个属性",
            property_configure_incompleted: "一个或多个属性配置不完整",
            at_leat_one_field_required: "至少填写一个字段",
            url_required: "请填写 URL 地址",
            form_file_required: "请选择表单文件",
            heading_required: "请输入目标标题",
            ai_model_required: "请选择AI模型",
            ai_prompt_required: "请填写提示词内容",
            ai_template_file_required: "请选择模板文件",
            loop_action_group_required: "请为循环配置需要执行的动作",
            loop_data_source_required: "请填写循环数据源",
            loop_condition_required: "请填写循环条件表达式",
            loop_count_range_required: "请填写计数循环的起始和结束值",
            loop_pagination_config_required: "请完善分页循环的配置",
            command_required: "请选择要执行的命令",
            plugin_required: "请选择插件",
            commands_required: "请至少选择一个命令"

        },
        "zh-TW": {
            target_folder_required: "請填寫目標文件夾",
            file_path_required: "請指定文件路徑",
            content_required: "請填寫內容",
            properties_must_not_be_empty: "至少填寫一個屬性",
            property_configure_incompleted: "一個或多個屬性配置不完整",
            at_leat_one_field_required: "至少填寫一個字段",
            url_required: "請填寫 URL 地址",
            form_file_required: "請選擇表單文件",
            heading_required: "請輸入目標標題",
            ai_model_required: "請選擇AI模型",
            ai_prompt_required: "請填寫提示詞內容",
            ai_template_file_required: "請選擇模板文件",
            loop_action_group_required: "請為循環設定需要執行的動作",
            loop_data_source_required: "請填寫循環資料來源",
            loop_condition_required: "請填寫循環條件表示式",
            loop_count_range_required: "請填寫計數循環的起始與結束值",
            loop_pagination_config_required: "請完善分頁循環的參數設定",
            command_required: "請選擇要執行的命令",
            plugin_required: "請選擇插件",
            commands_required: "請至少選擇一個命令"
        }
    }


    const lang = getLanguage();
    let l;
    switch (lang) {
        case "zh-CN":
        case "zh":
            l = i18n["zh-CN"];
            break;
        case "zh-TW":
            l = i18n["zh-TW"];
            break;
        default:
            l = i18n["en"];
            break;
    }



    switch (action.type) {
        case FormActionType.CREATE_FILE:
            const createAction = action as CreateFileFormAction;
            const createMode =
                createAction.createFileMode ?? CreateFileMode.SINGLE_FILE;
            if (createMode === CreateFileMode.SINGLE_FILE) {
                if (Strings.isEmpty(createAction.filePath)) {
                    messages.push(l.file_path_required);
                }
            } else if (createMode === CreateFileMode.BATCH_FILES) {
                const paths = (createAction.batchFilePaths ?? []).filter(
                    (item) => Strings.isNotBlank(item)
                );
                if (paths.length === 0) {
                    messages.push(l.file_path_required);
                }
            } else if (createMode === CreateFileMode.SINGLE_FOLDER) {
                if (Strings.isBlank(createAction.folderPath)) {
                    messages.push(l.target_folder_required);
                }
            } else if (createMode === CreateFileMode.BATCH_FOLDERS) {
                const paths = (createAction.batchFolderPaths ?? []).filter(
                    (item) => Strings.isNotBlank(item)
                );
                if (paths.length === 0) {
                    messages.push(l.target_folder_required);
                }
            }
            break;

        case FormActionType.INSERT_TEXT:
            if (action.targetFileType === TargetFileType.SPECIFIED_FILE) {
                if (Strings.isEmpty(action.filePath)) {
                    messages.push(l.file_path_required);
                }
            } else if (action.targetFileType === TargetFileType.MULTIPLE_FILES) {
                const files = (action.targetFiles ?? []).filter((item) =>
                    Strings.isNotBlank(item)
                );
                if (files.length === 0) {
                    messages.push(l.file_path_required);
                }
            }
            if (!action.content) {
                messages.push(l.content_required);
            }
            break;
        case FormActionType.GENERATE_FORM:
            if (!action.fields || action.fields.length === 0) {
                messages.push(l.at_leat_one_field_required);
            }
            break;

        case FormActionType.UPDATE_FRONTMATTER:
            if (action.targetFileType === TargetFileType.SPECIFIED_FILE) {
                if (Strings.isEmpty(action.filePath)) {
                    messages.push(l.file_path_required);
                }
            } else if (action.targetFileType === TargetFileType.MULTIPLE_FILES) {
                const files = (action.targetFiles ?? []).filter((item) =>
                    Strings.isNotBlank(item)
                );
                if (files.length === 0) {
                    messages.push(l.file_path_required);
                }
            }
            const propertyUpdates = action.propertyUpdates || [];
            if (propertyUpdates.length === 0) {
                messages.push(l.properties_must_not_be_empty);
            } else {
                const hasInvalidUpdate = propertyUpdates.some(
                    update => !update.name || update.value === undefined
                );
                if (hasInvalidUpdate) {
                    messages.push(l.property_configure_incompleted);
                }
            }
            break;
        case FormActionType.BUTTON:
            const buttonAction = action as ButtonFormAction;
            switch (buttonAction.buttonActionType) {
                case ButtonActionType.OPEN_URL:
                    if (Strings.isEmpty(buttonAction.url)) {
                        messages.push(l.url_required);
                    }
                    break;
                case ButtonActionType.OPEN_FILE:
                    if (Strings.isEmpty(buttonAction.filePath)) {
                        messages.push(l.file_path_required);
                    }
                    break;
                case ButtonActionType.SUBMIT_FORM:
                    if (Strings.isEmpty(buttonAction.formFilePath)) {
                        messages.push(l.form_file_required);
                    }
                    break;
            }
            break;
        case FormActionType.TEXT:
            const textAction = action as TextFormAction;
            const cleanup = textAction.textCleanupConfig;
            if (!cleanup) {
                break;
            }

            switch (cleanup.type ?? TextCleanupType.CLEAR_FORMAT) {
                case TextCleanupType.CLEAR_FORMAT: {
                    const cfg = cleanup.clearFormatConfig;
                    if (cfg?.targetMode === TargetMode.SPECIFIED) {
                        const files = (cfg.targetFiles ?? []).filter((item) => Strings.isNotBlank(item));
                        if (files.length === 0) {
                            messages.push(l.file_path_required);
                        }
                    }
                    break;
                }
                case TextCleanupType.DELETE_FILE: {
                    const cfg = cleanup.deleteFileConfig;
                    if (cfg?.targetMode === TargetMode.SPECIFIED) {
                        const paths = (cfg.targetPaths ?? []).filter((item) => Strings.isNotBlank(item));
                        if (paths.length === 0) {
                            messages.push(l.file_path_required);
                        }
                    }
                    break;
                }
                case TextCleanupType.MOVE_FILE: {
                    const cfg = cleanup.moveFileConfig;
                    if (cfg?.targetMode === TargetMode.SPECIFIED) {
                        const paths = (cfg.targetPaths ?? []).filter((item) => Strings.isNotBlank(item));
                        if (paths.length === 0) {
                            messages.push(l.file_path_required);
                        }
                    }
                    if (Strings.isBlank(cfg?.destinationFolderPath)) {
                        messages.push(l.target_folder_required);
                    }
                    break;
                }
                case TextCleanupType.DELETE_CONTENT: {
                    const cfg = cleanup.deleteContentConfig;
                    if (cfg?.targetMode === TargetMode.SPECIFIED) {
                        const files = (cfg.targetFiles ?? []).filter((item) => Strings.isNotBlank(item));
                        if (files.length === 0) {
                            messages.push(l.file_path_required);
                        }
                    }
                    if ((cfg?.contentDeleteType ?? ContentDeleteType.ENTIRE_CONTENT) === ContentDeleteType.HEADING_CONTENT) {
                        if (Strings.isBlank(cfg?.headingTitle)) {
                            messages.push(l.heading_required);
                        }
                    }
                    break;
                }
            }
            break;
        case FormActionType.AI:
            const aiAction = action as AIFormAction;
            // 只有在不是"请选择"标记时才验证模型
            if (aiAction.modelTag !== AI_MODEL_SELECT_ON_SUBMIT && Strings.isEmpty(aiAction.modelTag)) {
                messages.push(l.ai_model_required);
            }
            if (aiAction.promptSource === PromptSourceType.TEMPLATE) {
                // 模板文件不需要验证：
                // - undefined 或 "" 表示运行时选择（合法）
                // - 有值表示预配置路径（从下拉列表选择，必然有效）
                // 因此不做任何验证
            } else if (aiAction.promptSource === PromptSourceType.CUSTOM) {
                if (Strings.isEmpty(aiAction.customPrompt)) {
                    messages.push(l.ai_prompt_required);
                }
            }
            break;
        case FormActionType.LOOP:
            const loopAction = action as LoopFormAction;
            if (!loopAction.actionGroupId) {
                messages.push(l.loop_action_group_required);
            }
            switch (loopAction.loopType) {
                case LoopType.LIST:
                    if (Strings.isEmpty(loopAction.listDataSource)) {
                        messages.push(l.loop_data_source_required);
                    }
                    break;
                case LoopType.CONDITION:
                    if (Strings.isEmpty(loopAction.conditionExpression)) {
                        messages.push(l.loop_condition_required);
                    }
                    break;
                case LoopType.COUNT:
                    if (
                        loopAction.countStart === undefined ||
                        loopAction.countEnd === undefined
                    ) {
                        messages.push(l.loop_count_range_required);
                    }
                    break;
                case LoopType.PAGINATION:
                    if (
                        !loopAction.paginationConfig ||
                        Strings.isEmpty(loopAction.paginationConfig.hasNextPageCondition)
                    ) {
                        messages.push(l.loop_pagination_config_required);
                    }
                    break;
            }
            break;
        case FormActionType.RUN_COMMAND:
            const runCommandAction = action as RunCommandFormAction;
            const mode = runCommandAction.commandSourceMode || CommandSourceMode.FIXED;
            
            switch (mode) {
                case CommandSourceMode.FIXED:
                    // 固定命令模式必须选择一个命令
                    if (Strings.isEmpty(runCommandAction.commandId)) {
                        messages.push(l.command_required);
                    }
                    break;
                case CommandSourceMode.SINGLE_PLUGIN:
                    // 单个插件模式必须选择一个插件
                    if (Strings.isEmpty(runCommandAction.sourcePluginId)) {
                        messages.push(l.plugin_required);
                    }
                    break;
                case CommandSourceMode.SELECTED_COMMANDS:
                    // 选定命令模式必须选择至少一个命令
                    if (!runCommandAction.selectedCommands || runCommandAction.selectedCommands.length === 0) {
                        messages.push(l.commands_required);
                    }
                    break;
                case CommandSourceMode.ALL_COMMANDS:
                    // 所有命令模式不需要额外验证
                    break;
            }
            break;
        case FormActionType.BREAK:
        case FormActionType.CONTINUE:
            break;
    }

    return {
        isValid: messages.length === 0,
        messages
    };
}
