export { TabCompletionService, DEFAULT_TAB_COMPLETION_SETTINGS } from './TabCompletionService'
export {
    createTabCompletionExtension,
    getTabCompletionService,
    updateTabCompletionSettings,
    updateTabCompletionProviders,
    disposeTabCompletionService
} from './TabCompletionExtension'
export type { TabCompletionSettings } from './TabCompletionService'
export {
    tabCompletionStateField,
    getTabCompletionState,
    setSuggestionEffect,
    clearSuggestionEffect,
    setLoadingEffect,
    confirmSuggestionEffect
} from './TabCompletionState'
export type { TabCompletionStateValue } from './TabCompletionState'
export { buildEditorContext, generateContextPrompt, ContextType } from './ContextBuilder'
export type { EditorContext, ContextBuilderOptions } from './ContextBuilder'
export { createTabCompletionKeymap, createCancelHandlers } from './TabCompletionKeymap'
export { ghostTextExtension, ghostTextPlugin, ghostTextStyle } from './GhostTextWidget'
