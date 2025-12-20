import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './PluginSettings';
import { cloneTarsSettings } from 'src/features/tars';
import type { TarsSettings } from 'src/features/tars';
import { encryptApiKey, decryptApiKey } from 'src/features/tars/utils/cryptoUtils';
import { DEFAULT_CHAT_SETTINGS } from 'src/features/chat';
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
        const mergedChat = { ...DEFAULT_CHAT_SETTINGS, ...(persisted.chat ?? {}) };
        const tarsSettings = this.decryptTarsSettings(persisted?.tars?.settings);
        return {
            ...DEFAULT_SETTINGS,
            ...persisted,
            tars: {
                settings: tarsSettings,
            },
            chat: mergedChat,
        };
    }

    async save(settings: PluginSettings): Promise<void> {
        const settingsToPersist: PluginSettings = {
            ...settings,
            tars: {
                settings: this.encryptTarsSettings(settings.tars.settings),
            },
            chat: { ...settings.chat },
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
