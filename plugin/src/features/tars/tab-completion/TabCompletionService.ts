import { App, Notice, MarkdownView } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { setSuggestionEffect, clearSuggestionEffect, setLoadingEffect } from './TabCompletionState'
import { 
    buildEditorContext, 
    generateContextPrompt, 
    EditorContext,
    postProcessSuggestion,
    limitSuggestionLength 
} from './ContextBuilder'
import { ProviderSettings, Message } from '../providers'
import { availableVendors } from '../settings'
import { t } from '../lang/helper'
import { DebugLogger } from '../../../utils/DebugLogger'

/**
 * Tab 补全设置接口
 */
export interface TabCompletionSettings {
    /** 是否启用 Tab 补全 */
    enabled: boolean
    /** 触发快捷键 */
    triggerKey: string
    /** 上下文长度（光标前） */
    contextLengthBefore: number
    /** 上下文长度（光标后） */
    contextLengthAfter: number
    /** 请求超时时间（毫秒） */
    timeout: number
    /** 使用的 AI provider 标签 */
    providerTag: string
}

/**
 * 默认设置
 */
export const DEFAULT_TAB_COMPLETION_SETTINGS: TabCompletionSettings = {
    enabled: false,
    triggerKey: 'Alt',
    contextLengthBefore: 1000,
    contextLengthAfter: 500,
    timeout: 5000,
    providerTag: ''
}

/**
 * 连续使用检测配置
 */
interface ContinuousUsageConfig {
    /** 连续使用的时间窗口（毫秒） */
    timeWindowMs: number
    /** 被认定为连续使用所需的最小次数 */
    minConsecutiveCount: number
    /** 连续使用时的最大句子数 */
    maxSentencesOnContinuous: number
    /** 默认（非连续）时的最大句子数 */
    defaultMaxSentences: number
}

const CONTINUOUS_USAGE_CONFIG: ContinuousUsageConfig = {
    timeWindowMs: 5000,          // 5秒内
    minConsecutiveCount: 3,       // 连续3次
    maxSentencesOnContinuous: 5,  // 连续使用时最多5句
    defaultMaxSentences: 1        // 默认1句
}

/**
 * Tab 补全服务
 * 负责协调 AI 请求、状态管理和文本插入
 */
export class TabCompletionService {
    private app: App
    private providers: ProviderSettings[]
    private settings: TabCompletionSettings
    private currentController: AbortController | null = null
    private requestCounter = 0
    private lastRequestTime = 0
    private readonly REQUEST_DEBOUNCE_MS = 300 // 防抖时间

    // 连续使用检测
    private completionHistory: number[] = []  // 记录最近的补全时间戳
    private lastConfirmTime = 0               // 上一次确认的时间

    constructor(app: App, providers: ProviderSettings[], settings: TabCompletionSettings) {
        this.app = app
        this.providers = providers
        this.settings = settings
    }

    /**
     * 检测是否处于连续使用模式
     */
    private isContinuousUsage(): boolean {
        const now = Date.now()
        const { timeWindowMs, minConsecutiveCount } = CONTINUOUS_USAGE_CONFIG

        // 清理过期的历史记录
        this.completionHistory = this.completionHistory.filter(
            time => now - time < timeWindowMs
        )

        // 检查是否有足够的连续使用次数
        return this.completionHistory.length >= minConsecutiveCount - 1
    }

    /**
     * 记录一次补全确认
     */
    private recordCompletion(): void {
        const now = Date.now()
        this.completionHistory.push(now)
        this.lastConfirmTime = now

        // 只保留最近的记录
        const maxHistory = CONTINUOUS_USAGE_CONFIG.minConsecutiveCount + 2
        if (this.completionHistory.length > maxHistory) {
            this.completionHistory = this.completionHistory.slice(-maxHistory)
        }
    }

    /**
     * 获取当前应该使用的最大句子数
     */
    private getMaxSentences(): number {
        if (this.isContinuousUsage()) {
            DebugLogger.debug('[TabCompletion] 检测到连续使用，增加建议长度')
            return CONTINUOUS_USAGE_CONFIG.maxSentencesOnContinuous
        }
        return CONTINUOUS_USAGE_CONFIG.defaultMaxSentences
    }

    /**
     * 更新设置
     */
    updateSettings(settings: TabCompletionSettings): void {
        this.settings = settings
    }

    /**
     * 更新 providers
     */
    updateProviders(providers: ProviderSettings[]): void {
        this.providers = providers
    }

    /**
     * 检查编辑器是否为只读模式
     */
    private isEditorReadOnly(view: EditorView): boolean {
        return !view.state.facet(EditorView.editable)
    }

    /**
     * 获取当前配置的 provider
     */
    private getProvider(): ProviderSettings | null {
        if (!this.settings.providerTag) {
            // 如果没有配置，使用第一个可用的 provider
            return this.providers.length > 0 ? this.providers[0] : null
        }
        return this.providers.find(p => p.tag === this.settings.providerTag) || null
    }

