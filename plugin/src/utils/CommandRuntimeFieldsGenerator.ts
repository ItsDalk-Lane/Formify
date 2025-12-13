import { IFormField } from "src/model/field/IFormField";
import { ISelectField, SelectOption } from "src/model/field/ISelectField";
import { IFormAction } from "src/model/action/IFormAction";
import { RunCommandFormAction } from "src/model/action/RunCommandFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { CommandSourceMode } from "src/model/enums/CommandSourceMode";
import { localInstance } from "src/i18n/locals";
import { App, Command, PluginManifest } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { Strings } from "src/utils/Strings";

/**
 * 命令运行时字段生成器
 * 用于在表单提交界面动态生成命令选择字段
 */
export class CommandRuntimeFieldsGenerator {
    
    /**
     * 生成运行时需要的命令选择字段
     * @param actions 表单的所有动作
     * @param app Obsidian App实例
     * @returns 虚拟字段数组
     */
    static generateRuntimeFields(actions: IFormAction[], app: App): IFormField[] {
        const runtimeFields: IFormField[] = [];
        
        actions.forEach((action) => {
            if (action.type !== FormActionType.RUN_COMMAND) {
                return;
            }
            
            const runCommandAction = action as RunCommandFormAction;
            
            // 检查是否需要运行时选择命令
            // 注意：从JSON反序列化的对象不是类实例，需要直接检查属性
            const needsRuntimeSelection = this.needsRuntimeSelection(runCommandAction);
            if (needsRuntimeSelection) {
                const commandField = this.generateCommandField(runCommandAction, app);
                if (commandField) {
                    runtimeFields.push(commandField);
                }
            }
        });
        
        return runtimeFields;
    }
    
    /**
     * 检查命令动作是否需要运行时选择
     * @param action 执行命令动作配置
     * @returns 如果需要运行时选择返回true
     */
    private static needsRuntimeSelection(action: RunCommandFormAction): boolean {
        const mode = action.commandSourceMode || CommandSourceMode.FIXED;
        
        // 固定命令模式下，检查是否已设置命令ID
        if (mode === CommandSourceMode.FIXED) {
            // 如果有命令ID，不需要运行时选择
            // 如果没有命令ID，需要运行时选择
            return Strings.isEmpty(action.commandId);
        }
        
        // 非固定命令模式（所有命令、指定插件、指定命令列表）总是需要运行时选择
        return true;
    }
    
    /**
     * 生成命令选择字段
     * @param action 执行命令动作配置
     * @param app Obsidian App实例
     */
    private static generateCommandField(action: RunCommandFormAction, app: App): ISelectField | null {
        const commands = this.getFilteredCommands(action, app);
        
        if (commands.length === 0) {
            return null;
        }
        
        // 构建选项列表，包含命令名称和所属插件信息
        const options: SelectOption[] = commands.map((command: Command) => {
            const pluginName = this.getPluginNameForCommand(command.id, app);
            const label = pluginName ? `${command.name} (${pluginName})` : command.name;
            return {
                id: uuidv4(),
                label: label,
                value: command.id
            };
        });
        
        const fieldId = `__command_runtime_select_${action.id}__`;
        
        const field: ISelectField = {
            id: fieldId,
            type: FormFieldType.SELECT,
            label: localInstance.select_command_to_run,
            required: true,
            options: options,
            enableCustomValue: true,
            searchable: true,
            searchPlaceholder: localInstance.search_commands
        };
        
        return field;
    }
    
    /**
     * 根据配置过滤命令列表
     * @param action 执行命令动作配置
     * @param app Obsidian App实例
     */
    private static getFilteredCommands(action: RunCommandFormAction, app: App): Command[] {
        // @ts-ignore - 访问 Obsidian 内部 API
        const allCommands: Record<string, Command> = app.commands.commands;
        const commandList = Object.values(allCommands);
        
        switch (action.commandSourceMode) {
            case CommandSourceMode.ALL_COMMANDS:
                return commandList;
                
            case CommandSourceMode.SINGLE_PLUGIN:
                if (!action.sourcePluginId) {
                    return commandList;
                }
                return commandList.filter(cmd => 
                    cmd.id.startsWith(action.sourcePluginId + ":")
                );
                
            case CommandSourceMode.SELECTED_COMMANDS:
                if (!action.selectedCommands || action.selectedCommands.length === 0) {
                    return [];
                }
                const selectedIds = new Set(action.selectedCommands.map(c => c.id));
                return commandList.filter(cmd => selectedIds.has(cmd.id));
                
            default:
                return [];
        }
    }
    
    /**
     * 获取命令所属插件的名称
     * @param commandId 命令ID
     * @param app Obsidian App实例
     */
    private static getPluginNameForCommand(commandId: string, app: App): string | null {
        // 命令ID格式通常为 "plugin-id:command-name"
        const colonIndex = commandId.indexOf(":");
        if (colonIndex === -1) {
            // 核心命令没有冒号前缀
            return "Obsidian";
        }
        
        const pluginId = commandId.substring(0, colonIndex);
        
        // 尝试获取插件名称
        // @ts-ignore - 访问 Obsidian 内部 API
        const plugins = app.plugins?.plugins;
        if (plugins && plugins[pluginId]) {
            const manifest: PluginManifest = plugins[pluginId].manifest;
            return manifest?.name || pluginId;
        }
        
        return pluginId;
    }
    
    /**
     * 获取所有已安装插件的列表
     * @param app Obsidian App实例
     * @returns 插件信息数组
     */
    static getInstalledPlugins(app: App): { id: string; name: string }[] {
        // @ts-ignore - 访问 Obsidian 内部 API
        const plugins = app.plugins?.plugins || {};
        const pluginList: { id: string; name: string }[] = [];
        
        for (const pluginId in plugins) {
            const manifest: PluginManifest = plugins[pluginId].manifest;
            pluginList.push({
                id: pluginId,
                name: manifest?.name || pluginId
            });
        }
        
        // 按名称排序
        pluginList.sort((a, b) => a.name.localeCompare(b.name));
        
        return pluginList;
    }
    
    /**
     * 从表单值中提取运行时选择的命令ID
     * @param actionId 动作的唯一ID
     * @param formValues 表单值对象
     * @returns 提取到的命令ID，如果未找到则返回null
     */
    static extractRuntimeCommand(actionId: string, formValues: Record<string, any>): string | null {
        const fieldId = `__command_runtime_select_${actionId}__`;
        const value = formValues[fieldId];
        return value || null;
    }
}
