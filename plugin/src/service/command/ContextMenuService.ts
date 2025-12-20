import { App, TFile, TAbstractFile, Menu, MenuItem } from "obsidian";
import { FormConfig } from "src/model/FormConfig";
import FormPlugin from "src/main";
import { ServiceContainer } from "../ServiceContainer";

export interface ContextMenuItem {
    id: string;
    title: string;
    icon: string;
    callback: () => void;
}

export class ContextMenuService {
    private plugin: FormPlugin;
    private services: ServiceContainer | null = null;
    private isInitialized: boolean = false;
    private contextMenuItems: Map<string, ContextMenuItem> = new Map();

    constructor() {
        // 构造函数
    }

    /**
     * 初始化右键菜单服务
     * @param plugin 插件实例
     * @param services 服务容器
     */
    async initialize(plugin: FormPlugin, services: ServiceContainer): Promise<void> {
        this.plugin = plugin;
        this.services = services;

        if (this.isInitialized) {
            return;
        }

        // 注册编辑器右键菜单事件
        this.registerEditorContextMenu();
        
        // 注册文件变化监听
        this.registerFileWatchers();

        // 扫描所有表单文件并构建右键菜单项
        await this.buildContextMenuItems();

        this.isInitialized = true;
    }

    /**
     * 注册编辑器右键菜单事件
     */
    private registerEditorContextMenu(): void {
        // 注册编辑器右键菜单事件
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
                this.addFormsToContextMenu(menu);
            })
        );
    }

    /**
     * 注册文件变化监听
     */
    private registerFileWatchers(): void {
        const vault = this.plugin.app.vault;

        // 文件修改事件
        const modifyEventRef = vault.on('modify', async (file) => {
            if (this.isValidFormFile(file)) {
                // 延迟刷新，避免频繁更新
                setTimeout(() => {
                    this.refreshContextMenuItems();
                }, 500);
            }
        });
        
        // 文件创建事件
        const createEventRef = vault.on('create', async (file) => {
            if (this.isValidFormFile(file)) {
                setTimeout(() => {
                    this.refreshContextMenuItems();
                }, 500);
            }
        });
        
        // 文件删除事件
        const deleteEventRef = vault.on('delete', async (file) => {
            if (this.isValidFormFile(file)) {
                setTimeout(() => {
                    this.refreshContextMenuItems();
                }, 500);
            }
        });
        
        // 文件重命名事件
        const renameEventRef = vault.on('rename', async (file, oldPath) => {
            if (this.isValidFormFile(file)) {
                setTimeout(() => {
                    this.refreshContextMenuItems();
                }, 500);
            }
        });
    }

    /**
     * 添加表单到右键菜单
     * @param menu Obsidian菜单对象
     */
    private addFormsToContextMenu(menu: Menu): void {
        // 获取所有启用了右键菜单的表单
        const enabledForms = Array.from(this.contextMenuItems.values())
            .filter(item => item.callback && item.title);

        if (enabledForms.length === 0) {
            return; // 没有启用的表单，不添加菜单项
        }

        // 添加表单菜单项
        menu.addItem((item) => {
            item.setTitle('表单')
                .setIcon('file-spreadsheet')
                .onClick(() => {
                    // 这个点击事件不会触发，因为我们设置了子菜单
                });

            // 添加子菜单
            if (enabledForms.length > 0) {
                const submenu = item.setSubmenu();
                
                // 按标题排序
                enabledForms.sort((a, b) => a.title.localeCompare(b.title));
                
                // 添加每个表单到子菜单
                enabledForms.forEach(formItem => {
                    submenu.addItem((subItem) => {
                        subItem.setTitle(formItem.title)
                            .setIcon(formItem.icon)
                            .onClick(() => {
                                formItem.callback();
                            });
                    });
                });
            }
        });
    }

    /**
     * 构建右键菜单项
     */
    private async buildContextMenuItems(): Promise<void> {
        // 清空现有菜单项
        this.contextMenuItems.clear();

        // 获取所有表单文件
        const formFiles = this.plugin.app.vault.getFiles()
            .filter(file => this.isValidFormFile(file));

        // 为每个表单文件构建菜单项
        for (const file of formFiles) {
            await this.buildContextMenuItem(file);
        }
    }

    /**
     * 为单个表单文件构建菜单项
     * @param file 表单文件
     */
    private async buildContextMenuItem(file: TFile): Promise<void> {
        try {
            const config = await this.readFormConfig(file.path);
            if (!config) {
                return;
            }

            // 检查是否启用了右键菜单
            if (!config.isContextMenuEnabled()) {
                return;
            }

            // 创建菜单项
            const menuItem: ContextMenuItem = {
                id: file.path,
                title: file.basename,
                icon: "file-spreadsheet",
                callback: () => {
                    this.services?.formService.open(file, this.plugin.app);
                }
            };

            // 添加到菜单项映射
            this.contextMenuItems.set(file.path, menuItem);
        } catch (error) {
            console.warn(`Failed to build context menu item for ${file.path}:`, error);
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
                return formConfig;
            }

            return null;
        } catch (error) {
            console.warn(`Failed to read form config for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 刷新右键菜单项
     * 当表单文件发生变化时调用
     */
    async refreshContextMenuItems(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        await this.buildContextMenuItems();
    }

    /**
     * 清理资源
     */
    cleanup(): void {
        this.contextMenuItems.clear();
        this.isInitialized = false;
    }
}
