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
            const config = JSON.parse(configData) as FormConfig;

            // 确保是FormConfig实例
            const formConfig = Object.assign(new FormConfig(config.id), config);

            // 获取或生成命令ID
            const commandId = formConfig.getOrCreateCommandId(filePath);

            // 如果是新生成的ID，需要立即保存回文件
            if (!formConfig.commandId) {
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
                const formConfig = Object.assign(new FormConfig(config.id), config);

                // 确保commandId字段被正确处理（即使未定义）
                if (!formConfig.commandId) {
                    formConfig.commandId = undefined;
                }

                return formConfig;
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
     * 检查命令是否已存在
     * @param commandId 命令ID
     */
    private isCommandRegistered(commandId: string): boolean {
        const fullCommandId = `form:${commandId}`;
        return !!this.plugin.app.commands.findCommand(fullCommandId);
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
            if (config.isCommandEnabled()) {
                // 检查命令是否已存在，避免重复注册
                if (this.isCommandRegistered(commandId)) {
                    return;
                }

                this.plugin.addCommand({
                    id: fullCommandId,
                    name: `@${file.basename}`,
                    icon: "file-spreadsheet",
                    callback: () => {
                        new FormService().open(file, this.plugin.app);
                    }
                });
            } else {
                // 确保禁用的命令被移除
                this.plugin.removeCommand(fullCommandId);
            }
        } catch (error) {
            console.warn(`Failed to register command for ${file.path}:`, error);
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

        // 文件删除事件
        const deleteEventRef = vault.on('delete', async (file) => {
            if (this.isValidFormFile(file)) {
                try {
                    const config = await this.readFormConfig(file.path);
                    if (config && config.commandId) {
                        const commandId = `form:${config.commandId}`;
                        this.plugin.removeCommand(commandId);
                    }
                } catch (error) {
                    console.warn(`Failed to clean up command for deleted file ${file.path}:`, error);
                }
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
            // 文件重命名/移动：命令ID保持不变，只需要更新命令名称
            try {
                const config = await this.readFormConfig(file.path);
                if (config && config.commandId) {
                    const fullCommandId = `form:${config.commandId}`;

                    // 移除旧命令并重新注册（更新命令名称）
                    this.plugin.removeCommand(fullCommandId);

                    if (config.isCommandEnabled()) {
                        this.plugin.addCommand({
                            id: fullCommandId,
                            name: `@${file.basename}`, // 使用新的文件名
                            icon: "file-spreadsheet",
                            callback: () => {
                                new FormService().open(file, this.plugin.app);
                            }
                        });
                    }
                } else {
                    // 如果没有命令ID，创建一个新的
                    await this.registerFormCommand(file);
                }
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
            const commandId = config.getOrCreateCommandId(filePath);
            const fullCommandId = `form:${commandId}`;

            // 检查命令是否已存在，避免重复注册
            if (!this.isCommandRegistered(commandId)) {
                this.plugin.addCommand({
                    id: fullCommandId,
                    name: `@${file.basename}`,
                    icon: "file-spreadsheet",
                    callback: () => {
                        new FormService().open(file, this.plugin.app);
                    }
                });
            }

            // 保存配置（包括可能的commandId）
            await this.saveFormConfig(filePath, config);
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

            // 移除命令
            if (config.commandId) {
                const fullCommandId = `form:${config.commandId}`;
                this.plugin.removeCommand(fullCommandId);
            }

            // 保存配置
            await this.saveFormConfig(filePath, config);
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