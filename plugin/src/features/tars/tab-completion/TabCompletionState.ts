import { StateField, StateEffect, EditorState } from '@codemirror/state'

/**
 * Tab 补全状态接口
 */
export interface TabCompletionStateValue {
    /** 是否正在显示建议 */
    isShowing: boolean
    /** 建议文本内容 */
    suggestionText: string
    /** 建议开始位置（光标位置） */
    suggestionPos: number
    /** 是否正在加载 */
    isLoading: boolean
    /** 请求 ID，用于取消过期请求 */
    requestId: string | null
}

/**
 * 默认状态
 */
export const defaultTabCompletionState: TabCompletionStateValue = {
    isShowing: false,
    suggestionText: '',
    suggestionPos: 0,
    isLoading: false,
    requestId: null
}

/**
 * 设置建议内容的 Effect
 */
export const setSuggestionEffect = StateEffect.define<{
    text: string
    pos: number
    requestId: string
}>()

/**
 * 清除建议的 Effect
 */
export const clearSuggestionEffect = StateEffect.define<void>()

/**
 * 设置加载状态的 Effect
 */
export const setLoadingEffect = StateEffect.define<{
    isLoading: boolean
    requestId: string | null
}>()

/**
 * 确认建议（将建议文本插入文档）的 Effect
 */
export const confirmSuggestionEffect = StateEffect.define<void>()

/**
 * Tab 补全状态 StateField
 */
export const tabCompletionStateField = StateField.define<TabCompletionStateValue>({
    create(): TabCompletionStateValue {
        return { ...defaultTabCompletionState }
    },

    update(state, tr): TabCompletionStateValue {
        // 处理 Effects
        for (const effect of tr.effects) {
            if (effect.is(setSuggestionEffect)) {
                return {
                    isShowing: true,
                    suggestionText: effect.value.text,
                    suggestionPos: effect.value.pos,
                    isLoading: false,
                    requestId: effect.value.requestId
                }
            }

            if (effect.is(clearSuggestionEffect)) {
                return { ...defaultTabCompletionState }
            }

            if (effect.is(setLoadingEffect)) {
                return {
                    ...state,
                    isLoading: effect.value.isLoading,
                    requestId: effect.value.requestId
                }
            }

            if (effect.is(confirmSuggestionEffect)) {
                // 确认后清除状态（实际插入由外部处理）
                return { ...defaultTabCompletionState }
            }
        }

        // 如果文档发生变化且当前有显示建议，则清除建议
        if (tr.docChanged && state.isShowing) {
            return { ...defaultTabCompletionState }
        }

        // 如果光标位置发生变化且当前有显示建议，则清除建议
        if (tr.selection && state.isShowing) {
            const newPos = tr.selection.main.head
            // 允许光标在建议位置不变
            if (newPos !== state.suggestionPos) {
                return { ...defaultTabCompletionState }
            }
        }

        return state
    }
})

/**
 * 从 EditorState 获取 Tab 补全状态
 */
export function getTabCompletionState(state: EditorState): TabCompletionStateValue {
    return state.field(tabCompletionStateField, false) ?? defaultTabCompletionState
}
