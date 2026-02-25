import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './PluginSettings';
import { cloneTarsSettings } from 'src/features/tars';
import type { TarsSettings } from 'src/features/tars';
import { encryptApiKey, decryptApiKey } from 'src/features/tars/utils/cryptoUtils';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from 'src/features/chat';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptDataService } from 'src/features/tars/system-prompts/SystemPromptDataService';
import { generateDeviceFingerprint } from 'src/features/tars/utils/cryptoUtils';

interface BaseOptions {
    apiKey: string;
    baseURL: string;
    model: string;
    parameters: Record<string, unknown>;
    enableWebSearch?: boolean;
    apiSecret?: string;
    [key: string]: unknown;
}

interface ProviderConfig {
    tag: string;
    vendor: string;
    options: BaseOptions;
    [key: string]: any;
}

type VendorApiKeysByDevice = Record<string, Record<string, string>>;

export class SettingsManager {
    private readonly currentDeviceFingerprint: string;

    constructor(private plugin: Plugin) {
        this.currentDeviceFingerprint = generateDeviceFingerprint();
    }

    private normalizeProviderVendor(vendor: string): string {
        return vendor === 'DoubaoImage' ? 'Doubao' : vendor;
    }

    private decryptVendorApiKeys(vendorApiKeysByDevice?: VendorApiKeysByDevice): Record<string, string> {
        if (!vendorApiKeysByDevice) return {};
        const result: Record<string, string> = {};
        for (const [vendor, slots] of Object.entries(vendorApiKeysByDevice)) {
            const encrypted = slots?.[this.currentDeviceFingerprint] ?? '';
            const plain = encrypted ? decryptApiKey(encrypted) : '';
            if (plain) {
                result[vendor] = plain;
            }
        }
        return result;
    }

    private encryptVendorApiKeys(
        current: VendorApiKeysByDevice | undefined,
        plainApiKeys: Record<string, string> | undefined
    ): VendorApiKeysByDevice | undefined {
        const next: VendorApiKeysByDevice = { ...(current ?? {}) };
        const normalized: Record<string, string> = {};
        for (const [vendor, key] of Object.entries(plainApiKeys ?? {})) {
            const normalizedVendor = this.normalizeProviderVendor(vendor);
            const trimmed = key.trim();
            if (!trimmed) continue;
            normalized[normalizedVendor] = trimmed;
        }

        const allVendors = new Set<string>([
            ...Object.keys(next),
            ...Object.keys(normalized),
        ]);

        for (const vendor of allVendors) {
            const plain = normalized[vendor] ?? '';
            const slots = { ...(next[vendor] ?? {}) };
            if (plain) {
                slots[this.currentDeviceFingerprint] = encryptApiKey(plain);
            } else {
                delete slots[this.currentDeviceFingerprint];
            }

            if (Object.keys(slots).length > 0) {
                next[vendor] = slots;
            } else {
                delete next[vendor];
            }
        }

        return Object.keys(next).length > 0 ? next : undefined;
    }

    async load(): Promise<PluginSettings> {
        const persisted = (await this.plugin.loadData()) ?? {};
        const rawChatSettings = persisted?.chat ?? {};
        const mergedChat = { ...DEFAULT_CHAT_SETTINGS, ...rawChatSettings };
        const tarsSettings = this.decryptTarsSettings(persisted?.tars?.settings);

        // 迁移内链解析配置到新结构
        const migratedSettings = this.migrateInternalLinkSettings(tarsSettings, mergedChat);

        // 迁移旧版默认系统消息到 data.json.tars.settings.systemPromptsData（向下兼容）
        try {
            const systemPromptService = SystemPromptDataService.getInstance(this.plugin.app);
            const migrated = await systemPromptService.migrateFromLegacyDefaultSystemMessage({
                enabled: (tarsSettings as any)?.enableDefaultSystemMsg,
                content: (tarsSettings as any)?.defaultSystemMsg
            });
            if (migrated) {
                migratedSettings.enableGlobalSystemPrompts = true;
            }
        } catch (error) {
            DebugLogger.error('[SettingsManager] 迁移默认系统消息失败（忽略，继续加载）', error);
        }

        // 剥离旧字段，避免继续在运行期被引用
        delete (migratedSettings as any).enableDefaultSystemMsg;
        delete (migratedSettings as any).defaultSystemMsg;

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
        const encryptedTars = this.encryptTarsSettings(settings.tars.settings);
        // 剥离旧字段，避免写回 data.json
        delete (encryptedTars as any).enableDefaultSystemMsg;
        delete (encryptedTars as any).defaultSystemMsg;

        // 基于当前 data.json 合并写回，避免覆盖由独立服务维护的字段
        const persisted = (await this.plugin.loadData()) ?? {};
        const persistedChat = persisted?.chat ?? {};
        const persistedTarsSettings = persisted?.tars?.settings ?? {};

        const mergedChat = {
            ...persistedChat,
            ...settings.chat,
        };
        const mergedTarsSettings = {
            ...persistedTarsSettings,
            ...encryptedTars,
        };
        delete (mergedTarsSettings as any).enableDefaultSystemMsg;
        delete (mergedTarsSettings as any).defaultSystemMsg;

        const settingsToPersist = {
            ...persisted,
            ...settings,
            chat: mergedChat,
            tars: {
                ...(persisted?.tars ?? {}),
                ...(settings?.tars ?? {}),
                settings: mergedTarsSettings,
            },
        };

        await this.plugin.saveData(settingsToPersist);
    }

    private decryptTarsSettings(settings?: TarsSettings | undefined): TarsSettings {
        if (!settings) {
            return cloneTarsSettings();
        }
        const vendorApiKeys = this.decryptVendorApiKeys(settings.vendorApiKeysByDevice);
        const providers = (settings.providers ?? []).map((provider: ProviderConfig) => {
            const options = provider.options || {};
            const normalizedVendor = this.normalizeProviderVendor(provider.vendor);
            const resolvedApiKey = vendorApiKeys[normalizedVendor] ?? '';
            const nextOptions: BaseOptions = {
                ...options,
                apiKey: resolvedApiKey,
            };
            delete (nextOptions as Record<string, unknown>).apiKeyByDevice;
            delete (nextOptions as Record<string, unknown>).apiSecretByDevice;

            return {
                ...provider,
                vendor: normalizedVendor,
                options: nextOptions,
            };
        });
        DebugLogger.debug('[SettingsManager] API 密钥按供应商解密完成');
        return cloneTarsSettings({
            ...settings,
            vendorApiKeys,
            providers,
        });
    }

    private encryptTarsSettings(settings: TarsSettings): TarsSettings {
        const vendorApiKeysByDevice = this.encryptVendorApiKeys(
            settings.vendorApiKeysByDevice,
            settings.vendorApiKeys
        );
        const providers = (settings.providers ?? []).map((provider: ProviderConfig) => {
            const options = provider.options || {};
            const encrypted: BaseOptions = {
                ...options,
                apiKey: '',
            };
            delete (encrypted as Record<string, unknown>).apiKeyByDevice;
            delete (encrypted as Record<string, unknown>).apiSecretByDevice;
            if (Object.prototype.hasOwnProperty.call(options, 'apiSecret')) {
                encrypted.apiSecret = '';
            }
            return {
                ...provider,
                vendor: this.normalizeProviderVendor(provider.vendor),
                options: encrypted,
            };
        });
        DebugLogger.debug('[SettingsManager] API 密钥按供应商加密完成');
        return cloneTarsSettings({
            ...settings,
            vendorApiKeys: {},
            vendorApiKeysByDevice,
            providers,
        });
    }
}