    /**
     * 触发 AI 建议请求
     */
    async trigger(view: EditorView): Promise<void> {
        // 防抖检查
        const now = Date.now()
        if (now - this.lastRequestTime < this.REQUEST_DEBOUNCE_MS) {
            DebugLogger.debug('[TabCompletion] 请求被防抖过滤')
            return
        }
        this.lastRequestTime = now

        // 检查只读模式
        if (this.isEditorReadOnly(view)) {
            new Notice(t('Editor is in read-only mode'))
            return
        }

        // 获取 provider
        const provider = this.getProvider()
        if (!provider) {
            new Notice(t('No AI provider configured for Tab completion'))
            return
        }

        // 取消之前的请求
        this.cancelCurrentRequest()

        // 生成请求 ID
        const requestId = `req_${++this.requestCounter}_${Date.now()}`

        try {
            // 构建上下文
            const context = buildEditorContext(view.state, {
                maxCharsBefore: this.settings.contextLengthBefore,
                maxCharsAfter: this.settings.contextLengthAfter
            })

            // 设置加载状态（记录触发位置，后续仅在该位置编辑才中断）
            view.dispatch({
                effects: setLoadingEffect.of({ isLoading: true, requestId, pos: context.cursorPos })
            })

            // 发送 AI 请求
            const suggestion = await this.requestAISuggestion(context, provider, requestId)

            if (suggestion && suggestion.trim().length > 0) {
                // 设置建议
                view.dispatch({
                    effects: setSuggestionEffect.of({
                        text: suggestion,
                        pos: context.cursorPos,
                        requestId
                    })
                })
            } else {
                // 清除加载状态
                view.dispatch({
                    effects: clearSuggestionEffect.of(undefined)
                })
            }
        } catch (error: any) {
            DebugLogger.error('[TabCompletion] AI 请求失败', error)
            
            // 清除状态
            view.dispatch({
                effects: clearSuggestionEffect.of(undefined)
            })

            // 显示错误提示
            if (error.name !== 'AbortError') {
                const errorMessage = error.message || t('Failed to generate suggestion')
                new Notice(`AI 补全失败: ${errorMessage}`, 3000)
            }
        }
    }

    /**
     * 发送 AI 请求获取建议
     */
    private async requestAISuggestion(
        context: EditorContext,
        provider: ProviderSettings,
        requestId: string
    ): Promise<string> {
        // 获取 vendor
        const vendor = availableVendors.find(v => v.name === provider.vendor)
        if (!vendor) {
            throw new Error(`Unknown vendor: ${provider.vendor}`)
        }

        // 创建 AbortController
        this.currentController = new AbortController()
        const controller = this.currentController

        // 设置超时
        const timeoutId = setTimeout(() => {
            controller.abort()
        }, this.settings.timeout)

        try {
            // 获取当前应该使用的最大句子数
            const maxSentences = this.getMaxSentences()
            
            // 构建消息
            const messages = this.buildMessages(context, maxSentences)
			DebugLogger.logLlmMessages('TabCompletionService.requestAISuggestion', messages, { level: 'debug' })

            // 获取发送函数
            const sendRequest = vendor.sendRequestFunc(provider.options)

            // 收集响应
            let rawSuggestion = ''
            
            // 创建空的 resolveEmbed 函数（Tab 补全不需要处理嵌入内容）
            const resolveEmbed = async () => new ArrayBuffer(0)

            for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
                rawSuggestion += chunk
                
                // 如果请求已被取消，停止处理
                if (controller.signal.aborted) {
                    break
                }
            }

            // 后处理：智能处理换行、格式等
            let processedSuggestion = postProcessSuggestion(rawSuggestion.trim(), context)
			DebugLogger.logLlmResponsePreview('TabCompletionService.requestAISuggestion', processedSuggestion, { level: 'debug', previewChars: 100 })

            // 长度限制（代码逻辑控制，不依赖 AI）
            processedSuggestion = limitSuggestionLength(processedSuggestion, maxSentences)

            DebugLogger.debug('[TabCompletion] 建议生成完成', {
                rawLength: rawSuggestion.length,
                processedLength: processedSuggestion.length,
                maxSentences,
                needsLeadingNewline: context.needsLeadingNewline,
                contextType: context.contextType,
                isMarkdown: context.isMarkdownFormatted
            })

            return processedSuggestion
        } finally {
            clearTimeout(timeoutId)
            if (this.currentController === controller) {
                this.currentController = null
            }
        }
    }

    /**
     * 构建发送给 AI 的消息
     */
    private buildMessages(context: EditorContext, maxSentences: number): Message[] {
        const formatHint = generateContextPrompt(context)
        const lengthHint = maxSentences === 1 
            ? '续写一句话' 
            : `续写${maxSentences}句话左右`

        // 系统提示 - 简洁明了
        const systemPrompt = `你是写作助手。根据上下文续写内容。

规则：
1. 直接输出续写内容，不要解释
2. ${lengthHint}
3. 不要重复已有内容
4. ${formatHint}`

        // 用户消息：提供上下文
        let userPrompt = context.textBefore
        
        if (context.textAfter && context.textAfter.trim()) {
            userPrompt += `\n[...后续内容省略...]`
        }

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }

    /**
     * 确认并插入建议
     */
    confirm(view: EditorView, text: string, pos: number): void {
        // 记录这次补全（用于连续使用检测）
        this.recordCompletion()

        // 插入文本
        view.dispatch({
            changes: { from: pos, insert: text },
            selection: { anchor: pos + text.length }
        })

        DebugLogger.debug('[TabCompletion] 建议已插入', { 
            textLength: text.length,
            isContinuous: this.isContinuousUsage()
        })
    }

    /**
     * 取消当前请求
     */
    cancel(): void {
        this.cancelCurrentRequest()
    }

    /**
     * 取消当前正在进行的请求
     */
    private cancelCurrentRequest(): void {
        if (this.currentController) {
            this.currentController.abort()
            this.currentController = null
        }
    }

    /**
     * 销毁服务
     */
    dispose(): void {
        this.cancelCurrentRequest()
    }
}
