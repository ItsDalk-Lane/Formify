import { FormConfig } from "../model/FormConfig";
import { IFormField } from "../model/field/IFormField";
import { FormFieldType } from "../model/enums/FormFieldType";
import { ISelectField } from "../model/field/ISelectField";
import { BaseTimeField, TimeFieldDefaultValueType } from "../model/field/time/BaseTimeField";
import { isTimeFormField } from "./isTimeFormField";
import { AIFormAction } from "../model/action/AIFormAction";
import { RunCommandFormAction } from "../model/action/RunCommandFormAction";
import { FormActionType } from "../model/enums/FormActionType";
import { PromptSourceType } from "../model/enums/PromptSourceType";
import { CommandSourceMode } from "../model/enums/CommandSourceMode";
import { AI_MODEL_SELECT_ON_SUBMIT } from "../model/action/AIFormActionConstants";
import { Strings } from "./Strings";
import { IFormAction } from "../model/action/IFormAction";

/**
 * 表单提交界面显示规则系统
 * 根据字段默认值和AI动作配置决定是否需要显示表单界面
 */
export class FormDisplayRules {

    /**
     * 检查表单提交时是否需要显示界面
     * @param formConfig 表单配置
     * @returns 如果需要显示界面返回true，否则返回false
     */
    static shouldShowForm(formConfig: FormConfig): boolean {
        // 检查字段默认值
        const fieldResult = this.checkFieldDefaults(formConfig.fields);
        if (fieldResult.needsUserInput) {
            return true;
        }

        // 检查AI动作配置
        const aiActionResult = this.checkAIActionDefaults(formConfig.actions);
        if (aiActionResult.needsUserInput) {
            return true;
        }

        // 检查命令动作配置
        const commandActionResult = this.checkCommandActionDefaults(formConfig.actions);
        if (commandActionResult.needsUserInput) {
            return true;
        }

        // 所有字段都有默认值且动作配置完整，不显示表单界面
        return false;
    }

    /**
     * 获取需要用户输入的字段列表
     * @param formConfig 表单配置
     * @returns 需要显示的字段列表
     */
    static getFieldsNeedingInput(formConfig: FormConfig): IFormField[] {
        const result = this.checkFieldDefaults(formConfig.fields);
        return result.fieldsNeedingInput;
    }

    /**
     * 检查字段默认值情况
     * @param fields 字段列表
     * @returns 检查结果
     */
    private static checkFieldDefaults(fields: IFormField[]): {
        needsUserInput: boolean;
        fieldsNeedingInput: IFormField[];
    } {
        const fieldsNeedingInput: IFormField[] = [];

        for (const field of fields) {
            if (!this.isFieldHasDefaultValue(field)) {
                fieldsNeedingInput.push(field);
            }
        }

        return {
            needsUserInput: fieldsNeedingInput.length > 0,
            fieldsNeedingInput
        };
    }

    /**
     * 检查单个字段是否有默认值
     * @param field 字段
     * @returns 是否有默认值
     */
    static isFieldHasDefaultValue(field: IFormField): boolean {
        switch (field.type) {
            case FormFieldType.TEXT:
            case FormFieldType.TEXTAREA:
            case FormFieldType.NUMBER:
            case FormFieldType.PASSWORD:
            case FormFieldType.FOLDER_PATH:
                // 简单类型：检查defaultValue是否有值
                return !Strings.isEmpty(field.defaultValue);
            case FormFieldType.DATABASE:
                // 数据库字段：运行时计算，不需要用户输入
                return true;

            case FormFieldType.DATE:
            case FormFieldType.TIME:
            case FormFieldType.DATETIME:
                // 时间类型：根据默认值类型判断
                return this.isTimeFieldHasDefaultValue(field as BaseTimeField);

            case FormFieldType.CHECKBOX:
            case FormFieldType.TOGGLE:
                // 开关类型：始终视为未设置默认值，需要用户交互
                return false;

            case FormFieldType.SELECT:
            case FormFieldType.RADIO:
                // 下拉列表和单选框：检查是否有具体默认值
                return this.isSelectFieldHasDefaultValue(field as ISelectField);

            case FormFieldType.FILE_LIST:
                // 文件列表：检查是否有默认值
                return Array.isArray(field.defaultValue) && field.defaultValue.length > 0;

            default:
                // 其他类型：检查defaultValue
                return !Strings.isEmpty(field.defaultValue);
        }
    }

    /**
     * 检查时间字段是否有默认值
     * @param field 时间字段
     * @returns 是否有默认值
     */
    private static isTimeFieldHasDefaultValue(field: BaseTimeField): boolean {
        if (field.defaultValueType === TimeFieldDefaultValueType.CURRENT) {
            // 设置为"现在"时，视为已设置默认值
            return true;
        } else if (field.defaultValueType === TimeFieldDefaultValueType.CUSTOM) {
            // 设置为"具体时间"时，视为未设置默认值
            return false;
        }
        return false;
    }

