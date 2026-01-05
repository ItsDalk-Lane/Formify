import { Extension, Prec } from '@codemirror/state'
import { keymap, EditorView } from '@codemirror/view'
import { tabCompletionStateField, clearSuggestionEffect } from './TabCompletionState'
import { ghostTextExtension } from './GhostTextWidget'
import { createTabCompletionKeymap, createTriggerKeyHandler, createCancelHandlers } from './TabCompletionKeymap'
import { TabCompletionService, TabCompletionSettings } from './TabCompletionService'
import { App } from 'obsidian'
import { ProviderSettings } from '../providers'

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

    console.debug('[TabCompletion] 创建扩展，触发键:', triggerKey)

    // 事件处理回调
    const callbacks = {
        triggerKey,
        onTrigger: (view: EditorView) => {
            console.debug('[TabCompletion] onTrigger 被调用')
            service.trigger(view)
        },
        onConfirm: (view: EditorView, text: string, pos: number) => {
            console.debug('[TabCompletion] onConfirm 被调用')
            service.confirm(view, text, pos)
        },
        onCancel: (view: EditorView) => {
            console.debug('[TabCompletion] onCancel 被调用')
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
        cancelHandlers
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
