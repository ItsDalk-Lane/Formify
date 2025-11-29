import { FormActionType } from "../enums/FormActionType";
import { SystemPromptMode } from "../enums/SystemPromptMode";
import { PromptSourceType } from "../enums/PromptSourceType";
import { BaseFormAction } from "./BaseFormAction";

export class AIFormAction extends BaseFormAction {
    type: FormActionType.AI;
    
    // AI模型标签（从Tars设置中选择）
    modelTag?: string;
    
    // 系统提示词配置
    systemPromptMode: SystemPromptMode;
    customSystemPrompt?: string;
    
    // 提示词设置
    promptSource: PromptSourceType;
    templateFile?: string;  // 当promptSource为TEMPLATE时使用
    customPrompt?: string;   // 当promptSource为CUSTOM时使用
    
    // 输出变量名
    outputVariableName?: string;

    // 启用流式输出模态框
    enableStreamingModal?: boolean;

    // 内链解析配置
    enableInternalLinkParsing?: boolean;

    constructor(partial?: Partial<AIFormAction>) {
        super(partial);
        this.type = FormActionType.AI;
        this.systemPromptMode = SystemPromptMode.DEFAULT;
        this.promptSource = PromptSourceType.CUSTOM;
        Object.assign(this, partial);
    }
}
