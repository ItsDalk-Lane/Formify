import { FormState } from "../FormState";
import { App } from "obsidian";
import TemplateParser from "./TemplateParser";
import { getEditorSelection } from "src/utils/getEditorSelection";
import { processObTemplate } from "src/utils/templates";
import { convertVariableToString, logTypeConversion, validateFormValues, TypeConversionError } from "src/utils/typeSafety";
import { LoopVariableScope } from "src/utils/LoopVariableScope";

export class FormTemplateProcessEngine {
    async process(text: string, state: FormState, app: App) {
        if (!text || text === "") {
            return "";
        }

        // Validate form values for type-related issues before processing
        const validationErrors = validateFormValues(state.values, {
            actionType: 'template_processing'
        });

        if (validationErrors.length > 0) {
            console.warn('Form template processing validation warnings:', validationErrors);
            // Continue processing but log warnings for debugging
        }

        // if exactly matches {{@variableName}}, return the value as string for consistency
        const pureVariableMatch = text.match(/^{{\@([^}]+)}}$/);
        if (pureVariableMatch) {
            const variableName = pureVariableMatch[1];
            const value = state.values[variableName];
            if (value !== undefined && value !== null) {
                const stringValue = convertVariableToString(value);
                logTypeConversion(
                    {
                        fieldName: variableName,
                        usage: 'pure variable reference',
                        location: 'FormTemplateProcessEngine.process'
                    },
                    value,
                    stringValue,
                    true
                );
                return stringValue;
            }
            return "";
        }

        let res = text;
        res = TemplateParser.compile(res, state);

        // handle {{variableName}} - 支持循环变量引用（无@前缀，非output:格式）
        // 使用更精确的正则表达式避免与{{@...}}和{{output:...}}冲突
        res = res.replace(/\{\{(?![@:])([^}]+)\}\}/g, (match, variableName) => {
            const trimmedName = variableName.trim();

            // 优先从循环变量作用域获取
            const loopValue = LoopVariableScope.getValue(trimmedName);
            if (loopValue !== undefined) {
                return String(loopValue);
            }

            // 然后从表单状态获取
            const formValue = state.values[trimmedName];
            if (formValue !== undefined && formValue !== null) {
                return String(formValue);
            }

            return match;
        });

        // handle {{output:variableName}} - 支持AI动作输出变量引用
        res = res.replace(/\{\{output:([^}]+)\}\}/g, (match, variableName) => {
            const value = state.values[variableName];
            return value !== undefined && value !== null ? String(value) : match;
        });

        // handle {{selection}}
        const selectionVariable = "{{selection}}";
        if (res.includes(selectionVariable)) {
            const selectedText = getEditorSelection(app);
            res = res.replace(selectionVariable, selectedText);
        }

        // handle {{clipboard}}
        const clipboardVariable = "{{clipboard}}";
        if (res.includes(clipboardVariable)) {
            const clipboardText = await navigator.clipboard.readText();
            res = res.replace(clipboardVariable, clipboardText);
        }

        // 最后处理 Obsidian 格式模板
        res = processObTemplate(res);
        return res;
    }
}