    /**
     * 检查下拉列表/单选框字段是否有默认值
     * @param field 下拉列表/单选框字段
     * @returns 是否有默认值
     */
    private static isSelectFieldHasDefaultValue(field: ISelectField): boolean {
        const options = field.options || [];
        const enableCustomValue = field.enableCustomValue === true;

        if (field.multiple) {
            // 多选模式：检查是否有默认值数组
            const def = Array.isArray(field.defaultValue) ? field.defaultValue : [];
            return def.length > 0 && def.every(v => !Strings.isEmpty(v));
        } else {
            // 单选模式：检查是否有具体的默认值
            const defaultValue = field.defaultValue;
            if (Strings.isEmpty(defaultValue)) {
                return false;
            }

            // 检查默认值是否在选项中
            if (enableCustomValue) {
                return true; // 自定义值模式下，有值就算有默认值
            } else {
                return options.some(option => option.value === defaultValue || option.label === defaultValue);
            }
        }
    }

    /**
     * 检查AI动作配置情况
     * @param actions 动作列表
     * @returns 检查结果
     */
    private static checkAIActionDefaults(actions: any[]): {
        needsUserInput: boolean;
        actionsNeedingInput: any[];
    } {
        const actionsNeedingInput: any[] = [];

        for (const action of actions) {
            if (action.type === FormActionType.AI) {
                const aiAction = action as AIFormAction;
                if (!this.isAIActionConfigured(aiAction)) {
                    actionsNeedingInput.push(aiAction);
                }
            }
        }

        return {
            needsUserInput: actionsNeedingInput.length > 0,
            actionsNeedingInput
        };
    }

    /**
     * 检查AI动作是否已配置完整
     * @param aiAction AI动作
     * @returns 是否已配置完整
     */
    static isAIActionConfigured(aiAction: AIFormAction): boolean {
        // 检查模型设置
        // 如果模型设置为"按提交时选择"，则认为配置不完整，需要用户在表单中选择
        const hasModel = !Strings.isEmpty(aiAction.modelTag) &&
                        aiAction.modelTag !== AI_MODEL_SELECT_ON_SUBMIT;

        // 检查提示词设置
        let hasPrompt = false;
        if (aiAction.promptSource === PromptSourceType.CUSTOM) {
            hasPrompt = !Strings.isEmpty(aiAction.customPrompt);
        } else if (aiAction.promptSource === PromptSourceType.TEMPLATE) {
            // 如果模板设置为空字符串或undefined（表示"按提交时选择"），则认为配置不完整
            hasPrompt = !Strings.isEmpty(aiAction.templateFile);
        }

        return hasModel && hasPrompt;
    }

    /**
     * 获取需要配置的AI动作列表
     * @param formConfig 表单配置
     * @returns 需要配置的AI动作列表
     */
    static getActionsNeedingInput(formConfig: FormConfig): AIFormAction[] {
        const result = this.checkAIActionDefaults(formConfig.actions);
        return result.actionsNeedingInput;
    }

    /**
     * 检查命令动作配置情况
     * @param actions 动作列表
     * @returns 检查结果
     */
    private static checkCommandActionDefaults(actions: IFormAction[]): {
        needsUserInput: boolean;
        actionsNeedingInput: RunCommandFormAction[];
    } {
        const actionsNeedingInput: RunCommandFormAction[] = [];

        for (const action of actions) {
            if (action.type === FormActionType.RUN_COMMAND) {
                const commandAction = action as RunCommandFormAction;
                // 直接检查属性，因为从JSON反序列化的对象不是类实例
                const mode = commandAction.commandSourceMode || CommandSourceMode.FIXED;
                let needsSelection = false;
                
                if (mode === CommandSourceMode.FIXED) {
                    // 固定命令模式下，如果没有命令ID则需要用户输入
                    needsSelection = Strings.isEmpty(commandAction.commandId);
                } else {
                    // 非固定命令模式（所有命令、指定插件、指定命令列表）总是需要运行时选择
                    needsSelection = true;
                }
                
                if (needsSelection) {
                    actionsNeedingInput.push(commandAction);
                }
            }
        }

        return {
            needsUserInput: actionsNeedingInput.length > 0,
            actionsNeedingInput
        };
    }

    /**
     * 获取需要运行时选择命令的动作列表
     * @param formConfig 表单配置
     * @returns 需要运行时选择命令的动作列表
     */
    static getCommandActionsNeedingInput(formConfig: FormConfig): RunCommandFormAction[] {
        const result = this.checkCommandActionDefaults(formConfig.actions);
        return result.actionsNeedingInput;
    }
}
