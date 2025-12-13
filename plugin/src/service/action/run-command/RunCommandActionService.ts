import { Notice } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import { RunCommandFormAction } from "src/model/action/RunCommandFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { CommandSourceMode } from "src/model/enums/CommandSourceMode";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { CommandRuntimeFieldsGenerator } from "src/utils/CommandRuntimeFieldsGenerator";
import { localInstance } from "src/i18n/locals";
import { DebugLogger } from "src/utils/DebugLogger";

export class RunCommandActionService implements IActionService {

    accept(action: IFormAction, context: ActionContext): boolean {
        return action.type === FormActionType.RUN_COMMAND;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain) {
        const formAction = action as RunCommandFormAction;
        const app = context.app;
        const state = context.state;
        
        let commandId: string | undefined = formAction?.commandId;
        
        // 检查是否需要从运行时表单值中获取命令
        // 注意：从JSON反序列化的对象不是类实例，需要直接检查属性
        const mode = formAction.commandSourceMode || CommandSourceMode.FIXED;
        let needsRuntimeSelection = false;
        
        if (mode === CommandSourceMode.FIXED) {
            // 固定命令模式下，如果没有命令ID则需要从运行时获取
            needsRuntimeSelection = !commandId;
        } else {
            // 非固定命令模式（所有命令、指定插件、指定命令列表）总是需要运行时选择
            needsRuntimeSelection = true;
        }
        
        if (needsRuntimeSelection) {
            const runtimeCommand = CommandRuntimeFieldsGenerator.extractRuntimeCommand(
                formAction.id, 
                state.idValues
            );
            
            if (runtimeCommand) {
                commandId = runtimeCommand;
                DebugLogger.debug(`[RunCommand] ✓ 从表单读取运行时命令: ${commandId} (动作ID: ${formAction.id})`);
            } else {
                DebugLogger.debug(`[RunCommand] ✗ 未能从表单提取运行时命令 (动作ID: ${formAction.id})`);
                DebugLogger.debug(`[RunCommand]   期望的字段ID: __command_runtime_select_${formAction.id}__`);
                DebugLogger.debug(`[RunCommand]   state.idValues所有键:`, Object.keys(state.idValues));
            }
        }
        
        if (!commandId) {
            const errorMsg = localInstance.no_command_selected;
            new Notice(errorMsg, 3000);
            return Promise.reject(new Error(errorMsg));
        }
        
        // 执行命令
        try {
            app.commands.executeCommandById(commandId);
            DebugLogger.debug(`[RunCommand] 命令已执行: ${commandId}`);
        } catch (error) {
            DebugLogger.error(`[RunCommand] 命令执行失败: ${commandId}`, error);
            throw error;
        }
        
        return await chain.next(context);
    }

}