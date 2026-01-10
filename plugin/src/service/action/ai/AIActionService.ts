import { Notice } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import { AIFormAction } from "src/model/action/AIFormAction";
import { AI_MODEL_SELECT_ON_SUBMIT } from "src/model/action/AIFormActionConstants";
import { FormActionType } from "src/model/enums/FormActionType";
import { SystemPromptMode } from "src/model/enums/SystemPromptMode";
import { PromptSourceType } from "src/model/enums/PromptSourceType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { FormTemplateProcessEngine } from "src/service/engine/FormTemplateProcessEngine";
import { availableVendors } from "src/features/tars/settings";
import { Message } from "src/features/tars/providers";
import { CALLOUT_BLOCK_END, CALLOUT_BLOCK_START } from "src/features/tars/providers/utils";
import { localInstance } from "src/i18n/locals";
import { DebugLogger } from "src/utils/DebugLogger";
import CommonSuggestModal from "src/component/modal/CommonSuggestModal";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";
import { AIStreamingModal, AIStreamingModalOptions } from "src/component/modal/AIStreamingModal";
import "src/component/modal/AIStreamingModal.css";
import { ParseOptions } from "src/service/InternalLinkParserService";
import { PromptBuilder } from "src/service/PromptBuilder";

/**
 * AI动作服务
 * 负责执行AI调用，包括：
 * 1. 模型选择与验证
 * 2. 系统提示词处理（默认/自定义/不使用）
 * 3. 提示词加载（模板文件/自定义内容）
 * 4. 变量替换（{{@fieldName}} 和 {{output:variableName}}）
 * 5. AI API调用（流式输出）
 * 6. 结果存储到输出变量
 */
export default class AIActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.AI;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<void> {
        const aiAction = action as AIFormAction;
        const app = context.app;
        const state = context.state;

