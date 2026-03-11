import type FormPlugin from 'src/main';
import type { PluginSettings } from 'src/settings/PluginSettings';
import {
	TarsFeatureManager,
} from './tars';
import { ChatFeatureManager } from './chat';
import { McpClientManager, DEFAULT_MCP_SETTINGS } from './tars/mcp';

export class FeatureCoordinator {
    private tarsFeatureManager: TarsFeatureManager | null = null;
    private chatFeatureManager: ChatFeatureManager | null = null;
    private mcpClientManager: McpClientManager | null = null;

    constructor(private plugin: FormPlugin) {}

    initializeTars(settings: PluginSettings) {
        const tarsSettings = settings.tars.settings;
        if (!this.tarsFeatureManager) {
            this.tarsFeatureManager = new TarsFeatureManager(this.plugin, tarsSettings);
            this.tarsFeatureManager.initialize();
        } else {
            this.tarsFeatureManager.updateSettings(tarsSettings);
        }
        this.chatFeatureManager?.updateProviderSettings(tarsSettings);
    }

    initializeChat(settings: PluginSettings) {
        if (!this.chatFeatureManager) {
            this.chatFeatureManager = new ChatFeatureManager(this.plugin);
            this.chatFeatureManager.initialize(settings.chat);
        } else {
            this.chatFeatureManager.updateChatSettings(settings.chat);
        }
        this.chatFeatureManager?.updateProviderSettings(settings.tars.settings);
    }

    /** 初始化 MCP 功能 */
    async initializeMcp(settings: PluginSettings) {
        const mcpSettings = settings.tars.settings.mcp ?? DEFAULT_MCP_SETTINGS;
        if (!this.mcpClientManager) {
            this.mcpClientManager = new McpClientManager(
                this.plugin.app,
                mcpSettings
            );
        } else {
            this.mcpClientManager.updateSettings(mcpSettings);
        }
    }

    async refresh(settings: PluginSettings) {
        this.initializeTars(settings);
        if (this.chatFeatureManager) {
            this.initializeChat(settings);
        }
        await this.initializeMcp(settings);
    }

    getChatFeatureManager() {
        return this.chatFeatureManager;
    }

    /** 获取 MCP 客户端管理器 */
    getMcpClientManager(): McpClientManager | null {
        return this.mcpClientManager;
    }

    /**
     * 刷新快捷操作缓存
     */
    async refreshQuickActionsCache(): Promise<void> {
        if (this.chatFeatureManager) {
            await this.chatFeatureManager.refreshQuickActionsCache();
        }
    }

    dispose() {
        this.mcpClientManager?.dispose();
        this.mcpClientManager = null;
        this.tarsFeatureManager?.dispose();
        this.tarsFeatureManager = null;
        this.chatFeatureManager?.dispose();
        this.chatFeatureManager = null;
    }
}
