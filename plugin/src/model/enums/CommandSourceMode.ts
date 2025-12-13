/**
 * 命令来源模式
 * 定义在表单提交时如何选择要执行的命令
 */
export enum CommandSourceMode {
    /** 固定命令 - 使用预设的具体命令 */
    FIXED = "fixed",
    /** 所有命令 - 显示系统中所有可用命令 */
    ALL_COMMANDS = "allCommands",
    /** 指定插件 - 仅显示指定插件的命令 */
    SINGLE_PLUGIN = "singlePlugin",
    /** 指定命令 - 手动选择特定的命令列表 */
    SELECTED_COMMANDS = "selectedCommands",
}

/** 命令选择在提交时进行的标记值 */
export const COMMAND_SELECT_ON_SUBMIT = "__select_on_submit__";
