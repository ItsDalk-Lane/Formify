import React, { useMemo, useRef, useEffect } from "react";
import { IFormAction } from "src/model/action/IFormAction";
import { AIFormAction } from "src/model/action/AIFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { SystemPromptMode } from "src/model/enums/SystemPromptMode";
import { PromptSourceType } from "src/model/enums/PromptSourceType";
import { AI_MODEL_SELECT_ON_SUBMIT } from "src/model/action/AIFormActionConstants";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import PromptTemplateFileSuggestInput from "src/component/combobox/PromptTemplateFileSuggestInput";
import { useObsidianApp } from "src/context/obsidianAppContext";

type AISettingProps = {
    value: IFormAction;
    onChange: (value: IFormAction) => void;
};

export function AISetting(props: AISettingProps) {
    const { value, onChange } = props;
    
    if (value.type !== FormActionType.AI) {
        return null;
    }

    const action = value as AIFormAction;
    const app = useObsidianApp();

    // 从app获取插件实例和设置
    const plugin = (app as any).plugins?.plugins?.["formify"];
    const pluginSettings = plugin?.settings;

    // 构建模型选项列表
    const modelOptions: SelectOption2[] = useMemo(() => {
        const providers = pluginSettings?.tars?.settings?.providers || [];
        
        // 添加"请选择"选项作为第一项
        const selectOnSubmitOption: SelectOption2 = {
            label: localInstance.ai_select_on_submit,
            value: AI_MODEL_SELECT_ON_SUBMIT
        };

        if (providers.length === 0) {
            return [
                selectOnSubmitOption,
                {
                    label: localInstance.ai_no_model_configured,
                    value: "__no_model_configured__"
                }
            ];
        }

        const providerOptions = providers.map((provider: any) => ({
            label: `${provider.tag} (${provider.options.model})`,
            value: provider.tag
        }));

        return [selectOnSubmitOption, ...providerOptions];
    }, [pluginSettings]);

    // 系统提示词模式选项
    const systemPromptModeOptions: SelectOption2[] = useMemo(() => [
        {
            label: localInstance.ai_system_prompt_mode_default,
            value: SystemPromptMode.DEFAULT
        },
        {
            label: localInstance.ai_system_prompt_mode_custom,
            value: SystemPromptMode.CUSTOM
        },
        {
            label: localInstance.ai_system_prompt_mode_none,
            value: SystemPromptMode.NONE
        }
    ], []);

    // 提示词来源选项
    const promptSourceOptions: SelectOption2[] = useMemo(() => [
        {
            label: localInstance.ai_prompt_source_template,
            value: PromptSourceType.TEMPLATE
        },
        {
            label: localInstance.ai_prompt_source_custom,
            value: PromptSourceType.CUSTOM
        }
    ], []);

    const handleActionChange = (changes: Partial<AIFormAction>) => {
        const newAction: AIFormAction = {
            ...action,
            ...changes
        };
        onChange(newAction);
    };

    // 自定义系统提示词文本框引用
    const customSystemPromptRef = useRef<HTMLTextAreaElement>(null);
    const customPromptRef = useRef<HTMLTextAreaElement>(null);

    // 自动调整文本框高度
    const adjustTextAreaHeight = (textarea: HTMLTextAreaElement | null) => {
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }
    };

    useEffect(() => {
        adjustTextAreaHeight(customSystemPromptRef.current);
    }, [action.customSystemPrompt]);

    useEffect(() => {
        adjustTextAreaHeight(customPromptRef.current);
    }, [action.customPrompt]);

    // 当提示词来源为模板时，确保 templateFile 被初始化
    useEffect(() => {
        if (action.promptSource === PromptSourceType.TEMPLATE && action.templateFile === undefined) {
            handleActionChange({ templateFile: "" });
        }
    }, [action.promptSource, action.templateFile]);

    return (
        <>
            {/* AI模型选择 */}
            <CpsFormItem
                label={localInstance.ai_model}
                description={localInstance.ai_model_description}
                required
            >
                <Select2
                    options={modelOptions}
                    value={action.modelTag || ""}
                    onChange={(value) => {
                        handleActionChange({ modelTag: value });
                    }}
                />
            </CpsFormItem>

            {/* 系统提示词配置 */}
            <CpsFormItem
                label={localInstance.ai_system_prompt_mode}
                description={localInstance.ai_system_prompt_mode_description}
            >
                <Select2
                    options={systemPromptModeOptions}
                    value={action.systemPromptMode || SystemPromptMode.DEFAULT}
                    onChange={(value) => {
                        handleActionChange({ 
                            systemPromptMode: value as SystemPromptMode 
                        });
                    }}
                />
            </CpsFormItem>

            {/* 自定义系统提示词 - 仅在选择自定义模式时显示 */}
            {action.systemPromptMode === SystemPromptMode.CUSTOM && (
                <CpsFormItem
                    label={localInstance.ai_custom_system_prompt}
                    layout="vertical"
                >
                    <textarea
                        ref={customSystemPromptRef}
                        className="form--textarea"
                        value={action.customSystemPrompt || ""}
                        placeholder={localInstance.ai_custom_system_prompt_placeholder}
                        onChange={(e) => {
                            handleActionChange({ customSystemPrompt: e.target.value });
                            adjustTextAreaHeight(e.target);
                        }}
                        style={{
                            width: "100%",
                            minHeight: "80px",
                            resize: "vertical"
                        }}
                    />
                </CpsFormItem>
            )}

            {/* 提示词设置 */}
            <CpsFormItem
                label={localInstance.ai_prompt_source}
                description={localInstance.ai_prompt_source_description}
                required
            >
                <Select2
                    options={promptSourceOptions}
                    value={action.promptSource || PromptSourceType.CUSTOM}
                    onChange={(value) => {
                        const newPromptSource = value as PromptSourceType;
                        const changes: Partial<AIFormAction> = { 
                            promptSource: newPromptSource 
                        };
                        
                        // 当切换到模板模式时，如果 templateFile 为 undefined，初始化为空字符串（表示"请选择"）
                        if (newPromptSource === PromptSourceType.TEMPLATE && action.templateFile === undefined) {
                            changes.templateFile = "";
                        }
                        
                        handleActionChange(changes);
                    }}
                />
            </CpsFormItem>

            {/* 模板文件选择 - 仅在选择模板时显示 */}
            {action.promptSource === PromptSourceType.TEMPLATE && (
                <CpsFormItem
                    label={localInstance.ai_template_file}
                    description={localInstance.ai_template_folder_description}
                    required
                >
                    <PromptTemplateFileSuggestInput
                        value={action.templateFile || ""}
                        placeholder={localInstance.ai_template_file_placeholder}
                        onChange={(value) => {
                            handleActionChange({ templateFile: value });
                        }}
                    />
                </CpsFormItem>
            )}

            {/* 自定义内容 - 仅在选择自定义时显示 */}
            {action.promptSource === PromptSourceType.CUSTOM && (
                <CpsFormItem
                    label={localInstance.ai_custom_prompt}
                    layout="vertical"
                    required
                >
                    <textarea
                        ref={customPromptRef}
                        className="form--textarea"
                        value={action.customPrompt || ""}
                        placeholder={localInstance.ai_custom_prompt_placeholder}
                        onChange={(e) => {
                            handleActionChange({ customPrompt: e.target.value });
                            adjustTextAreaHeight(e.target);
                        }}
                        style={{
                            width: "100%",
                            minHeight: "120px",
                            resize: "vertical"
                        }}
                    />
                </CpsFormItem>
            )}

            {/* 输出变量名称 */}
            <CpsFormItem
                label={localInstance.ai_output_variable_name}
                description={localInstance.ai_output_variable_description}
            >
                <input
                    type="text"
                    className="form--input"
                    value={action.outputVariableName || ""}
                    placeholder={localInstance.ai_output_variable_name_placeholder}
                    onChange={(e) => {
                        handleActionChange({ outputVariableName: e.target.value });
                    }}
                />
            </CpsFormItem>
        </>
    );
}
