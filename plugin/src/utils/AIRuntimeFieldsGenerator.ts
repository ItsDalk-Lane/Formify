import { IFormField } from "src/model/field/IFormField";
import { ISelectField, SelectOption } from "src/model/field/ISelectField";
import { IFormAction } from "src/model/action/IFormAction";
import { AIFormAction } from "src/model/action/AIFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { PromptSourceType } from "src/model/enums/PromptSourceType";
import { AI_MODEL_SELECT_ON_SUBMIT } from "src/model/action/AIFormActionConstants";
import { localInstance } from "src/i18n/locals";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

/**
 * AI运行时字段生成器
 * 用于在表单中动态添加AI模型和模板选择字段
 */
export class AIRuntimeFieldsGenerator {
    /**
     * 生成运行时需要的虚拟表单字段
     * @param actions 表单的所有动作
     * @param app Obsidian App实例
     * @returns 虚拟字段数组
     */
    static generateRuntimeFields(actions: IFormAction[], app: App): IFormField[] {
        const runtimeFields: IFormField[] = [];
        
        actions.forEach((action) => {
            if (action.type !== FormActionType.AI) {
                return;
            }
            
            const aiAction = action as AIFormAction;
            
            // 检查是否需要运行时选择模型
            if (aiAction.modelTag === AI_MODEL_SELECT_ON_SUBMIT) {
                const modelField = this.generateModelField(aiAction, app);
                if (modelField) {
                    runtimeFields.push(modelField);
                }
            }
            
            // 检查是否需要运行时选择模板
            if (aiAction.promptSource === PromptSourceType.TEMPLATE && 
                (aiAction.templateFile === "" || aiAction.templateFile === undefined)) {
                const templateField = this.generateTemplateField(aiAction, app);
                if (templateField) {
                    runtimeFields.push(templateField);
                }
            }
        });
        
        return runtimeFields;
    }
    
    /**
     * 生成模型选择字段
     * @param aiAction AI动作配置
     * @param app Obsidian App实例
     */
    private static generateModelField(aiAction: AIFormAction, app: App): ISelectField | null {
        const plugin = (app as any).plugins?.plugins?.["formify"];
        const providers = plugin?.settings?.tars?.settings?.providers || [];
        
        if (providers.length === 0) {
            return null;
        }
        
        // 构建选项列表
        const options: SelectOption[] = providers.map((provider: any) => ({
            id: uuidv4(),
            label: `${provider.tag} (${provider.options.model})`,
            value: provider.tag
        }));
        
        const fieldId = `__ai_runtime_model_${aiAction.id}__`;
        
        const field: ISelectField = {
            id: fieldId,
            type: FormFieldType.SELECT,
            label: localInstance.ai_select_model_prompt,
            required: true,
            options: options,
            enableCustomValue: true  // 使用 value 而不是 label 作为选项值
        };
        
        return field;
    }
    
    /**
     * 生成模板选择字段
     * @param aiAction AI动作配置
     * @param app Obsidian App实例
     */
    private static generateTemplateField(aiAction: AIFormAction, app: App): ISelectField | null {
        const plugin = (app as any).plugins?.plugins?.["formify"];
        const promptTemplateFolder = plugin?.settings?.promptTemplateFolder || "form/prompt-templates";
        
        // 获取模板文件夹中的所有markdown文件
        const files = app.vault.getMarkdownFiles();
        const templateFiles = files.filter(file => 
            file.path.startsWith(promptTemplateFolder)
        );
        
        if (templateFiles.length === 0) {
            return null;
        }
        
        // 构建选项列表
        const options: SelectOption[] = templateFiles.map(file => ({
            id: uuidv4(),
            label: file.path.replace(promptTemplateFolder + "/", ""),
            value: file.path
        }));
        
        const field: ISelectField = {
            id: `__ai_runtime_template_${aiAction.id}__`,
            type: FormFieldType.SELECT,
            label: localInstance.ai_select_template_prompt,
            required: true,
            options: options,
            enableCustomValue: true  // 使用 value 而不是 label 作为选项值
        };
        
        return field;
    }
    
    /**
     * 从表单值中提取运行时选择的模型
     * @param actionId AI动作的唯一ID
     * @param formValues 表单值对象
     * @returns 提取到的模型tag,如果未找到则返回null
     */
    static extractRuntimeModel(actionId: string, formValues: Record<string, any>): string | null {
        const fieldId = `__ai_runtime_model_${actionId}__`;
        const value = formValues[fieldId];
        return value || null;
    }
    
    /**
     * 从表单值中提取运行时选择的模板
     * @param actionId AI动作的唯一ID
     * @param formValues 表单值对象
     * @returns 提取到的模板路径,如果未找到则返回null
     */
    static extractRuntimeTemplate(actionId: string, formValues: Record<string, any>): string | null {
        const fieldId = `__ai_runtime_template_${actionId}__`;
        const value = formValues[fieldId];
        return value || null;
    }
}
