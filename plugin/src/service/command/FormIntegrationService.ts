import { App, TFile, EventRef, TAbstractFile } from "obsidian";
import { FormService } from "../FormService";
import { FormConfig } from "src/model/FormConfig";
import FormPlugin from "src/main";

/**
 * 菜单刷新回调类型
 */
type MenuRefreshCallback = () => void;

export class FormIntegrationService {

    private plugin: FormPlugin;
    private fileEventRefs: EventRef[] = [];
    private isInitialized: boolean = false;
    private onMenuRefresh: MenuRefreshCallback | null = null;
    private readonly formCommandIdsByPath: Map<string, string> = new Map();
    private readonly triggerCommandIdsByPath: Map<string, Set<string>> = new Map();

    constructor() {
    }

    /**
     * 设置菜单刷新回调
     * @param callback 菜单刷新回调函数
     */
    setMenuRefreshCallback(callback: MenuRefreshCallback): void {
        this.onMenuRefresh = callback;
    }

    /**
     * 触发菜单刷新
     */
    private triggerMenuRefresh(): void {
        if (this.onMenuRefresh) {
            this.onMenuRefresh();
        }
    }

    private getFormFile(filePath: string): TFile | null {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            return null;
        }
        return file;
    }

    private unregisterCommandsByPath(filePath: string): void {
        const formCommandId = this.formCommandIdsByPath.get(filePath);
        if (formCommandId) {
            this.plugin.removeCommand(`form:${formCommandId}`);
            this.formCommandIdsByPath.delete(filePath);
        }

        const triggerCommandIds = this.triggerCommandIdsByPath.get(filePath);
        if (triggerCommandIds) {
            for (const triggerCommandId of triggerCommandIds) {
                this.plugin.removeCommand(`form-trigger:${triggerCommandId}`);
            }
            this.triggerCommandIdsByPath.delete(filePath);
        }
    }

    private unregisterAllKnownCommands(): void {
        for (const commandId of this.formCommandIdsByPath.values()) {
            this.plugin.removeCommand(`form:${commandId}`);
        }
        for (const triggerIds of this.triggerCommandIdsByPath.values()) {
            for (const triggerId of triggerIds) {
                this.plugin.removeCommand(`form-trigger:${triggerId}`);
            }
        }
        this.formCommandIdsByPath.clear();
        this.triggerCommandIdsByPath.clear();
    }

    private async executeFormCommand(filePath: string): Promise<void> {
        const file = this.getFormFile(filePath);
        if (!file) {
            console.warn(`Form file not found for command execution: ${filePath}`);
            return;
        }
        await new FormService().open(file, this.plugin.app);
    }

    private async executeTriggerCommand(filePath: string, triggerId: string): Promise<void> {
        const file = this.getFormFile(filePath);
        if (!file) {
            console.warn(`Form file not found for trigger execution: ${filePath}`);
            return;
        }

        const config = await this.readFormConfig(filePath);
        if (!config) {
            console.warn(`Failed to read form config for trigger command: ${filePath}`);
            return;
        }

        const trigger = config.getActionTrigger(triggerId);
        if (!trigger) {
            console.warn(`Trigger not found: ${triggerId} in ${filePath}`);
            return;
        }

        await new FormService().openByTrigger(trigger, file, this.plugin.app);
    }

    /**
     * 获取命令ID - 从表单配置中读取
     * @param filePath 文件路径
     */
    async getCommandId(filePath: string): Promise<string> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Form file not found: ${filePath}`);
        }

        try {
            // 读取表单配置
            const configData = await this.plugin.app.vault.read(file);
            const config = JSON.parse(configData);

            // 确保是FormConfig实例
            const formConfig = FormConfig.fromJSON(config);

            // 获取或生成命令ID
            const isNewCommandId = !formConfig.commandId;
            const commandId = formConfig.getOrCreateCommandId(filePath);

            // 如果是新生成的ID，需要立即保存回文件
            if (isNewCommandId) {
                await this.plugin.app.vault.modify(file, JSON.stringify(formConfig, null, 2));
            }

            return `form:${commandId}`;
        } catch (error) {
            console.error(`Failed to read form config for ${filePath}:`, error);
            throw new Error(`Failed to get command ID for ${filePath}: ${error}`);
        }
    }

    /**
     * 检查文件是否为有效的表单文件
     * @param file 文件对象
     */
    private isValidFormFile(file: TAbstractFile): file is TFile {
        return file instanceof TFile && file.extension === 'cform';
    }

    /**
     * 读取表单配置
     * @param filePath 文件路径
     */
    private async readFormConfig(filePath: string): Promise<FormConfig | null> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                return null;
            }

            const configData = await this.plugin.app.vault.read(file);
            const config = JSON.parse(configData);

            // 确保是FormConfig实例
            if (typeof config === 'object' && config.id) {
                return FormConfig.fromJSON(config);
            }

            return null;
        } catch (error) {
            console.warn(`Failed to read form config for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 保存表单配置
     * @param filePath 文件路径
     * @param config 表单配置
     */
    private async saveFormConfig(filePath: string, config: FormConfig): Promise<void> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                throw new Error(`Form file not found: ${filePath}`);
            }

            await this.plugin.app.vault.modify(file, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error(`Failed to save form config for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * 获取表单文件的快捷键
     * @param filePath 文件路径
     * @param app 应用实例
     */
    async getShortcut(filePath: string, app: App): Promise<string[]> {
        try {
            const commandId = await this.getCommandId(filePath);
            const hotkeyMap = app.hotkeyManager.customKeys;

            if (hotkeyMap && commandId in hotkeyMap) {
                const hotkeys = hotkeyMap[commandId] || [];
                return hotkeys.map(hotkey => {
                    const modifiers = hotkey.modifiers || [];
                    const key = hotkey.key;
                    return [...modifiers, key].join("+");
                });
            }

            const command = app.commands.findCommand(commandId);
            if (command) {
                const hotkeys = command.hotkeys || [];
                return hotkeys.map(hotkey => {
                    const modifiers = hotkey.modifiers || [];
                    const key = hotkey.key;
                    return [...modifiers, key].join("+");
                });
            }
        } catch (error) {
            console.warn(`Failed to get shortcut for ${filePath}:`, error);
        }

        return [];
    }

    /**
     * 初始化表单集成服务
     * @param plugin 插件实例
     * @param force 是否强制重新初始化
     */
    async initialize(plugin: FormPlugin, force: boolean = false): Promise<void> {
        this.plugin = plugin;

        // 如果不是强制初始化且已初始化，则跳过
        if (!force && this.isInitialized) {
            return;
        }

        // 清理现有资源
        this.cleanup();

        // 扫描所有.cform文件并注册命令
        await this.scanAndRegisterForms();

        // 设置文件事件监听器
        this.setupFileWatchers();

        this.isInitialized = true;
    }

    /**
     * 扫描所有表单文件并注册命令
     */
    private async scanAndRegisterForms(): Promise<void> {
        const app = this.plugin.app;
        const formFiles = app.vault.getFiles()
            .filter(file => this.isValidFormFile(file));

        for (const file of formFiles) {
            await this.registerFormCommand(file);
        }
    }

    /**
     * 为表单文件注册命令（安全版本，避免重复注册）
     * @param file 表单文件
     */
    private async registerFormCommand(file: TFile): Promise<void> {
        try {
            const config = await this.readFormConfig(file.path);
            if (!config) {
                console.warn(`Failed to read form config for ${file.path}`);
                return;
            }

            // 确保表单有命令ID，并且立即保存到文件
            const isNewCommandId = !config.commandId;
            const commandId = config.getOrCreateCommandId(file.path);
            const fullCommandId = `form:${commandId}`;

            // 如果是新生成的ID，立即保存到文件
            if (isNewCommandId) {
                await this.saveFormConfig(file.path, config);
            }

            // 检查是否应该启用命令
            this.formCommandIdsByPath.set(file.path, commandId);
            if (config.isCommandEnabled()) {
                this.plugin.removeCommand(fullCommandId);

                this.plugin.addCommand({
                    id: fullCommandId,
                    name: `@${file.basename}`,
                    icon: "file-spreadsheet",
                    callback: () => {
                        void this.executeFormCommand(file.path);
                    }
                });
            } else {
                // 确保禁用的命令被移除
                this.plugin.removeCommand(fullCommandId);
            }

            // 注册触发器命令
            await this.registerTriggerCommands(file, config);
        } catch (error) {
            console.warn(`Failed to register command for ${file.path}:`, error);
        }
    }

    /**
     * 为表单的所有触发器注册独立命令
     */
    private async registerTriggerCommands(file: TFile, config: FormConfig): Promise<void> {
        const existingTriggerIds = this.triggerCommandIdsByPath.get(file.path) ?? new Set<string>();
        const nextTriggerIds = new Set<string>();
        let needsSave = false;

        for (const trigger of config.actionTriggers) {
            if (!trigger.isCommandEnabled()) {
                continue;
            }

            // 确保触发器有命令 ID
            const isNew = !trigger.commandId;
            const triggerCommandId = trigger.getOrCreateCommandId(file.path);
            const fullTriggerCommandId = `form-trigger:${triggerCommandId}`;
            nextTriggerIds.add(triggerCommandId);

            if (isNew) {
                needsSave = true;
            }

            // 先移除再注册，确保命令名称和回调始终与最新配置一致
            this.plugin.removeCommand(fullTriggerCommandId);
            this.plugin.addCommand({
                id: fullTriggerCommandId,
                name: `@${file.basename} > ${trigger.name}`,
                icon: "zap",
                callback: () => {
                    void this.executeTriggerCommand(file.path, trigger.id);
                }
            });
        }

        // 清理已删除或已禁用的旧触发器命令
        for (const oldTriggerId of existingTriggerIds) {
            if (!nextTriggerIds.has(oldTriggerId)) {
                this.plugin.removeCommand(`form-trigger:${oldTriggerId}`);
            }
        }

        this.triggerCommandIdsByPath.set(file.path, nextTriggerIds);

        if (needsSave) {
            await this.saveFormConfig(file.path, config);
        }
    }

    /**
     * 设置文件事件监听器
     */
    private setupFileWatchers(): void {
        const vault = this.plugin.app.vault;

        // 文件创建事件
        const createEventRef = vault.on('create', async (file) => {
            if (this.isValidFormFile(file)) {
                await this.registerFormCommand(file);
                // 刷新右键菜单
                this.triggerMenuRefresh();
            }
        });
        this.fileEventRefs.push(createEventRef);

        // 文件修改事件
        const modifyEventRef = vault.on('modify', async (file) => {
            if (this.isValidFormFile(file)) {
                await this.registerFormCommand(file);
                // 刷新右键菜单
                this.triggerMenuRefresh();
            }
        });
        this.fileEventRefs.push(modifyEventRef);

        // 文件删除事件
        const deleteEventRef = vault.on('delete', (file) => {
            if (this.isValidFormFile(file)) {
                this.unregisterCommandsByPath(file.path);
                // 刷新右键菜单
                this.triggerMenuRefresh();
            }
        });
        this.fileEventRefs.push(deleteEventRef);

        // 文件重命名/移动事件（需要检测复制）
        const renameEventRef = vault.on('rename', async (file, oldPath) => {
            if (this.isValidFormFile(file)) {
                await this.handleFileRenameOrCopy(file, oldPath);
                // 刷新右键菜单
                this.triggerMenuRefresh();
            } else if (oldPath.endsWith('.cform')) {
                this.unregisterCommandsByPath(oldPath);
                this.triggerMenuRefresh();
            }
        });
        this.fileEventRefs.push(renameEventRef);
    }

    /**
     * 处理文件重命名或复制
     * @param file 新文件对象
     * @param oldPath 旧路径
     */
    private async handleFileRenameOrCopy(file: TFile, oldPath: string): Promise<void> {
        const isCopy = this.isFileCopy(oldPath);

        if (isCopy) {
            // 文件复制：为新文件生成独立的命令ID并注册命令
            await this.registerFormCommand(file);
        } else {
            // 文件重命名/移动：先移除旧路径注册，再按新路径重建命令
            try {
                this.unregisterCommandsByPath(oldPath);
                await this.registerFormCommand(file);
            } catch (error) {
                console.warn(`Failed to handle file rename for ${file.path}:`, error);
            }
        }
    }

    /**
     * 检测是否为文件复制操作
     * @param oldPath 旧文件路径
     */
    private isFileCopy(oldPath: string): boolean {
        // 如果旧路径的文件仍然存在，则是复制操作
        const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
        return oldFile !== null;
    }

    /**
     * 清理事件监听器和重置状态
     */
    cleanup(): void {
        for (const eventRef of this.fileEventRefs) {
            this.plugin.app.vault.offref(eventRef);
        }
        this.fileEventRefs = [];
        this.unregisterAllKnownCommands();
        this.isInitialized = false;
    }

    /**
     * 启用表单命令
     * @param filePath 文件路径
     */
    async enableCommand(filePath: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);

        if (!file || !this.isValidFormFile(file)) {
            throw new Error(`Form file not found: ${filePath}`);
        }

        try {
            const config = await this.readFormConfig(filePath);
            if (!config) {
                throw new Error(`Failed to read form config for ${filePath}`);
            }

            // 更新表单配置中的启用状态
            config.setCommandEnabled(true);

            // 确保有命令ID（不重新生成已有的ID）
            config.getOrCreateCommandId(filePath);

            // 保存配置（包括可能的commandId）
            await this.saveFormConfig(filePath, config);
            await this.registerFormCommand(file);
            // 刷新右键菜单
            this.triggerMenuRefresh();
        } catch (error) {
            console.error(`Failed to enable command for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * 禁用表单命令
     * @param filePath 文件路径
     */
    async disableCommand(filePath: string): Promise<void> {
        try {
            const config = await this.readFormConfig(filePath);
            if (!config) {
                throw new Error(`Failed to read form config for ${filePath}`);
            }

            // 更新表单配置中的启用状态
            config.setCommandEnabled(false);

            // 保存配置
            await this.saveFormConfig(filePath, config);
            const file = this.getFormFile(filePath);
            if (file) {
                await this.registerFormCommand(file);
            } else {
                this.unregisterCommandsByPath(filePath);
            }
            // 刷新右键菜单
            this.triggerMenuRefresh();
        } catch (error) {
            console.error(`Failed to disable command for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * 手动注销表单命令（兼容性方法）
     * @param filePath 文件路径
     */
    async unregister(filePath: string): Promise<void> {
        await this.disableCommand(filePath);
    }

    /**
     * 检查表单文件的命令是否启用
     * @param filePath 文件路径
     */
    async isCommandEnabled(filePath: string): Promise<boolean> {
        try {
            const config = await this.readFormConfig(filePath);
            if (!config) {
                return true; // 如果无法读取配置，默认启用
            }

            return config.isCommandEnabled();
        } catch (error) {
            console.warn(`Failed to check command status for ${filePath}:`, error);
            return true; // 出错时默认启用
        }
    }

    /**
     * 手动注册表单命令（兼容性方法）
     * @param filePath 文件路径
     */
    async register(filePath: string): Promise<void> {
        await this.enableCommand(filePath);
    }
}
