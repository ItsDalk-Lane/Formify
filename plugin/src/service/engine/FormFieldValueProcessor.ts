import { App } from "obsidian";
import { getEditorSelection } from "src/utils/getEditorSelection";
import { processObTemplate } from "src/utils/templates";
import { DebugLogger } from "src/utils/DebugLogger";

/**
 * 表单字段值处理器
 * 负责处理字段值中的内置变量（{{date}}、{{clipboard}}、{{selection}} 等）
 */
export class FormFieldValueProcessor {
    /**
     * 处理单个字段值中的内置变量
     * @param value 字段值
     * @param app Obsidian App 实例
     * @returns 处理后的值
     */
    async processValue(value: any, app: App): Promise<any> {
        // 只处理字符串类型的值
        if (typeof value !== 'string') {
            return value;
        }

        // 如果值为空，直接返回
        if (!value || value === "") {
            return value;
        }

        DebugLogger.debug(`[FormFieldValueProcessor] 处理字段值: ${value}`);

        let result = value;

        // 处理 {{selection}} 变量
        const selectionVariable = "{{selection}}";
        if (result.includes(selectionVariable)) {
            const selectedText = getEditorSelection(app);
            result = result.replace(new RegExp(selectionVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), selectedText);
            DebugLogger.debug(`[FormFieldValueProcessor] 替换 {{selection}}: ${selectedText}`);
        }

        // 处理 {{clipboard}} 变量
        const clipboardVariable = "{{clipboard}}";
        if (result.includes(clipboardVariable)) {
            const clipboardText = await navigator.clipboard.readText();
            result = result.replace(new RegExp(clipboardVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), clipboardText);
            DebugLogger.debug(`[FormFieldValueProcessor] 替换 {{clipboard}}: ${clipboardText}`);
        }

        // 处理日期时间变量（{{date}}、{{time}} 等）
        const originalResult = result;
        result = processObTemplate(result);
        if (originalResult !== result) {
            DebugLogger.debug(`[FormFieldValueProcessor] 处理日期时间变量: ${originalResult} -> ${result}`);
        }

        return result;
    }

    /**
     * 处理所有字段值中的内置变量
     * @param values 字段值对象（字段ID -> 值）
     * @param app Obsidian App 实例
     * @returns 处理后的字段值对象
     */
    async processValues(values: Record<string, any>, app: App): Promise<Record<string, any>> {
        DebugLogger.debug(`[FormFieldValueProcessor] 开始处理字段值，共 ${Object.keys(values).length} 个字段`);
        
        const processedValues: Record<string, any> = {};

        // 处理每个字段的值
        for (const [fieldId, value] of Object.entries(values)) {
            if (Array.isArray(value)) {
                // 如果是数组，处理数组中的每个元素
                DebugLogger.debug(`[FormFieldValueProcessor] 处理数组字段: ${fieldId}`);
                processedValues[fieldId] = await Promise.all(
                    value.map(item => this.processValue(item, app))
                );
            } else {
                // 处理单个值
                processedValues[fieldId] = await this.processValue(value, app);
            }
        }

        DebugLogger.debug(`[FormFieldValueProcessor] 字段值处理完成`);
        return processedValues;
    }
}
