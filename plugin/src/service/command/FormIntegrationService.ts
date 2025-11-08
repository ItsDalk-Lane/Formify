import { App, TFile, EventRef, TAbstractFile } from "obsidian";
import { FormService } from "../FormService";
import FormPlugin from "src/main";

export class FormIntegrationService {

    private plugin: FormPlugin;
    private fileEventRefs: EventRef[] = [];

    /**
     * 获取命令ID - 直接使用文件路径
     * @param filePath 文件路径
     */
    getCommandId(filePath: string): string {
        return `form:${filePath}`;
    }

    /**
     * 检查文件是否为有效的表单文件
     * @param file 文件对象
     */
    private isValidFormFile(file: TAbstractFile): file is TFile {
        return file instanceof TFile && file.extension === 'cform';
    }

    /**
     * 获取表单文件的快捷键
     * @param filePath 文件路径
     * @param app 应用实例
     */
    getShortcut(filePath: string, app: App): string[] {
        const commandId = this.getCommandId(filePath);
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

        return [];
    }

    /**
     * 初始化表单集成服务
     * @param plugin 插件实例
     */
    async initialize(plugin: FormPlugin): Promise<void> {
        this.plugin = plugin;

        // 扫描所有.cform文件并注册命令
        await this.scanAndRegisterForms();

        // 设置文件事件监听器
        this.setupFileWatchers();
    }

    /**
     * 扫描所有表单文件并注册命令
     */
    private async scanAndRegisterForms(): Promise<void> {
        const app = this.plugin.app;
        const formFiles = app.vault.getFiles()
            .filter(file => this.isValidFormFile(file));

        for (const file of formFiles) {
            // 检查该文件是否应该启用命令
            if (this.shouldEnableCommand(file.path)) {
                this.registerFormCommand(file);
            }
        }
    }

    /**
     * 检查文件是否应该启用命令
     * @param filePath 文件路径
     */
    private shouldEnableCommand(filePath: string): boolean {
        const commandSettings = this.plugin.settings.formCommands[filePath];

        // 如果没有设置，默认启用
        if (!commandSettings) {
            // 自动为新文件创建设置
            this.plugin.settings.formCommands[filePath] = {
                enabled: true,
                registeredAt: Date.now()
			};
			this.plugin.saveSettings();
            return true;
        }

        // 如果用户明确禁用了，则不启用
        if (commandSettings.userDisabled) {
            return false;
        }

        // 否则按照enabled设置
        return commandSettings.enabled !== false;
    }

    /**
     * 为表单文件注册命令
     * @param file 表单文件
     */
    private registerFormCommand(file: TFile): void {
        const commandId = this.getCommandId(file.path);

        try {
            this.plugin.addCommand({
                id: commandId,
                name: `@${file.basename}`,
                icon: "file-spreadsheet",
                callback: () => {
                    new FormService().open(file, this.plugin.app);
                }
            });

            // 更新设置
            const settings = this.plugin.settings.formCommands[file.path] || {};
            if (!settings.registeredAt) {
                settings.registeredAt = Date.now();
                settings.enabled = true;
                this.plugin.settings.formCommands[file.path] = settings;
                this.plugin.saveSettings();
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
        const createEventRef = vault.on('create', (file) => {
            if (this.isValidFormFile(file)) {
                // 新创建的文件默认启用命令
                if (this.shouldEnableCommand(file.path)) {
                    this.registerFormCommand(file);
                }
            }
        });
        this.fileEventRefs.push(createEventRef);

        // 文件删除事件
        const deleteEventRef = vault.on('delete', (file) => {
            if (this.isValidFormFile(file)) {
                const commandId = this.getCommandId(file.path);
                this.plugin.removeCommand(commandId);

                // 清理设置
                delete this.plugin.settings.formCommands[file.path];
                this.plugin.saveSettings();
            }
        });
        this.fileEventRefs.push(deleteEventRef);

        // 文件重命名/移动事件（需要检测复制）
        const renameEventRef = vault.on('rename', (file, oldPath) => {
            if (this.isValidFormFile(file)) {
                this.handleFileRenameOrCopy(file, oldPath);
            }
        });
        this.fileEventRefs.push(renameEventRef);
    }

    /**
     * 处理文件重命名或复制
     * @param file 新文件对象
     * @param oldPath 旧路径
     */
    private handleFileRenameOrCopy(file: TFile, oldPath: string): void {
        const isCopy = this.isFileCopy(oldPath);

        if (isCopy) {
            // 文件复制：为新文件注册命令，保留原文件
            if (this.shouldEnableCommand(file.path)) {
                this.registerFormCommand(file);
            }
        } else {
            // 文件重命名/移动：迁移命令设置
            const oldCommandId = this.getCommandId(oldPath);
            this.plugin.removeCommand(oldCommandId);

            // 迁移设置
            const oldSettings = this.plugin.settings.formCommands[oldPath];
            if (oldSettings) {
                this.plugin.settings.formCommands[file.path] = {
                    ...oldSettings,
                    registeredAt: Date.now() // 更新注册时间
                };
                delete this.plugin.settings.formCommands[oldPath];
                this.plugin.saveSettings();
            }

            // 如果应该启用命令，则注册
            if (this.shouldEnableCommand(file.path)) {
                this.registerFormCommand(file);
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
     * 清理事件监听器
     */
    cleanup(): void {
        for (const eventRef of this.fileEventRefs) {
            this.plugin.app.vault.offref(eventRef);
        }
        this.fileEventRefs = [];
    }

    /**
     * 启用表单命令
     * @param filePath 文件路径
     */
    async enableCommand(filePath: string): Promise<void> {
        const app = this.plugin.app;
        const file = app.vault.getAbstractFileByPath(filePath);

        if (!file || !this.isValidFormFile(file)) {
            throw new Error(`Form file not found: ${filePath}`);
        }

        // 更新设置
        const settings = this.plugin.settings.formCommands[filePath] || {};
        settings.enabled = true;
        settings.userDisabled = false;
        this.plugin.settings.formCommands[filePath] = settings;

        // 注册命令
        this.registerFormCommand(file);
        await this.plugin.saveSettings();
    }

    /**
     * 禁用表单命令
     * @param filePath 文件路径
     */
    async disableCommand(filePath: string): Promise<void> {
        const commandId = this.getCommandId(filePath);
        this.plugin.removeCommand(commandId);

        // 更新设置
        const settings = this.plugin.settings.formCommands[filePath] || {};
        settings.enabled = false;
        settings.userDisabled = true;
        this.plugin.settings.formCommands[filePath] = settings;

        await this.plugin.saveSettings();
    }

    /**
     * 检查表单文件的命令是否启用
     * @param filePath 文件路径
     */
    isCommandEnabled(filePath: string): boolean {
        const commandSettings = this.plugin.settings.formCommands[filePath];

        // 如果没有设置，默认启用
        if (!commandSettings) {
            return true;
        }

        // 如果用户明确禁用了，则返回false
        if (commandSettings.userDisabled) {
            return false;
        }

        // 否则按照enabled设置
        return commandSettings.enabled !== false;
    }

    /**
     * 手动注册表单命令（兼容性方法）
     * @param filePath 文件路径
     */
    async register(filePath: string): Promise<void> {
        await this.enableCommand(filePath);
    }

    /**
     * 手动注销表单命令（兼容性方法）
     * @param filePath 文件路径
     */
    async unregister(filePath: string): Promise<void> {
        await this.disableCommand(filePath);
    }
}

export const formIntegrationService = new FormIntegrationService();