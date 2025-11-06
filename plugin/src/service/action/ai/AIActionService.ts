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
import { localInstance } from "src/i18n/locals";
import { DebugLogger } from "src/utils/DebugLogger";
import CommonSuggestModal from "src/component/modal/CommonSuggestModal";
import { AIRuntimeFieldsGenerator } from "src/utils/AIRuntimeFieldsGenerator";

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
            // 获取当前动作在actions数组中的索引
            const actionIndex = chain.index - 1;
            
            // 0. 检查是否需要运行时选择模型
            let modelTag: string | undefined = aiAction.modelTag;
            if (modelTag === AI_MODEL_SELECT_ON_SUBMIT) {
                // 优先从表单值中读取运行时选择的模型
                const runtimeModel = AIRuntimeFieldsGenerator.extractRuntimeModel(actionIndex, state.idValues);
                if (runtimeModel) {
                    modelTag = runtimeModel;
                    DebugLogger.debug(`[AIAction] 从表单读取运行时模型: ${modelTag}`);
                } else {
                    // 如果表单中没有，则弹出对话框选择
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
                const runtimeTemplate = AIRuntimeFieldsGenerator.extractRuntimeTemplate(actionIndex, state.idValues);
                if (runtimeTemplate) {
                    templateFile = runtimeTemplate;
                    DebugLogger.debug(`[AIAction] 从表单读取运行时模板: ${templateFile}`);
                } else {
                    // 如果表单中没有，则弹出对话框选择
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
            const messages: Message[] = [];

            // 2.1 处理系统提示词
            const systemPrompt = await this.buildSystemPrompt(effectiveAction, context);
            if (systemPrompt) {
                messages.push({
                    role: "system",
                    content: systemPrompt
                });
                DebugLogger.debug("[AIAction] 系统提示词:", systemPrompt);
            }

            // 2.2 处理用户提示词
            const userPrompt = await this.buildUserPrompt(effectiveAction, context);
            if (!userPrompt || userPrompt.trim().length === 0) {
                throw new Error(localInstance.ai_prompt_empty);
            }
            messages.push({
                role: "user",
                content: userPrompt
            });
            DebugLogger.debug("[AIAction] 用户提示词:", userPrompt);

            // 3. 调用AI并获取响应
            const response = await this.callAI(provider, messages, context);
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
        const mode = aiAction.systemPromptMode || SystemPromptMode.DEFAULT;

        switch (mode) {
            case SystemPromptMode.NONE:
                // 不使用系统提示词
                return null;

            case SystemPromptMode.CUSTOM:
                // 使用自定义系统提示词
                if (!aiAction.customSystemPrompt) {
                    DebugLogger.warn("[AIAction] 自定义系统提示词模式但内容为空");
                    return null;
                }
                return await this.processTemplate(aiAction.customSystemPrompt, context);

            case SystemPromptMode.DEFAULT:
            default:
                // 使用默认系统提示词
                const plugin = (context.app as any).plugins?.plugins?.["formify"];
                const defaultSystemMsg = plugin?.settings?.tars?.settings?.defaultSystemMsg;
                if (defaultSystemMsg) {
                    return await this.processTemplate(defaultSystemMsg, context);
                }
                return null;
        }
    }

    /**
     * 构建用户提示词
     */
    private async buildUserPrompt(aiAction: AIFormAction, context: ActionContext): Promise<string> {
        const promptSource = aiAction.promptSource || PromptSourceType.CUSTOM;

        if (promptSource === PromptSourceType.TEMPLATE && aiAction.templateFile) {
            // 从模板文件加载
            return await this.loadTemplateFile(aiAction.templateFile, context);
        } else if (promptSource === PromptSourceType.CUSTOM && aiAction.customPrompt) {
            // 使用自定义内容
            return await this.processTemplate(aiAction.customPrompt, context);
        }

        throw new Error(localInstance.ai_prompt_source_invalid);
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
     * 支持：{{@fieldName}} 和 {{output:variableName}}
     */
    private async processTemplate(template: string, context: ActionContext): Promise<string> {
        const engine = new FormTemplateProcessEngine();
        let result = await engine.process(template, context.state, context.app);

        // 处理 {{output:variableName}} 格式的变量
        // 这种格式用于引用之前动作输出的变量
        const outputPattern = /\{\{output:([^}]+)\}\}/g;
        result = result.replace(outputPattern, (_match: string, variableName: string) => {
            const value = context.state.values[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            DebugLogger.warn(`[AIAction] 输出变量未找到: ${variableName}`);
            return "";
        });

        return result;
    }

    /**
     * 调用AI API
     */
    private async callAI(provider: any, messages: Message[], context: ActionContext): Promise<string> {
        // 查找对应的vendor
        const vendor = availableVendors.find((v) => v.name === provider.vendor);
        if (!vendor) {
            throw new Error(`${localInstance.ai_vendor_not_found}: ${provider.vendor}`);
        }

        DebugLogger.debug(`[AIAction] 调用AI模型: ${provider.options.model} (${provider.vendor})`);

        // 创建请求函数
        const sendRequest = vendor.sendRequestFunc(provider.options);
        
        // 创建中断控制器
        const controller = new AbortController();
        
        // 收集响应
        let response = "";
        const notice = new Notice(localInstance.ai_executing, 0);

        try {
            // 使用异步生成器逐块接收响应
            for await (const chunk of sendRequest(
                messages,
                controller,
                async () => new ArrayBuffer(0), // resolveEmbedAsBinary - 不支持嵌入
                undefined // saveAttachment - 不支持保存附件
            )) {
                response += chunk;
                // 更新通知显示当前接收的字符数
                notice.setMessage(`${localInstance.ai_executing} (${response.length} ${localInstance.ai_characters})`);
            }

            notice.hide();
            
            if (response.length === 0) {
                throw new Error(localInstance.ai_response_empty);
            }

            new Notice(localInstance.ai_execution_success, 3000);
            return response;
        } catch (error) {
            notice.hide();
            
            if (error.name === "AbortError") {
                throw new Error(localInstance.ai_execution_cancelled);
            }
            
            throw error;
        }
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
