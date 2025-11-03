import { getLanguage } from "obsidian";
import { UpdateFrontmatterFormAction } from "src/model/action/UpdateFrontmatterFormAction";
import { CreateFileFormAction } from "../model/action/CreateFileFormAction";
import { IFormAction } from "../model/action/IFormAction";
import { InsertTextFormAction } from "../model/action/InsertTextFormAction";
import { GenerateFormAction } from "../model/action/OpenFormAction";
import { SuggestModalFormAction } from "../model/action/SuggestModalFormAction";
import { ButtonFormAction } from "../model/action/ButtonFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { ButtonActionType } from "../model/enums/ButtonActionType";
import { TargetFileType } from "../model/enums/TargetFileType";
import { Strings } from "src/utils/Strings";


type FormActionImp = CreateFileFormAction | InsertTextFormAction | UpdateFrontmatterFormAction | GenerateFormAction | SuggestModalFormAction | ButtonFormAction

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
            form_file_required: "Form file is required"
        },
        "zh-CN": {
            target_folder_required: "请填写目标文件夹",
            file_path_required: "请指定文件路径",
            content_required: "请填写内容",
            properties_must_not_be_empty: "至少填写一个属性",
            property_configure_incompleted: "一个或多个属性配置不完整",
            at_leat_one_field_required: "至少填写一个字段",
            url_required: "请填写 URL 地址",
            form_file_required: "请选择表单文件"

        },
        "zh-TW": {
            target_folder_required: "請填寫目標文件夾",
            file_path_required: "請指定文件路徑",
            content_required: "請填寫內容",
            properties_must_not_be_empty: "至少填寫一個屬性",
            property_configure_incompleted: "一個或多個屬性配置不完整",
            at_leat_one_field_required: "至少填寫一個字段",
            url_required: "請填寫 URL 地址",
            form_file_required: "請選擇表單文件"
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
    }

    return {
        isValid: messages.length === 0,
        messages
    };
}