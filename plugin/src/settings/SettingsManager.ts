import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './PluginSettings';
import { cloneTarsSettings } from 'src/features/tars';
import type { TarsSettings } from 'src/features/tars';
import { encryptApiKey, decryptApiKey } from 'src/features/tars/utils/cryptoUtils';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from 'src/features/chat';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptDataService } from 'src/features/tars/system-prompts/SystemPromptDataService';
import { McpServerDataService } from 'src/features/tars/mcp/McpServerDataService';
import type { McpSettings } from 'src/features/tars/mcp/types';
import { DEFAULT_MCP_SETTINGS } from 'src/features/tars/mcp/types';
import { generateDeviceFingerprint } from 'src/features/tars/utils/cryptoUtils';
import {
    canDeriveAIDataFolderFromLegacy,
    ensureAIDataFolders,
    getChatHistoryPath,
    getPromptTemplatePath,
    moveFolderFilesWithRenameOnConflict,
} from 'src/utils/AIPathManager';

const LEGACY_QUICK_ACTIONS_DATA_FILE = '.obsidian/plugins/formify/skills.json';
const LEGACY_SYSTEM_PROMPTS_DATA_FILE = '.obsidian/plugins/formify/system-prompts.json';

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
        const legacyQuickActionSettings = rawChatSettings as {
            enableSelectionToolbar?: boolean;
            maxToolbarButtons?: number;
            selectionToolbarStreamOutput?: boolean;
        };
        const mergedChat = {
            ...DEFAULT_CHAT_SETTINGS,
            ...rawChatSettings,
            enableQuickActions:
                rawChatSettings?.enableQuickActions
                ?? legacyQuickActionSettings.enableSelectionToolbar
                ?? DEFAULT_CHAT_SETTINGS.enableQuickActions,
            maxQuickActionButtons:
                rawChatSettings?.maxQuickActionButtons
                ?? legacyQuickActionSettings.maxToolbarButtons
                ?? DEFAULT_CHAT_SETTINGS.maxQuickActionButtons,
            quickActionsStreamOutput:
                rawChatSettings?.quickActionsStreamOutput
                ?? legacyQuickActionSettings.selectionToolbarStreamOutput
                ?? DEFAULT_CHAT_SETTINGS.quickActionsStreamOutput,
        };
        const tarsSettings = this.decryptTarsSettings(persisted?.tars?.settings);
        const aiDataFolder = this.resolveAiDataFolder(persisted, rawChatSettings);

        // 迁移内链解析配置到新结构
        const migratedSettings = this.migrateInternalLinkSettings(tarsSettings, mergedChat);

        // 迁移旧版默认系统消息到 Markdown 系统提示词目录（向下兼容）
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

        // 从 Markdown 目录加载外部 MCP 服务器（内置 MCP 配置仍走 settings）
        try {
            const mcpServerService = McpServerDataService.getInstance(this.plugin.app);
            const markdownServers = await mcpServerService.loadServers(aiDataFolder);
            migratedSettings.mcp = {
                ...DEFAULT_MCP_SETTINGS,
                ...(migratedSettings.mcp ?? {}),
                servers: markdownServers,
            };
        } catch (error) {
            DebugLogger.error('[SettingsManager] 加载 MCP 服务器 Markdown 配置失败，回退空列表', error);
            migratedSettings.mcp = {
                ...DEFAULT_MCP_SETTINGS,
                ...(migratedSettings.mcp ?? {}),
                servers: [],
            };
        }

        // 剥离旧字段，避免继续在运行期被引用
        delete (migratedSettings as any).enableDefaultSystemMsg;
        delete (migratedSettings as any).defaultSystemMsg;
        delete (migratedSettings as any).systemPromptsData;

        const { promptTemplateFolder: _legacyPromptTemplateFolder, ...persistedWithoutLegacyTop } = persisted;
        const {
            chatFolder: _legacyChatFolder,
            enableSelectionToolbar: _legacyEnableSelectionToolbar,
            maxToolbarButtons: _legacyMaxToolbarButtons,
            selectionToolbarStreamOutput: _legacySelectionToolbarStreamOutput,
            quickActions: _legacyQuickActions,
            skills: _legacySkills,
            ...chatWithoutLegacy
        } = mergedChat as ChatSettings & {
            chatFolder?: string;
            enableSelectionToolbar?: boolean;
            maxToolbarButtons?: number;
            selectionToolbarStreamOutput?: boolean;
            quickActions?: unknown;
            skills?: unknown;
        };

        return {
            ...DEFAULT_SETTINGS,
            ...persistedWithoutLegacyTop,
            aiDataFolder,
            tars: {
                settings: migratedSettings,
            },
            chat: {
                ...chatWithoutLegacy,
                quickActions: [],
            },
        };
    }

    async migrateAIDataStorage(settings: PluginSettings): Promise<void> {
        const persisted = (await this.plugin.loadData()) ?? {};
        const rawChatSettings = persisted?.chat ?? {};
        const legacyPromptTemplateFolder = this.normalizeLegacyFolderPath(persisted?.promptTemplateFolder);
        const legacyChatFolder = this.normalizeLegacyFolderPath(rawChatSettings?.chatFolder);
        const aiDataFolder = this.normalizeLegacyFolderPath(settings.aiDataFolder) || DEFAULT_SETTINGS.aiDataFolder;

        await ensureAIDataFolders(this.plugin.app, aiDataFolder);

        const promptTargetFolder = getPromptTemplatePath(aiDataFolder);
        const chatTargetFolder = getChatHistoryPath(aiDataFolder);

        let movedCount = 0;
        if (legacyPromptTemplateFolder && legacyPromptTemplateFolder !== promptTargetFolder) {
            movedCount += await moveFolderFilesWithRenameOnConflict(
                this.plugin.app,
                legacyPromptTemplateFolder,
                promptTargetFolder
            );
        }

        if (legacyChatFolder && legacyChatFolder !== chatTargetFolder) {
            movedCount += await moveFolderFilesWithRenameOnConflict(
                this.plugin.app,
                legacyChatFolder,
                chatTargetFolder
            );
        }

        const {
            promptTemplateFolder: _legacyPromptTemplateFolder,
            ...persistedWithoutLegacyTop
        } = persisted;
        const {
            chatFolder: _legacyChatFolder,
            ...persistedChatWithoutLegacy
        } = (persistedWithoutLegacyTop?.chat ?? {}) as Record<string, unknown>;

        const nextData = {
            ...persistedWithoutLegacyTop,
            aiDataFolder,
            chat: persistedChatWithoutLegacy,
        };

        await this.plugin.saveData(nextData);

        if (movedCount > 0) {
            DebugLogger.info(`[SettingsManager] AI数据目录迁移完成，迁移文件数量: ${movedCount}`);
        }
    }

    async cleanupLegacyAIStorage(): Promise<void> {
        const persisted = (await this.plugin.loadData()) ?? {};
        let changed = false;

        const nextData: Record<string, unknown> = {
            ...persisted,
        };
        const nextChat: Record<string, unknown> = {
            ...(persisted?.chat ?? {}),
        };
        const nextTarsSettings: Record<string, unknown> = {
            ...(persisted?.tars?.settings ?? {}),
        };

        if (Object.prototype.hasOwnProperty.call(nextChat, 'quickActions')) {
            delete nextChat.quickActions;
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(nextChat, 'skills')) {
            delete nextChat.skills;
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(nextTarsSettings, 'systemPromptsData')) {
            delete nextTarsSettings.systemPromptsData;
            changed = true;
        }
        // 清理已废弃的内链解析旧字段
        for (const legacyTarsField of ['enableInternalLink', 'maxLinkParseDepth', 'linkParseTimeout', 'enableDefaultSystemMsg', 'defaultSystemMsg'] as const) {
            if (Object.prototype.hasOwnProperty.call(nextTarsSettings, legacyTarsField)) {
                delete nextTarsSettings[legacyTarsField];
                changed = true;
            }
        }
        // 清理运行时状态和冗余字段
        for (const runtimeTarsField of ['editorStatus', 'vendorApiKeys'] as const) {
            if (Object.prototype.hasOwnProperty.call(nextTarsSettings, runtimeTarsField)) {
                delete nextTarsSettings[runtimeTarsField];
                changed = true;
            }
        }
        // 清理 Chat 中已废弃的内链解析和选择工具栏旧字段
        for (const legacyChatField of ['enableInternalLinkParsing', 'parseLinksInTemplates', 'maxLinkParseDepth', 'linkParseTimeout', 'enableSelectionToolbar', 'maxToolbarButtons', 'selectionToolbarStreamOutput'] as const) {
            if (Object.prototype.hasOwnProperty.call(nextChat, legacyChatField)) {
                delete nextChat[legacyChatField];
                changed = true;
            }
        }
        if (nextTarsSettings.mcp && typeof nextTarsSettings.mcp === 'object') {
            const nextMcpSettings = { ...(nextTarsSettings.mcp as Record<string, unknown>) };
            if (Object.prototype.hasOwnProperty.call(nextMcpSettings, 'servers')) {
                delete nextMcpSettings.servers;
                nextTarsSettings.mcp = nextMcpSettings;
                changed = true;
            }
        }

        if (changed) {
            nextData.chat = nextChat;
            nextData.tars = {
                ...(persisted?.tars ?? {}),
                settings: nextTarsSettings,
            };
            await this.plugin.saveData(nextData);
            DebugLogger.info('[SettingsManager] 已清理 data.json 中的旧快捷操作/系统提示词/MCP 服务器存储位点');
        }

        await this.removeLegacyFileIfExists(LEGACY_QUICK_ACTIONS_DATA_FILE);
        await this.removeLegacyFileIfExists(LEGACY_SYSTEM_PROMPTS_DATA_FILE);
        this.cleanupRuntimeLegacyFields();
    }

    private async removeLegacyFileIfExists(path: string): Promise<void> {
        try {
            const exists = await this.plugin.app.vault.adapter.exists(path);
            if (!exists) {
                return;
            }
            await this.plugin.app.vault.adapter.remove(path);
            DebugLogger.info('[SettingsManager] 已删除旧数据文件', path);
        } catch (error) {
            DebugLogger.warn('[SettingsManager] 删除旧数据文件失败（忽略）', { path, error });
        }
    }

    private cleanupRuntimeLegacyFields(): void {
        const runtimeSettings = (this.plugin as any).settings as PluginSettings | undefined;
        if (!runtimeSettings) {
            return;
        }
        if (runtimeSettings.chat) {
            runtimeSettings.chat.quickActions = [];
            if ('skills' in (runtimeSettings.chat as Record<string, unknown>)) {
                delete (runtimeSettings.chat as Record<string, unknown>).skills;
            }
        }
        if (runtimeSettings.tars?.settings && 'systemPromptsData' in (runtimeSettings.tars.settings as Record<string, unknown>)) {
            delete (runtimeSettings.tars.settings as Record<string, unknown>).systemPromptsData;
        }
    }

    private resolveAiDataFolder(
        persisted: Record<string, any>,
        rawChatSettings: Record<string, any>
    ): string {
        const persistedAiDataFolder = this.normalizeLegacyFolderPath(persisted?.aiDataFolder);
        const legacyPromptTemplateFolder = this.normalizeLegacyFolderPath(persisted?.promptTemplateFolder);
        const legacyChatFolder = this.normalizeLegacyFolderPath(rawChatSettings?.chatFolder);

        if (persistedAiDataFolder && persistedAiDataFolder !== DEFAULT_SETTINGS.aiDataFolder) {
            return persistedAiDataFolder;
        }

        const derived = canDeriveAIDataFolderFromLegacy(legacyPromptTemplateFolder, legacyChatFolder);
        if (derived) {
            return derived;
        }

        return persistedAiDataFolder || DEFAULT_SETTINGS.aiDataFolder;
    }

    private normalizeLegacyFolderPath(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const normalized = value.trim().replace(/[\\/]+$/g, '');
        return normalized.length > 0 ? normalized : undefined;
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
        delete (mergedChat as any).chatFolder;
        delete (mergedChat as any).quickActions;
        delete (mergedChat as any).skills;
        // 剥离已废弃的内链解析旧字段（已迁移到 tars.settings.internalLinkParsing）
        delete (mergedChat as any).enableInternalLinkParsing;
        delete (mergedChat as any).parseLinksInTemplates;
        delete (mergedChat as any).maxLinkParseDepth;
        delete (mergedChat as any).linkParseTimeout;
        // 剥离已废弃的选择工具栏旧字段（已迁移到 quickActions 系列）
        delete (mergedChat as any).enableSelectionToolbar;
        delete (mergedChat as any).maxToolbarButtons;
        delete (mergedChat as any).selectionToolbarStreamOutput;
        const mergedTarsSettings = {
            ...persistedTarsSettings,
            ...encryptedTars,
        };
        delete (mergedTarsSettings as any).enableDefaultSystemMsg;
        delete (mergedTarsSettings as any).defaultSystemMsg;
        delete (mergedTarsSettings as any).systemPromptsData;
        // 剥离运行时状态字段（不应持久化）
        delete (mergedTarsSettings as any).editorStatus;
        // 剥离运行时明文密钥（实际密钥存储在 vendorApiKeysByDevice 中）
        delete (mergedTarsSettings as any).vendorApiKeys;
        // 剥离已废弃的内链解析旧字段（已迁移到 internalLinkParsing）
        delete (mergedTarsSettings as any).enableInternalLink;
        delete (mergedTarsSettings as any).maxLinkParseDepth;
        delete (mergedTarsSettings as any).linkParseTimeout;
        const normalizedAiDataFolder = this.normalizeLegacyFolderPath(settings.aiDataFolder) || DEFAULT_SETTINGS.aiDataFolder;
        const mcpServerService = McpServerDataService.getInstance(this.plugin.app);
        const runtimeMcpSettings: McpSettings = {
            ...DEFAULT_MCP_SETTINGS,
            ...(settings.tars.settings.mcp ?? {}),
        };
        const normalizedMcpServers = await mcpServerService.syncServers(
            normalizedAiDataFolder,
            runtimeMcpSettings.servers ?? []
        );
        settings.tars.settings.mcp = {
            ...runtimeMcpSettings,
            servers: normalizedMcpServers,
        };

        const mergedMcpSettings = {
            ...DEFAULT_MCP_SETTINGS,
            ...((mergedTarsSettings as any).mcp ?? {}),
        } as Record<string, unknown>;
        delete mergedMcpSettings.servers;
        (mergedTarsSettings as any).mcp = mergedMcpSettings;

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
        delete (settingsToPersist as any).promptTemplateFolder;

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
