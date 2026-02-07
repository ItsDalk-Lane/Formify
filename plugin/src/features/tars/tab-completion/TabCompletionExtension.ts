import { Extension, Prec } from '@codemirror/state'
import { keymap, EditorView } from '@codemirror/view'
import { tabCompletionStateField, clearSuggestionEffect } from './TabCompletionState'
import { ghostTextExtension } from './GhostTextWidget'
import { createTabCompletionKeymap, createTriggerKeyHandler, createCancelHandlers } from './TabCompletionKeymap'
import { TabCompletionService, TabCompletionSettings } from './TabCompletionService'
import { App } from 'obsidian'
import { ProviderSettings } from '../providers'
import { getTabCompletionState } from './TabCompletionState'

/**
 * 创建 Tab 补全 CodeMirror 6 扩展
 * 
 * @param app Obsidian App 实例
 * @param providers AI provider 配置列表
 * @param settings Tab 补全设置
 * @returns CodeMirror 6 扩展数组
 */
export function createTabCompletionExtension(
    app: App,
    providers: ProviderSettings[],
    settings: TabCompletionSettings
): Extension[] {
    // 创建服务实例
    const service = new TabCompletionService(app, providers, settings)

    // 将服务存储在全局，以便更新设置时可以访问
    // @ts-ignore
    if (!window.__tarsTabCompletionService) {
        // @ts-ignore
        window.__tarsTabCompletionService = service
    } else {
        // 更新已有的服务实例
        // @ts-ignore
        window.__tarsTabCompletionService = service
    }

    // 确定触发键
    const triggerKey = settings.triggerKey || 'Alt'

    // 事件处理回调
    const callbacks = {
        triggerKey,
        onTrigger: (view: EditorView) => {
            service.trigger(view)
        },
        onConfirm: (view: EditorView, text: string, pos: number) => {
            service.confirm(view, text, pos)
        },
        onCancel: (view: EditorView) => {
            service.cancel()
        }
    }

    // 创建常规快捷键绑定（Enter/Escape）
    const keymapBindings = createTabCompletionKeymap(callbacks)

    // 创建触发键 DOM 事件处理器（用于处理单独的修饰键）
    const triggerHandler = createTriggerKeyHandler(callbacks)

    // 创建取消处理器（鼠标点击、失去焦点）
    const cancelHandlers = createCancelHandlers((view: EditorView) => {
        service.cancel()
    })

    // 监听文档变化，仅当用户在触发位置输入/编辑时才中断补全过程
    const cancelOnAnchorEdit = EditorView.updateListener.of((update) => {
        if (!update.docChanged) return

        const startState = getTabCompletionState(update.startState)
        if (!(startState.isLoading || startState.isShowing)) return

        let anchorPos = startState.suggestionPos

        for (const tr of update.transactions) {
            if (!tr.docChanged) continue

            let touchedAnchor = false
            tr.changes.iterChanges((fromA, toA) => {
                if (fromA <= anchorPos && anchorPos <= toA) {
                    touchedAnchor = true
                }
            })

            if (touchedAnchor) {
                service.cancel()
                update.view.dispatch({ effects: clearSuggestionEffect.of(undefined) })
                return
            }

            anchorPos = tr.changes.mapPos(anchorPos)
        }
    })

    // 返回完整的扩展集合
    return [
        // 状态字段
        tabCompletionStateField,
        // Ghost 文本装饰器
        ...ghostTextExtension,
        // 触发键处理器（DOM 事件，优先级最高）
        Prec.highest(triggerHandler),
        // 快捷键绑定（优先级高于默认绑定）
        Prec.high(keymap.of(keymapBindings)),
        // 取消处理器（鼠标/焦点）
		cancelHandlers,
		// 仅触发位置编辑才取消
		Prec.highest(cancelOnAnchorEdit)
    ]
}

/**
 * 获取全局 TabCompletionService 实例
 */
export function getTabCompletionService(): TabCompletionService | null {
    // @ts-ignore
    return window.__tarsTabCompletionService || null
}

/**
 * 更新全局 TabCompletionService 的设置
 */
export function updateTabCompletionSettings(settings: TabCompletionSettings): void {
    const service = getTabCompletionService()
    if (service) {
        service.updateSettings(settings)
    }
}

/**
 * 更新全局 TabCompletionService 的 providers
 */
export function updateTabCompletionProviders(providers: ProviderSettings[]): void {
    const service = getTabCompletionService()
    if (service) {
        service.updateProviders(providers)
    }
}

/**
 * 销毁全局 TabCompletionService
 */
export function disposeTabCompletionService(): void {
    const service = getTabCompletionService()
    if (service) {
        service.dispose()
        // @ts-ignore
        window.__tarsTabCompletionService = null
    }
}
