import { EditorView, KeyBinding } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { getTabCompletionState, clearSuggestionEffect, confirmSuggestionEffect } from './TabCompletionState'

/**
 * Tab 补全触发回调类型
 */
export type TriggerCallback = (view: EditorView) => void

/**
 * Tab 补全确认回调类型
 */
export type ConfirmCallback = (view: EditorView, text: string, pos: number) => void

/**
 * Tab 补全取消回调类型
 */
export type CancelCallback = (view: EditorView) => void

/**
 * 检查是否为触发键
 * 支持单独的修饰键（如 Alt）或组合键（如 Ctrl-Space）
 */
function isTriggerKey(event: KeyboardEvent, triggerKey: string): boolean {
    const key = triggerKey.toLowerCase()
    
    // 处理单独的修饰键
    if (key === 'alt' && event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        return true
    }
    if (key === 'ctrl' && event.key === 'Control' && !event.altKey && !event.metaKey && !event.shiftKey) {
        return true
    }
    if (key === 'shift' && event.key === 'Shift' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return true
    }
    if (key === 'meta' && event.key === 'Meta' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        return true
    }
    
    // 处理 Tab 键
    if (key === 'tab' && event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        return true
    }
    
    // 处理组合键（格式如 "Ctrl-Space", "Alt-/"）
    if (key.includes('-')) {
        const parts = key.split('-')
        const modifier = parts[0].toLowerCase()
        const mainKey = parts[1].toLowerCase()
        
        const modifierMatch = 
            (modifier === 'ctrl' && event.ctrlKey) ||
            (modifier === 'alt' && event.altKey) ||
            (modifier === 'shift' && event.shiftKey) ||
            (modifier === 'meta' && event.metaKey) ||
            (modifier === 'mod' && (event.ctrlKey || event.metaKey))
        
        const keyMatch = event.key.toLowerCase() === mainKey || 
                        event.code.toLowerCase() === mainKey ||
                        event.code.toLowerCase() === `key${mainKey}`
        
        return modifierMatch && keyMatch
    }
    
    return false
}

/**
 * 创建 Tab 补全快捷键绑定（用于常规键）
 */
export function createTabCompletionKeymap(options: {
    triggerKey: string
    onTrigger: TriggerCallback
    onConfirm: ConfirmCallback
    onCancel: CancelCallback
}): KeyBinding[] {
    const { onConfirm, onCancel } = options

    return [
        // Enter 键确认
        {
            key: 'Enter',
            run: (view: EditorView) => {
                const state = getTabCompletionState(view.state)

                if (state.isShowing && state.suggestionText) {
                    onConfirm(view, state.suggestionText, state.suggestionPos)
                    view.dispatch({
                        effects: confirmSuggestionEffect.of(undefined)
                    })
                    return true
                }

                return false
            }
        },
        // Escape 键取消
        {
            key: 'Escape',
            run: (view: EditorView) => {
                const state = getTabCompletionState(view.state)

                if (state.isShowing || state.isLoading) {
                    onCancel(view)
                    view.dispatch({
                        effects: clearSuggestionEffect.of(undefined)
                    })
                    return true
                }

                return false
            }
        }
    ]
}

/**
 * 创建 DOM 事件处理器
 * 用于处理单独的修饰键（如 Alt）作为触发键的情况
 */
export function createTriggerKeyHandler(options: {
    triggerKey: string
    onTrigger: TriggerCallback
    onConfirm: ConfirmCallback
    onCancel: CancelCallback
}) {
    const { triggerKey, onTrigger, onConfirm, onCancel } = options
    
    // 记录是否已经处理过 keydown（避免重复触发）
    let keydownHandled = false
    
    return EditorView.domEventHandlers({
        keydown: (event: KeyboardEvent, view: EditorView) => {
            // 检查是否为触发键
            if (isTriggerKey(event, triggerKey)) {
                const state = getTabCompletionState(view.state)
                
                // 避免重复处理
                if (keydownHandled) {
                    return false
                }
                keydownHandled = true
                
                if (state.isShowing && state.suggestionText) {
                    // 已有建议，确认插入
                    onConfirm(view, state.suggestionText, state.suggestionPos)
                    view.dispatch({
                        effects: confirmSuggestionEffect.of(undefined)
                    })
                    event.preventDefault()
                    event.stopPropagation()
                    return true
                }

                if (state.isLoading) {
                    // 正在加载中，忽略
                    event.preventDefault()
                    return true
                }

                // 触发新的建议请求
                console.debug('[TabCompletion] 触发键按下，发起请求')
                onTrigger(view)
                event.preventDefault()
                event.stopPropagation()
                return true
            }
            
            // 其他按键不在此处取消建议/中断请求。
            // 中断逻辑由“触发位置发生编辑”统一控制，避免普通操作打断补全过程。
            return false
        },
        
        keyup: (event: KeyboardEvent, view: EditorView) => {
            // 重置 keydown 处理标记
            if (isTriggerKey(event, triggerKey)) {
                keydownHandled = false
            }
            return false
        }
    })
}

/**
 * 创建用于取消建议的事件处理器
 * 当用户输入任何字符、点击其他位置时取消建议
 */
export function createCancelHandlers(onCancel: CancelCallback) {
    return EditorView.domEventHandlers({
        // 保持默认行为：鼠标点击/失焦不再自动取消。
        // 仅当用户在触发位置输入内容、或显式按 Escape 取消、或 AI 请求失败时才会中断。
        mousedown: () => false,
        blur: () => false
    })
}