        try {
            // 0. 检查是否需要运行时选择模型
            let modelTag: string | undefined = aiAction.modelTag;
            if (modelTag === AI_MODEL_SELECT_ON_SUBMIT) {
                // 优先从表单值中读取运行时选择的模型
                const runtimeModel = AIRuntimeFieldsGenerator.extractRuntimeModel(aiAction.id, state.idValues);
                if (runtimeModel) {
                    modelTag = runtimeModel;
                    DebugLogger.debug(`[AIAction] ✓ 从表单读取运行时模型: ${modelTag} (动作ID: ${aiAction.id})`);
                } else {
                    // 调试信息:打印state.idValues的内容以帮助诊断
                    DebugLogger.debug(`[AIAction] ✗ 未能从表单提取运行时模型 (动作ID: ${aiAction.id})`);
                    DebugLogger.debug(`[AIAction]   期望的字段ID: __ai_runtime_model_${aiAction.id}__`);
                    DebugLogger.debug(`[AIAction]   state.idValues所有键:`, Object.keys(state.idValues));
                    DebugLogger.debug(`[AIAction]   state.idValues完整内容:`, state.idValues);
                    
                    // 如果表单中没有,则弹出对话框选择
                    const selected = await this.selectModelAtRuntime(context);
                    if (!selected) {
                        // 用户取消选择
                        return;
                    }
                    modelTag = selected;
                    DebugLogger.debug(`[AIAction] 从对话框选择模型: ${modelTag}`);
                }
            }

            // 0.1 检查模型是否已选择
            if (!modelTag) {
                const errorMsg = "请先在动作配置中选择AI模型";
                new Notice(errorMsg, 5000);
                throw new Error(errorMsg);
            }

            // 0.2 检查是否需要运行时选择模板
            let templateFile: string | undefined = aiAction.templateFile;
            if (aiAction.promptSource === PromptSourceType.TEMPLATE && templateFile === "") {
                // 优先从表单值中读取运行时选择的模板
                const runtimeTemplate = AIRuntimeFieldsGenerator.extractRuntimeTemplate(aiAction.id, state.idValues);
                if (runtimeTemplate) {
                    templateFile = runtimeTemplate;
                    DebugLogger.debug(`[AIAction] ✓ 从表单读取运行时模板: ${templateFile} (动作ID: ${aiAction.id})`);
                } else {
                    // 调试信息:打印state.idValues的内容以帮助诊断
                    DebugLogger.debug(`[AIAction] ✗ 未能从表单提取运行时模板 (动作ID: ${aiAction.id})`);
                    DebugLogger.debug(`[AIAction]   期望的字段ID: __ai_runtime_template_${aiAction.id}__`);
                    DebugLogger.debug(`[AIAction]   state.idValues所有键:`, Object.keys(state.idValues));
                    DebugLogger.debug(`[AIAction]   state.idValues完整内容:`, state.idValues);
                    
                    // 如果表单中没有,则弹出对话框选择
                    const selected = await this.selectTemplateAtRuntime(context);
                    if (!selected) {
                        // 用户取消选择
                        return;
                    }
                    templateFile = selected;
                    DebugLogger.debug(`[AIAction] 从对话框选择模板: ${templateFile}`);
                }
            }

            // 创建一个临时的action对象，使用运行时选择的值
            const effectiveAction: AIFormAction = {
                ...aiAction,
                modelTag,
                templateFile
            };

            // 1. 获取并验证模型配置
            const provider = this.getProvider(effectiveAction, context);
            if (!provider) {
                throw new Error(localInstance.ai_model_not_found);
            }

            // 2. 构建消息列表
            const systemPrompt = await this.buildSystemPrompt(effectiveAction, context);
            const userPrompt = await this.buildUserPrompt(effectiveAction, context);
            if (!userPrompt || userPrompt.trim().length === 0) {
                throw new Error(localInstance.ai_prompt_empty);
            }

            const promptBuilder = new PromptBuilder(context.app);
            const messages: Message[] = promptBuilder.buildActionProviderMessages(systemPrompt, userPrompt);

            if (systemPrompt) {
                DebugLogger.debug("[AIAction] 系统提示词:", systemPrompt);
            }
            DebugLogger.debug("[AIAction] 用户提示词:", userPrompt);

            // 3. 调用AI并获取响应
            let response: string;
            if (effectiveAction.enableStreamingModal) {
                // 使用流式输出模态框
                response = await this.callAIWithModal(provider, messages, context, effectiveAction, userPrompt);
            } else {
                // 使用传统Notice方式
                response = await this.callAI(provider, messages, context, { includeReasoning: false });
            }
            DebugLogger.debug("[AIAction] AI响应:", response);

            // 4. 存储响应到输出变量
            if (effectiveAction.outputVariableName) {
                state.values[effectiveAction.outputVariableName] = response;
                DebugLogger.debug(`[AIAction] 结果存储到变量: ${effectiveAction.outputVariableName}`);
            }

            // 5. 继续执行下一个动作
            return await chain.next(context);
        } catch (error) {
            DebugLogger.error("[AIAction] 执行失败:", error);
            new Notice(`${localInstance.ai_execution_failed}: ${error.message}`, 5000);
            throw error;
        }
    }

    /**
     * 获取AI提供商配置
     */
    private getProvider(aiAction: AIFormAction, context: ActionContext): any {
        const plugin = (context.app as any).plugins?.plugins?.["formify"];
        if (!plugin || !plugin.settings?.tars?.settings?.providers) {
            DebugLogger.error("[AIAction] 无法获取Tars设置");
            return null;
        }

        const providers = plugin.settings.tars.settings.providers;
        const provider = providers.find((p: any) => p.tag === aiAction.modelTag);
        
        if (!provider) {
            DebugLogger.error(`[AIAction] 未找到模型: ${aiAction.modelTag}`);
        }

        return provider;
    }

    /**
     * 构建系统提示词
     */
    private async buildSystemPrompt(aiAction: AIFormAction, context: ActionContext): Promise<string | null> {
        const plugin = (context.app as any).plugins?.plugins?.["formify"];
        const defaultSystemMsg = plugin?.settings?.tars?.settings?.defaultSystemMsg;

        const activeFile = context.app.workspace.getActiveFile();
        const sourcePath = activeFile?.path ?? '';

        const promptBuilder = new PromptBuilder(context.app);

        if ((aiAction.systemPromptMode || SystemPromptMode.DEFAULT) === SystemPromptMode.CUSTOM && !aiAction.customSystemPrompt) {
            DebugLogger.warn("[AIAction] 自定义系统提示词模式但内容为空");
        }

        // 从 Tars 全局设置读取内链解析配置
        const tarsSettings = plugin?.settings?.tars?.settings;
        const globalParseInTemplates = tarsSettings?.internalLinkParsing?.parseInTemplates ?? true;

        return promptBuilder.buildSystemPrompt({
            mode: aiAction.systemPromptMode || SystemPromptMode.DEFAULT,
            defaultSystemPrompt: defaultSystemMsg,
            customSystemPrompt: aiAction.customSystemPrompt,
            processTemplate: async (template: string) => this.processTemplate(template, context),
            enableInternalLinkParsing: tarsSettings?.internalLinkParsing?.enabled ?? true,
            sourcePath,
            parseOptions: this.getInternalLinkParseOptions(context)
        });
    }

    /**
     * 构建用户提示词
     */
    private async buildUserPrompt(aiAction: AIFormAction, context: ActionContext): Promise<string> {
        const activeFile = context.app.workspace.getActiveFile();
        const sourcePath = activeFile?.path ?? '';

        const promptBuilder = new PromptBuilder(context.app);

        // 从 Tars 全局设置读取内链解析配置
        const plugin = (context.app as any).plugins?.plugins?.["formify"];
        const tarsSettings = plugin?.settings?.tars?.settings;

        try {
            return await promptBuilder.buildUserPrompt({
                promptSource: aiAction.promptSource || PromptSourceType.CUSTOM,
                templateFile: aiAction.templateFile,
                customPrompt: aiAction.customPrompt,
                loadTemplateFile: async (templatePath: string) => this.loadTemplateFile(templatePath, context),
                processTemplate: async (template: string) => this.processTemplate(template, context),
                enableInternalLinkParsing: tarsSettings?.internalLinkParsing?.enabled ?? true,
                sourcePath,
                parseOptions: this.getInternalLinkParseOptions(context)
            });
        } catch (error) {
            if (error instanceof Error && error.message === '提示词来源无效') {
                throw new Error(localInstance.ai_prompt_source_invalid);
            }
            throw error;
        }
    }

    /**
     * 从模板文件加载内容
     */
    private async loadTemplateFile(templatePath: string, context: ActionContext): Promise<string> {
        const app = context.app;
        const engine = new FormTemplateProcessEngine();
        
        // 先处理模板路径中的变量
        const processedPath = await engine.process(templatePath, context.state, app);
        
        try {
            const file = app.vault.getAbstractFileByPath(processedPath);
            if (!file) {
                throw new Error(`${localInstance.file_not_found}: ${processedPath}`);
            }

            const content = await app.vault.read(file as any);
            // 处理文件内容中的变量
            return await this.processTemplate(content, context);
        } catch (error) {
            DebugLogger.error(`[AIAction] 读取模板文件失败: ${processedPath}`, error);
            throw new Error(`${localInstance.ai_template_load_failed}: ${error.message}`);
        }
    }

    /**
     * 处理模板中的变量
     * 支持：{{@fieldName}}、{{output:variableName}}、{{@output:variableName}}
     */
    private async processTemplate(template: string, context: ActionContext): Promise<string> {
        const engine = new FormTemplateProcessEngine();
        let result = await engine.process(template, context.state, context.app);

        // 处理 {{output:variableName}} 格式的变量
        // 这种格式用于引用之前动作输出的变量
        const outputPattern = /\{\{output:([^}]+)\}\}/g;
        result = result.replace(outputPattern, (_match: string, variableName: string) => {
            const name = String(variableName).trim();
            const value = context.state.values[name];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            DebugLogger.warn(`[AIAction] 输出变量未找到: ${name}`);
            return "";
        });

        // 处理 {{@output:variableName}} 格式的变量
        const atOutputPattern = /\{\{@output:([^}]+)\}\}/g;
        result = result.replace(atOutputPattern, (_match: string, variableName: string) => {
            const name = String(variableName).trim();
            const value = context.state.values[name];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            DebugLogger.warn(`[AIAction] 输出变量未找到: ${name}`);
            return "";
        });

        return result;
    }

    private getInternalLinkParseOptions(context: ActionContext): ParseOptions {
        const plugin = (context.app as any).plugins?.plugins?.["formify"];
        const tarsSettings = plugin?.settings?.tars?.settings;

        return {
            enableParsing: true,
            maxDepth: tarsSettings?.maxLinkParseDepth ?? 5,
            timeout: tarsSettings?.linkParseTimeout ?? 5000,
            preserveOriginalOnError: true,
            enableCache: true
        };
    }

    /**
     * 调用AI API
     */
    private async callAI(
        provider: any,
        messages: Message[],
        context: ActionContext,
        options?: { includeReasoning?: boolean }
    ): Promise<string> {
        // 查找对应的vendor
        DebugLogger.logLlmMessages('AIActionService.callAI', messages, { level: 'debug' });
        const vendor = availableVendors.find((v) => v.name === provider.vendor);
        if (!vendor) {
            throw new Error(`${localInstance.ai_vendor_not_found}: ${provider.vendor}`);
        }

        DebugLogger.debug(`[AIAction] 调用AI模型: ${provider.options.model} (${provider.vendor})`);

        // 创建请求函数
        const sendRequest = vendor.sendRequestFunc(provider.options);
        
        // 创建中断控制器
        const controller = new AbortController();
        const linkedAbortHandler = () => {
            controller.abort();
        };

        if (context.abortSignal) {
            if (context.abortSignal.aborted) {
                linkedAbortHandler();
            } else {
                context.abortSignal.addEventListener("abort", linkedAbortHandler);
            }
        }
        
        // 收集响应
        let streamedResponse = "";
        const notice = new Notice(localInstance.ai_executing, 0);

        try {
            // 使用异步生成器逐块接收响应
            for await (const chunk of sendRequest(
                messages,
                controller,
                async () => new ArrayBuffer(0), // resolveEmbedAsBinary - 不支持嵌入
                undefined // saveAttachment - 不支持保存附件
            )) {
                streamedResponse += chunk;
                // 更新通知显示当前接收的字符数
                notice.setMessage(`${localInstance.ai_executing} (${streamedResponse.length} ${localInstance.ai_characters})`);
            }

            notice.hide();
            
            let finalResponse = options?.includeReasoning === false
                ? this.removeReasoningContent(streamedResponse)
                : streamedResponse;

            if (finalResponse.length === 0) {
                throw new Error(localInstance.ai_response_empty);
            }

            new Notice(localInstance.ai_execution_success, 3000);
			DebugLogger.logLlmResponsePreview('AIActionService.callAI', finalResponse, { level: 'debug', previewChars: 100 });
            return finalResponse;
        } catch (error) {
            notice.hide();
            
            if (error.name === "AbortError") {
                throw new Error(localInstance.ai_execution_cancelled);
            }
            
            throw error;
        } finally {
            if (context.abortSignal) {
                context.abortSignal.removeEventListener("abort", linkedAbortHandler);
            }
        }
    }

    /**
     * 使用流式输出模态框调用AI
     */
    private async callAIWithModal(
        provider: any,
        messages: Message[],
        context: ActionContext,
        aiAction: AIFormAction,
        userPrompt: string
    ): Promise<string> {
        // 查找对应的vendor
        DebugLogger.logLlmMessages('AIActionService.callAIWithModal', messages, { level: 'debug' });
        const vendor = availableVendors.find((v) => v.name === provider.vendor);
        if (!vendor) {
            throw new Error(`${localInstance.ai_vendor_not_found}: ${provider.vendor}`);
        }

        DebugLogger.debug(`[AIAction] 使用流式输出模态框调用AI模型: ${provider.options.model} (${provider.vendor})`);

        // 创建请求函数
        const sendRequest = vendor.sendRequestFunc(provider.options);
        
        // 创建中断控制器
        const controller = new AbortController();
        const linkedAbortHandler = () => {
            controller.abort();
        };

        if (context.abortSignal) {
            if (context.abortSignal.aborted) {
                linkedAbortHandler();
            } else {
                context.abortSignal.addEventListener("abort", linkedAbortHandler);
            }
        }

        // 获取提示词显示信息
        const promptInfo = this.getPromptDisplayInfo(aiAction, userPrompt);

        return new Promise<string>((resolve, reject) => {
            let isResolved = false;
            let currentModal: AIStreamingModal | null = null;

            const cleanup = () => {
                if (context.abortSignal) {
                    context.abortSignal.removeEventListener("abort", linkedAbortHandler);
                }
            };

            const handleConfirm = (editedContent: string) => {
                if (isResolved) return;
                isResolved = true;
                cleanup();

                // 移除推理内容
                const finalContent = this.removeReasoningContent(editedContent);
                
                if (finalContent.length === 0) {
                    reject(new Error(localInstance.ai_response_empty));
                } else {
                    new Notice(localInstance.ai_execution_success, 3000);
					DebugLogger.logLlmResponsePreview('AIActionService.callAIWithModal', finalContent, { level: 'debug', previewChars: 100 });
                    resolve(finalContent);
                }
            };

            const handleCancel = () => {
                if (isResolved) return;
                isResolved = true;
                controller.abort();
                cleanup();
                reject(new Error(localInstance.ai_execution_cancelled));
            };

            const handleRefresh = () => {
                if (currentModal) {
                    currentModal.close();
                }
                // 递归调用自己来重新生成
                this.callAIWithModal(provider, messages, context, aiAction, userPrompt)
                    .then(resolve)
                    .catch(reject);
            };

            // 创建模态框选项
            const modalOptions: AIStreamingModalOptions = {
                modelInfo: `${provider.tag} (${provider.options.model})`,
                promptDisplayText: promptInfo.displayText,
                fullPromptContent: promptInfo.fullContent,
                onConfirm: handleConfirm,
                onCancel: handleCancel,
                onRefresh: handleRefresh
            };

            // 创建并打开模态框
            const modal = new AIStreamingModal(context.app, modalOptions);
            currentModal = modal;
            modal.open();

            // 开始流式接收数据
            (async () => {
                try {
                    for await (const chunk of sendRequest(
                        messages,
                        controller,
                        async () => new ArrayBuffer(0),
                        undefined
                    )) {
                        modal.updateContent(chunk);
                    }

                    // 生成完成
                    modal.markAsCompleted();
                } catch (error) {
                    if (isResolved) return; // 已经解决，不再处理错误

                    if (error.name === "AbortError" || error.message?.includes("Request was aborted")) {
                        // 用户取消，已经在handleCancel中处理
                        return;
                    }

                    // 其他错误
                    modal.markAsError(error.message || localInstance.unknown_error);
                    // 不自动关闭模态框，允许用户查看错误信息并选择操作
                }
            })();
        });
    }

    /**
     * 获取提示词显示信息
     */
    private getPromptDisplayInfo(aiAction: AIFormAction, processedPrompt: string): {
        displayText: string;
        fullContent: string;
    } {
        if (aiAction.promptSource === PromptSourceType.TEMPLATE && aiAction.templateFile) {
            // 从模板文件名提取显示文本
            const fileName = this.extractFileName(aiAction.templateFile);
            return {
                displayText: fileName,
                fullContent: processedPrompt
            };
        } else {
            // 自定义提示词
            return {
                displayText: localInstance.ai_streaming_prompt_custom,
                fullContent: processedPrompt
            };
        }
    }

    /**
     * 从文件路径提取文件名
     */
    private extractFileName(filePath: string): string {
        // 移除路径，只保留文件名
        const parts = filePath.split('/');
        let fileName = parts[parts.length - 1];
        
        // 移除.md扩展名
        if (fileName.endsWith('.md')) {
            fileName = fileName.slice(0, -3);
        }
        
        return fileName;
    }

    /**
     * 移除推理过程内容，只保留最终回答
     */
    private removeReasoningContent(content: string): string {
        if (!content.includes(CALLOUT_BLOCK_START)) {
            return content;
        }

        const startToken = CALLOUT_BLOCK_START;
        const endToken = CALLOUT_BLOCK_END;
        let sanitized = "";
        let searchStartIndex = 0;

        while (true) {
            const startIndex = content.indexOf(startToken, searchStartIndex);
            if (startIndex === -1) {
                sanitized += content.slice(searchStartIndex);
                break;
            }

            sanitized += content.slice(searchStartIndex, startIndex);

            const endIndex = content.indexOf(endToken, startIndex + startToken.length);
            if (endIndex === -1) {
                // 如果没有结束标记，认为剩余内容都是推理过程，直接丢弃
                searchStartIndex = content.length;
                break;
            }

            searchStartIndex = endIndex + endToken.length;
        }

        return sanitized;
    }

    /**
     * 运行时选择AI模型
     * 显示一个包含所有可用模型的下拉列表
     */
    private async selectModelAtRuntime(context: ActionContext): Promise<string | null> {
        return new Promise((resolve) => {
            const plugin = (context.app as any).plugins?.plugins?.["formify"];
            if (!plugin || !plugin.settings?.tars?.settings?.providers) {
                new Notice(localInstance.ai_no_model_configured, 5000);
                resolve(null);
                return;
            }

            const providers = plugin.settings.tars.settings.providers;
            if (providers.length === 0) {
                new Notice(localInstance.ai_no_model_configured, 5000);
                resolve(null);
                return;
            }

            // 构建模型选项列表
            const modelOptions = providers.map((provider: any) => ({
                label: `${provider.tag} (${provider.options.model})`,
                value: provider.tag
            }));

            // 显示选择模态框
            const modal = new CommonSuggestModal(
                context.app,
                modelOptions,
                (selected) => {
                    DebugLogger.debug(`[AIAction] 运行时选择模型: ${selected}`);
                    resolve(selected as string);
                },
                () => {
                    DebugLogger.debug("[AIAction] 用户取消模型选择");
                    resolve(null);
                }
            );

            modal.setTitle(localInstance.ai_select_model_prompt);
            modal.open();
        });
    }

    /**
     * 运行时选择提示词模板
     * 显示一个包含配置文件夹中所有模板文件的下拉列表
     */
    private async selectTemplateAtRuntime(context: ActionContext): Promise<string | null> {
        return new Promise((resolve) => {
            const plugin = (context.app as any).plugins?.plugins?.["formify"];
            const templateFolder = plugin?.settings?.promptTemplateFolder || "form/prompt-templates";
            
            // 获取模板文件夹中的所有markdown文件
            const files = context.app.vault.getMarkdownFiles();
            const templateFiles = files.filter(file => 
                file.path.startsWith(templateFolder)
            );

            if (templateFiles.length === 0) {
                new Notice(`${localInstance.ai_template_folder_empty}: ${templateFolder}`, 5000);
                resolve(null);
                return;
            }

            // 构建模板选项列表
            const templateOptions = templateFiles.map(file => ({
                label: file.path.replace(templateFolder + "/", ""),
                value: file.path
            }));

            // 显示选择模态框
            const modal = new CommonSuggestModal(
                context.app,
                templateOptions,
                (selected) => {
                    DebugLogger.debug(`[AIAction] 运行时选择模板: ${selected}`);
                    resolve(selected as string);
                },
                () => {
                    DebugLogger.debug("[AIAction] 用户取消模板选择");
                    resolve(null);
                }
            );

            modal.setTitle(localInstance.ai_select_template_prompt);
            modal.open();
        });
    }
}
