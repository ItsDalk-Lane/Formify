import { v4 } from "uuid";
import { IFormAction } from "./action/IFormAction";
import { ActionGroup } from "./ActionGroup";
import { FormActionType } from "./enums/FormActionType";
import { IFormField } from "./field/IFormField";

export class FormConfig {
    id: string;
    fields: IFormField[];
    /**
     * @deprecated
     */
    action?: IFormAction;
    actions: IFormAction[];
    actionGroups: ActionGroup[];
    showSubmitSuccessToast?: boolean;  // 是否显示提交成功提示，默认为true
    enableExecutionTimeout?: boolean;  // 是否启用表单执行超时控制，默认为false
    executionTimeoutThreshold?: number; // 超时阈值（秒），默认为30秒，最小值为5秒
    commandId?: string;        // 命令ID，一旦生成永不改变
    commandEnabled?: boolean;  // 命令启用状态
    contextMenuEnabled?: boolean;  // 右键菜单启用状态
    runOnStartup?: boolean;  // 是否在Obsidian启动时自动运行

    constructor(id: string) {
        this.id = id;
        this.fields = [];
        this.actions = [];
        this.actionGroups = [];
        this.showSubmitSuccessToast = true;  // 默认显示提交成功提示
        this.enableExecutionTimeout = false; // 默认不启用超时控制
        this.executionTimeoutThreshold = 30; // 默认30秒
        this.commandEnabled = true;  // 默认启用命令
        this.contextMenuEnabled = false;  // 默认不启用右键菜单
        this.runOnStartup = false;  // 默认不在启动时自动运行
    }

    /**
     * 获取或生成命令ID
     * @param filePath 文件路径，用于生成ID
     */
    getOrCreateCommandId(filePath: string): string {
        if (!this.commandId) {
            this.commandId = this.generateCommandId(filePath);
        }
        return this.commandId;
    }

    /**
     * 生成稳定的命令ID
     * @param filePath 文件路径
     */
    public generateCommandId(filePath: string): string {
        const timestamp = Date.now();
        const pathHash = this.hashString(filePath).substr(0, 6);
        const random = Math.random().toString(36).substr(2, 4);
        return `${timestamp}-${pathHash}-${random}`;
    }

    /**
     * 简单的字符串哈希函数
     * @param str 输入字符串
     */
    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * 检查命令是否启用
     */
    isCommandEnabled(): boolean {
        return this.commandEnabled !== false;  // 默认为true
    }

    /**
     * 设置命令启用状态
     */
    setCommandEnabled(enabled: boolean): void {
        this.commandEnabled = enabled;
    }

    /**
     * 检查右键菜单是否启用
     */
    isContextMenuEnabled(): boolean {
        return this.contextMenuEnabled === true;  // 默认为false
    }

    /**
     * 设置右键菜单启用状态
     */
    setContextMenuEnabled(enabled: boolean): void {
        this.contextMenuEnabled = enabled;
    }

    /**
     * 检查是否在启动时自动运行
     */
    isRunOnStartup(): boolean {
        return this.runOnStartup === true;  // 默认为false
    }

    /**
     * 设置启动时运行状态
     */
    setRunOnStartup(enabled: boolean): void {
        this.runOnStartup = enabled;
    }
}
