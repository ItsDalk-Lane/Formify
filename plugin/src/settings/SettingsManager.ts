import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './PluginSettings';
import { cloneTarsSettings } from 'src/features/tars';
import type { TarsSettings } from 'src/features/tars';
import { encryptApiKey, decryptApiKey } from 'src/features/tars/utils/cryptoUtils';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from 'src/features/chat';
import { DebugLogger } from 'src/utils/DebugLogger';

interface BaseOptions {
    apiKey: string;
    baseURL: string;
    model: string;
    parameters: Record<string, unknown>;
    enableWebSearch?: boolean;
    apiSecret?: string;
    [key: string]: any;
}

interface ProviderConfig {
    tag: string;
    vendor: string;
    options: BaseOptions;
    [key: string]: any;
}

export class SettingsManager {
    constructor(private plugin: Plugin) {}

    async load(): Promise<PluginSettings> {
        const persisted = (await this.plugin.loadData()) ?? {};
        const rawChatSettings = persisted?.chat ?? {};
        const mergedChat = { ...DEFAULT_CHAT_SETTINGS, ...rawChatSettings };
        const tarsSettings = this.decryptTarsSettings(persisted?.tars?.settings);

        // 迁移内链解析配置到新结构
        const migratedSettings = this.migrateInternalLinkSettings(tarsSettings, mergedChat);

        return {
            ...DEFAULT_SETTINGS,
            ...persisted,
            tars: {
                settings: migratedSettings,
            },
            chat: mergedChat,
        };
    }

    /**
     * 迁移旧的内链解析配置到新结构
     * 确保向下兼容，不丢失用户配置
     */
    private migrateInternalLinkSettings(
        tarsSettings: TarsSettings,
        chatSettings: ChatSettings
    ): TarsSettings {
        // 检查是否已迁移（存在新结构且有效）
        if (tarsSettings.internalLinkParsing?.enabled !== undefined) {
            DebugLogger.debug('[SettingsManager] 内链解析设置已是新结构，跳过迁移');
            return tarsSettings;
        }

        // 执行迁移：合并旧配置到新结构
        const newInternalLinkParsing = {
            // 优先级：Tars设置 > Chat设置 > 默认值
            enabled: tarsSettings.enableInternalLink ?? chatSettings.enableInternalLinkParsing ?? true,
            maxDepth: tarsSettings.maxLinkParseDepth ?? chatSettings.maxLinkParseDepth ?? 5,
            timeout: tarsSettings.linkParseTimeout ?? chatSettings.linkParseTimeout ?? 5000,
            parseInTemplates: chatSettings.parseLinksInTemplates ?? true,
        };

        // 构建迁移后的设置
        const migratedSettings: TarsSettings = {
            ...tarsSettings,
            internalLinkParsing: newInternalLinkParsing,
        };

        DebugLogger.info('[SettingsManager] 内链解析设置已迁移到新结构', {
            oldTars: {
                enableInternalLink: tarsSettings.enableInternalLink,
                maxLinkParseDepth: tarsSettings.maxLinkParseDepth,
                linkParseTimeout: tarsSettings.linkParseTimeout,
            },
            oldChat: {
                enableInternalLinkParsing: chatSettings.enableInternalLinkParsing,
                parseLinksInTemplates: chatSettings.parseLinksInTemplates,
                maxLinkParseDepth: chatSettings.maxLinkParseDepth,
                linkParseTimeout: chatSettings.linkParseTimeout,
            },
            newConfig: newInternalLinkParsing,
        });

        return migratedSettings;
    }

    async save(settings: PluginSettings): Promise<void> {
        const settingsToPersist: PluginSettings = {
            ...settings,
            tars: {
                settings: this.encryptTarsSettings(settings.tars.settings),
            },
            chat: {
                ...settings.chat,
                // 移除 skills 字段，避免重复存储到 data.json
                // skills 数据现在独立存储在 .obsidian/plugins/formify/skills.json
                skills: undefined
            },
        };
        await this.plugin.saveData(settingsToPersist);
    }

    private decryptTarsSettings(settings?: TarsSettings | undefined): TarsSettings {
        if (!settings) {
            return cloneTarsSettings();
        }
        const providers = (settings.providers ?? []).map((provider: ProviderConfig) => {
            const options = provider.options || {};
            return {
                ...provider,
                options: {
                    ...options,
                    apiKey: decryptApiKey(options.apiKey || ''),
                    ...(options.apiSecret ? { apiSecret: decryptApiKey(options.apiSecret) } : {}),
                },
            };
        });
        DebugLogger.debug('[SettingsManager] API 密钥解密完成');
        return cloneTarsSettings({
            ...settings,
            providers,
        });
    }

    private encryptTarsSettings(settings: TarsSettings): TarsSettings {
        const providers = (settings.providers ?? []).map((provider: ProviderConfig) => {
            const options = provider.options || {};
            const encrypted: BaseOptions = {
                ...options,
                apiKey: encryptApiKey(options.apiKey || ''),
            };
            if (options.apiSecret) {
                encrypted.apiSecret = encryptApiKey(options.apiSecret);
            }
            return {
                ...provider,
                options: encrypted,
            };
        });
        DebugLogger.debug('[SettingsManager] API 密钥加密完成');
        return cloneTarsSettings({
            ...settings,
            providers,
        });
    }
}
