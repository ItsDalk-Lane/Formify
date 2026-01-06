import type FormPlugin from 'src/main';
import type { PluginSettings } from 'src/settings/PluginSettings';
import { TarsFeatureManager } from './tars';
import { ChatFeatureManager } from './chat';

export class FeatureCoordinator {
    private tarsFeatureManager: TarsFeatureManager | null = null;
    private chatFeatureManager: ChatFeatureManager | null = null;

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

    refresh(settings: PluginSettings) {
        this.initializeTars(settings);
        if (this.chatFeatureManager) {
            this.initializeChat(settings);
        }
    }

    getChatFeatureManager() {
        return this.chatFeatureManager;
    }

    /**
     * 刷新技能缓存
     */
    async refreshSkillsCache(): Promise<void> {
        if (this.chatFeatureManager) {
            await this.chatFeatureManager.refreshSkillsCache();
        }
    }

    dispose() {
        this.tarsFeatureManager?.dispose();
        this.tarsFeatureManager = null;
        this.chatFeatureManager?.dispose();
        this.chatFeatureManager = null;
    }
}
