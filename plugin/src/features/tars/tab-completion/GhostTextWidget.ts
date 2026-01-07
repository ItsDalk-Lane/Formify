import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { getTabCompletionState } from './TabCompletionState'

/**
 * 灰色建议文本 Widget
 * 用于在光标位置后显示 AI 生成的续写建议
 */
class GhostTextWidgetType extends WidgetType {
    constructor(readonly text: string) {
        super()
    }

    eq(other: GhostTextWidgetType): boolean {
        return this.text === other.text
    }

    toDOM(): HTMLElement {
        const container = document.createElement('span')
        container.className = 'tars-ghost-text'
        container.setAttribute('aria-hidden', 'true')
        
        // 处理多行文本
        const lines = this.text.split('\n')
        lines.forEach((line, index) => {
            if (index > 0) {
                container.appendChild(document.createElement('br'))
            }
            const textNode = document.createTextNode(line)
            container.appendChild(textNode)
        })

        return container
    }

    // 不允许忽略事件，确保点击会取消建议
    ignoreEvent(): boolean {
        return false
    }
}

/**
 * 加载中提示 Widget
 */
class LoadingWidgetType extends WidgetType {
    constructor() {
        super()
    }

    eq(other: LoadingWidgetType): boolean {
        return true
    }

    toDOM(): HTMLElement {
        const container = document.createElement('span')
        container.className = 'tars-ghost-text-loading'
        container.textContent = '...'
        container.setAttribute('aria-label', '正在生成建议')
        return container
    }

    ignoreEvent(): boolean {
        return false
    }
}

/**
 * Ghost Text 装饰器插件
 * 监听状态变化，在光标位置渲染灰色建议文本
 */
export const ghostTextPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view)
        }

        update(update: ViewUpdate): void {
            // 状态变化时重新构建装饰
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view)
            } else {
                // 检查 tab completion 状态是否变化
                const oldState = getTabCompletionState(update.startState)
                const newState = getTabCompletionState(update.state)
                
                if (oldState.isShowing !== newState.isShowing ||
                    oldState.suggestionText !== newState.suggestionText ||
                    oldState.isLoading !== newState.isLoading ||
                    oldState.suggestionPos !== newState.suggestionPos) {
                    this.decorations = this.buildDecorations(update.view)
                }
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>()
            const state = getTabCompletionState(view.state)

            if (state.isLoading) {
                // 显示加载提示
                const pos = state.suggestionPos
                const widget = Decoration.widget({
                    widget: new LoadingWidgetType(),
                    side: 1 // 显示在光标后面
                })
                builder.add(pos, pos, widget)
            } else if (state.isShowing && state.suggestionText) {
                // 显示建议文本
                const widget = Decoration.widget({
                    widget: new GhostTextWidgetType(state.suggestionText),
                    side: 1 // 显示在光标后面
                })
                builder.add(state.suggestionPos, state.suggestionPos, widget)
            }

            return builder.finish()
        }
    },
    {
        decorations: instance => instance.decorations
    }
)

/**
 * Ghost Text 样式
 */
export const ghostTextStyle = EditorView.baseTheme({
    '.tars-ghost-text': {
        color: 'var(--text-muted)',
        opacity: '0.6',
        fontStyle: 'italic',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'pre-wrap'
    },
    '.tars-ghost-text-loading': {
        color: 'var(--text-muted)',
        opacity: '0.5',
        fontStyle: 'italic',
        animation: 'tars-loading-pulse 1.5s ease-in-out infinite'
    },
    '@keyframes tars-loading-pulse': {
        '0%, 100%': { opacity: '0.3' },
        '50%': { opacity: '0.7' }
    }
})

/**
 * 导出完整的 Ghost Text 扩展
 */
export const ghostTextExtension = [ghostTextPlugin, ghostTextStyle]
