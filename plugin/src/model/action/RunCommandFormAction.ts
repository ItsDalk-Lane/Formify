import { FormActionType } from "../enums/FormActionType";
import { CommandSourceMode } from "../enums/CommandSourceMode";
import { BaseFormAction } from "./BaseFormAction";

/**
 * 命令选项，用于存储手动选择的命令列表
 */
export interface CommandOption {
    id: string;
    name: string;
}

/**
 * 执行命令动作
 * 支持两种模式：
 * 1. 固定命令模式 - 使用预设的具体命令（commandId）
 * 2. 运行时选择模式 - 在表单提交时从下拉列表选择命令
 */
export class RunCommandFormAction extends BaseFormAction {
    type: FormActionType.RUN_COMMAND;
    
    /** 固定命令ID，当 commandSourceMode 为 FIXED 时使用 */
    commandId?: string;
    /** 固定命令名称，用于显示 */
    commandName?: string;
    
    /** 命令来源模式，默认为 FIXED（固定命令） */
    commandSourceMode?: CommandSourceMode;
    /** 指定的插件ID，当 commandSourceMode 为 SINGLE_PLUGIN 时使用 */
    sourcePluginId?: string;
    /** 手动选择的命令列表，当 commandSourceMode 为 SELECTED_COMMANDS 时使用 */
    selectedCommands?: CommandOption[];

    constructor(partial?: Partial<RunCommandFormAction>) {
        super(partial);
        this.type = FormActionType.RUN_COMMAND;
        Object.assign(this, partial);
    }

    /**
     * 检查是否需要在运行时选择命令
     * @returns 如果需要运行时选择返回true
     */
    needsRuntimeSelection(): boolean {
        return this.commandSourceMode !== undefined && 
               this.commandSourceMode !== CommandSourceMode.FIXED &&
               !this.commandId;
    }
}

