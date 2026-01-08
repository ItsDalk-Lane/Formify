import { App, Notice, TFile, TAbstractFile, Menu, MenuItem } from "obsidian";
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
        const enabledForms = Array.from(this.contextMenuItems.values()).filter(
            (item) => item.callback && item.title
        );

        // 添加表单菜单项（始终显示，以便用户可从右键菜单直接“添加表单”）
        menu.addItem((item) => {
            item.setTitle('表单')
                .setIcon('file-spreadsheet')
                .onClick(() => {
                    // 这个点击事件不会触发，因为我们设置了子菜单
                });

            // 添加子菜单
            const submenu = item.setSubmenu();

            // 固定选项：添加表单
            submenu.addItem((subItem) => {
                subItem.setTitle('添加表单')
                    .setIcon('plus')
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .onClick(async (evt: any) => {
                        await this.openAddFormMenu(evt, submenu);
                    });

                this.markCompactMenuItem(subItem);
            });

            // 按标题排序
            enabledForms.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

            if (enabledForms.length > 0) {
                // 分隔线
                submenu.addSeparator();

                // 添加每个表单到子菜单
                enabledForms.forEach((formItem) => {
                    this.addFormMenuItem(submenu, formItem.id, formItem.title, formItem.icon, formItem.callback);
                });
            }
        });
    }

    /**
     * 打开“添加表单”的表单文件列表
     * 只显示未开启“在右键菜单中显示”的表单
     */
    private async openAddFormMenu(evt: MouseEvent | undefined, submenu: Menu): Promise<void> {
        const candidates = await this.getContextMenuDisabledFormFiles();
        const addMenu = new Menu(this.plugin.app);

        if (candidates.length === 0) {
            addMenu.addItem((item) => {
                item.setTitle('没有可添加的表单').setDisabled(true);
            });
        } else {
            // 按标题排序
            candidates.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { sensitivity: 'base' }));

            candidates.forEach((file) => {
                addMenu.addItem((item) => {
                    item.setTitle(file.basename)
                        .setIcon('file-spreadsheet')
                        .onClick(async () => {
                            try {
                                await this.setFormContextMenuEnabled(file.path, true);
                                await this.refreshContextMenuItems();

                                // 立即把新表单项追加到当前打开的“表单”子菜单里
                                this.addFormMenuItem(
                                    submenu,
                                    file.path,
                                    file.basename,
                                    'file-spreadsheet',
                                    () => this.services?.formService.open(file, this.plugin.app)
                                );
                            } catch (error) {
                                new Notice('添加表单失败，请稍后重试');
                                console.warn('Failed to enable context menu for form:', error);
                            }
                        });
                });
            });
        }

        if (evt) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (addMenu as any).showAtMouseEvent?.(evt);
        } else {
            // 兜底：没有事件时尽量显示在屏幕中心
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (addMenu as any).showAtPosition?.({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        }
    }

    /**
     * 在指定子菜单中添加一个可执行的表单项，并在右侧注入“三点”按钮用于禁用
     */
    private addFormMenuItem(
        submenu: Menu,
        formPath: string,
        title: string,
        icon: string,
        callback: () => void
    ): void {
        submenu.addItem((subItem) => {
            let isDisabled = false;

            subItem.setTitle(title)
                .setIcon(icon)
                .onClick(() => {
                    if (isDisabled) {
                        return;
                    }
                    callback();
                });

            this.markCompactMenuItem(subItem);

            this.injectDisableButton(subItem, async () => {
                if (isDisabled) {
                    return;
                }

                isDisabled = true;
                this.setMenuItemDisabledStyle(subItem);

                try {
                    await this.setFormContextMenuEnabled(formPath, false);
                    await this.refreshContextMenuItems();
                } catch (error) {
                    new Notice('禁用失败，请稍后重试');
                    console.warn('Failed to disable context menu for form:', error);
                }
            });
        });
    }

    /**
     * 给菜单项右侧注入“三点”按钮（仅此按钮会弹出“禁用”菜单）
     */
    private injectDisableButton(menuItem: MenuItem, onDisable: () => Promise<void>): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dom: HTMLElement | undefined = (menuItem as any)?.dom;
        if (!dom) {
            return;
        }

        dom.classList.add('form-flow--ContextMenuFormItem');

        // 尽量让菜单项高度更紧凑（与截图一致）
        dom.classList.add('form-flow--ContextMenuCompactItem');

        const actionsEl = document.createElement('div');
        actionsEl.className = 'form-flow--ContextMenuFormItemActions';

        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'form-flow--ContextMenuFormItemMoreButton';
        moreBtn.setAttribute('aria-label', '更多');
        moreBtn.textContent = '⋮';

        moreBtn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();

            const actionMenu = new Menu(this.plugin.app);
            actionMenu.addItem((item) => {
                item.setTitle('禁用')
                    .setIcon('ban')
                    .onClick(async () => {
                        await onDisable();
                    });
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (actionMenu as any).showAtMouseEvent?.(evt);
        });

        actionsEl.appendChild(moreBtn);
        dom.appendChild(actionsEl);
    }

    /**
     * 将菜单项标记为禁用（变灰 + 删除线），但不移除（关闭菜单后再消失）
     */
    private setMenuItemDisabledStyle(menuItem: MenuItem): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dom: HTMLElement | undefined = (menuItem as any)?.dom;
        if (!dom) {
            return;
        }
        dom.classList.add('form-flow--ContextMenuFormItemDisabled');
    }

    /**
     * 标记菜单项为紧凑高度
     */
    private markCompactMenuItem(menuItem: MenuItem): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dom: HTMLElement | undefined = (menuItem as any)?.dom;
        if (!dom) {
            return;
        }
        dom.classList.add('form-flow--ContextMenuCompactItem');
    }

    /**
     * 获取所有未开启右键菜单显示的表单文件
     */
    private async getContextMenuDisabledFormFiles(): Promise<TFile[]> {
        const formFiles = this.plugin.app.vault.getFiles().filter((file) => this.isValidFormFile(file));
        const result: TFile[] = [];

        for (const file of formFiles) {
            try {
                const raw = await this.plugin.app.vault.read(file);
                const json = JSON.parse(raw);
                const enabled = json?.contextMenuEnabled === true;
                if (!enabled) {
                    result.push(file);
                }
            } catch {
                // 无法解析的表单不参与添加列表，避免误伤
            }
        }

        return result;
    }

    /**
     * 写入表单的 contextMenuEnabled 状态（与设置页同步）
     */
    private async setFormContextMenuEnabled(filePath: string, enabled: boolean): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Form file not found: ${filePath}`);
        }

        const raw = await this.plugin.app.vault.read(file);
        const json = JSON.parse(raw);
        json.contextMenuEnabled = enabled;
        await this.plugin.app.vault.modify(file, JSON.stringify(json, null, 2));
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
                return FormConfig.fromJSON(config);
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
