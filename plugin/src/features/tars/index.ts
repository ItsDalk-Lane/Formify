export { TarsFeatureManager } from './TarsFeatureManager'
export type { TarsSettings, EditorStatus } from './settings'
export type { ProviderSettings } from './providers'
export { DEFAULT_TARS_SETTINGS, availableVendors, APP_FOLDER, cloneTarsSettings } from './settings'
export { encryptApiKey, decryptApiKey, maskApiKey, generateDeviceFingerprint } from './utils/cryptoUtils'

// Tab 补全功能导出
export {
    TabCompletionService,
    createTabCompletionExtension,
    getTabCompletionService,
    updateTabCompletionSettings,
    updateTabCompletionProviders,
    disposeTabCompletionService,
    DEFAULT_TAB_COMPLETION_SETTINGS
} from './tab-completion'
export type { TabCompletionSettings, TabCompletionStateValue, EditorContext } from './tab-completion'