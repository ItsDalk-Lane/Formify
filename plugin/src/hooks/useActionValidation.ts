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
import { FormActionType } from "../model/enums/FormActionType";
import { ButtonActionType } from "../model/enums/ButtonActionType";
import { TargetFileType } from "../model/enums/TargetFileType";
import { TextCleanupType } from "src/model/enums/TextCleanupType";
import { TargetMode } from "src/model/enums/TargetMode";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { PromptSourceType } from "src/model/enums/PromptSourceType";
import { Strings } from "src/utils/Strings";


type FormActionImp = CreateFileFormAction | InsertTextFormAction | UpdateFrontmatterFormAction | GenerateFormAction | SuggestModalFormAction | ButtonFormAction | TextFormAction | AIFormAction

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
            ai_template_file_required: "Template file is required"
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
            ai_template_file_required: "请选择模板文件"

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
            ai_template_file_required: "請選擇模板文件"
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
            if (Strings.isEmpty(action.filePath)) {
                messages.push(l.file_path_required);
            }
            break;

        case FormActionType.INSERT_TEXT:
            if (action.targetFileType !== TargetFileType.CURRENT_FILE) {
                if (Strings.isEmpty(action.filePath)) {
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
            if (action.targetFileType !== TargetFileType.CURRENT_FILE) {
                if (Strings.isEmpty(action.filePath)) {
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
    }

    return {
        isValid: messages.length === 0,
        messages
    };
}
