import { App } from 'obsidian';
import { FormService } from './FormService';
import { FormScriptService } from './extend/FormScriptService';
import { ApplicationCommandService } from './command/ApplicationCommandService';
import { ApplicationFileViewService } from './file-view/ApplicationFileViewService';
import { ContextMenuService } from './command/ContextMenuService';
import { FormIntegrationService } from './command/FormIntegrationService';
import { InternalLinkParserService } from './InternalLinkParserService';

/**
 * 全局服务容器实例
 * 用于在无法使用 Context 的场景下访问服务（如服务内部、非 React 代码）
 */
let globalServiceContainer: ServiceContainer | null = null;

/**
 * 获取全局服务容器实例
 * @throws Error 如果服务容器未初始化
 */
export function getServiceContainer(): ServiceContainer {
    if (!globalServiceContainer) {
        throw new Error('ServiceContainer 未初始化');
    }
    return globalServiceContainer;
}

/**
 * 服务容器 - 统一管理所有服务的生命周期
 * 实现依赖注入模式，提供服务的集中注册、获取和销毁
 */
export class ServiceContainer {
    // 核心服务
    readonly formService: FormService;
    readonly formScriptService: FormScriptService;
    readonly applicationCommandService: ApplicationCommandService;
    readonly applicationFileViewService: ApplicationFileViewService;
    readonly contextMenuService: ContextMenuService;
    readonly formIntegrationService: FormIntegrationService;

    // 可选服务（需要 App 实例初始化）
    private _internalLinkParserService: InternalLinkParserService | null = null;

    private _app: App | null = null;
    private _initialized = false;

    constructor() {
        // 初始化不依赖 App 的服务
        this.formService = new FormService();
        this.formScriptService = new FormScriptService();
        this.applicationCommandService = new ApplicationCommandService();
        this.applicationFileViewService = new ApplicationFileViewService();
        this.contextMenuService = new ContextMenuService();
        this.formIntegrationService = new FormIntegrationService();

        // 设置服务间的回调关系
        this.formIntegrationService.setMenuRefreshCallback(() => {
            this.contextMenuService.refreshContextMenuItems();
        });

        // 设置全局实例
        globalServiceContainer = this;
    }

    /**
     * 初始化需要 App 实例的服务
     * @param app Obsidian App 实例
     */
    initializeWithApp(app: App): void {
        if (this._initialized) {
            return;
        }
        this._app = app;
        this._internalLinkParserService = new InternalLinkParserService(app);
        this._initialized = true;
    }

    /**
     * 获取内链解析服务
     * @throws Error 如果服务未初始化
     */
    get internalLinkParserService(): InternalLinkParserService {
        if (!this._internalLinkParserService) {
            throw new Error('InternalLinkParserService 未初始化，请先调用 initializeWithApp()');
        }
        return this._internalLinkParserService;
    }

    /**
     * 检查容器是否已初始化
     */
    get isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * 清理所有服务资源
     */
    dispose(): void {
        // 清理需要显式销毁的服务
        this.formScriptService.unload();
        this.formIntegrationService.cleanup();
        this.contextMenuService.cleanup();
        
        // 清理内链解析服务缓存
        if (this._internalLinkParserService) {
            this._internalLinkParserService.clearCache();
        }

        this._initialized = false;
        this._app = null;
        globalServiceContainer = null;
    }
}

