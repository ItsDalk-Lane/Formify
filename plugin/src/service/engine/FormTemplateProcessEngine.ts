import { FormState } from "../FormState";
import { App } from "obsidian";
import TemplateParser from "./TemplateParser";
import { getEditorSelection, getCurrentFileContent } from "src/utils/getEditorSelection";
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

        // if exactly matches {{@variableName}} OR {{@output:variableName}}, return the value as string for consistency
        const pureVariableMatch = text.match(/^{{\@([^}]+)}}$/);
        if (pureVariableMatch) {
            const rawName = pureVariableMatch[1]?.trim();
            if (!rawName) {
                return "";
            }

            // 支持 {{@output:variableName}}
            if (rawName.startsWith("output:")) {
                const outputName = rawName.slice("output:".length).trim();
                const outputValue = state.values[outputName];
                return outputValue !== undefined && outputValue !== null
                    ? convertVariableToString(outputValue)
                    : "";
            }

            const value = state.values[rawName];
            if (value !== undefined && value !== null) {
                const stringValue = convertVariableToString(value);
                logTypeConversion(
                    {
                        fieldName: rawName,
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
        // 当变量不存在时返回空字符串，确保AI动作未执行时不会残留占位符
        res = res.replace(/\{\{output:([^}]+)\}\}/g, (match, variableName) => {
            const name = String(variableName).trim();
            const value = state.values[name];
            return value !== undefined && value !== null ? String(value) : "";
        });

        // handle {{@output:variableName}} - 与文档/界面提示保持一致
        // 当变量不存在时返回空字符串，确保AI动作未执行时不会残留占位符
        res = res.replace(/\{\{@output:([^}]+)\}\}/g, (match, variableName) => {
            const name = String(variableName).trim();
            const value = state.values[name];
            return value !== undefined && value !== null ? String(value) : "";
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

        // handle {{currentFile}} - 获取当前活动Markdown文件的内容
        const currentFileVariable = "{{currentFile}}";
        if (res.includes(currentFileVariable)) {
            const fileContent = await getCurrentFileContent(app);
            res = res.replace(currentFileVariable, fileContent);
        }

        // handle {{currentFile:metadata}} - 获取包含元数据的当前文件内容
        const currentFileWithMetadataVariable = "{{currentFile:metadata}}";
        if (res.includes(currentFileWithMetadataVariable)) {
            const fileContent = await getCurrentFileContent(app, { includeMetadata: true });
            res = res.replace(currentFileWithMetadataVariable, fileContent);
        }

        // handle {{currentFile:plain}} - 获取当前文件的纯文本内容（无格式）
        const currentFilePlainVariable = "{{currentFile:plain}}";
        if (res.includes(currentFilePlainVariable)) {
            const fileContent = await getCurrentFileContent(app, { plainText: true });
            res = res.replace(currentFilePlainVariable, fileContent);
        }

        // handle {{currentFile:metadata:plain}} - 获取包含元数据的纯文本内容
        const currentFileMetadataPlainVariable = "{{currentFile:metadata:plain}}";
        if (res.includes(currentFileMetadataPlainVariable)) {
            const fileContent = await getCurrentFileContent(app, { includeMetadata: true, plainText: true });
            res = res.replace(currentFileMetadataPlainVariable, fileContent);
        }

        // 最后处理 Obsidian 格式模板
        res = processObTemplate(res);
        return res;
    }
}