import { ProviderSettings, Vendor } from './providers'
import { azureVendor } from './providers/azure'
import { claudeVendor } from './providers/claude'
import { deepSeekVendor } from './providers/deepSeek'
import { doubaoVendor } from './providers/doubao'
import { doubaoImageVendor } from './providers/doubaoImage'
import { geminiVendor } from './providers/gemini'
import { gptImageVendor } from './providers/gptImage'
import { grokVendor } from './providers/grok'
import { kimiVendor } from './providers/kimi'
import { ollamaVendor } from './providers/ollama'
import { openAIVendor } from './providers/openAI'
import { openRouterVendor } from './providers/openRouter'
import { qianFanVendor } from './providers/qianFan'
import { qwenVendor } from './providers/qwen'
import { siliconFlowVendor } from './providers/siliconflow'
import { zhipuVendor } from './providers/zhipu'

export const APP_FOLDER = 'Tars'

export interface EditorStatus {
	isTextInserting: boolean
}

export interface TarsSettings {
	editorStatus: EditorStatus
	providers: ProviderSettings[]
	systemTags: string[]
	newChatTags: string[]
	userTags: string[]
	roleEmojis: {
		assistant: string
		system: string
		newChat: string
		user: string
	}
	enableInternalLink: boolean // For user messages and system messages
	enableInternalLinkForAssistantMsg: boolean
	maxLinkParseDepth: number
	linkParseTimeout: number
	confirmRegenerate: boolean
	enableTagSuggest: boolean
	tagSuggestMaxLineLength: number
	answerDelayInMilliseconds: number
	enableExportToJSONL: boolean
	enableReplaceTag: boolean
	enableDefaultSystemMsg: boolean
	defaultSystemMsg: string
	enableStreamLog: boolean
	debugMode: boolean // 调试模式开关
	debugLevel: 'debug' | 'info' | 'warn' | 'error' // 调试日志级别
	enableLlmConsoleLog: boolean // 是否在控制台输出每次调用大模型的 messages/响应预览（独立开关）
	llmResponsePreviewChars: number // AI 返回内容预览字符数
	// Tab 补全功能设置
	enableTabCompletion: boolean // Tab 补全功能开关
	tabCompletionTriggerKey: string // 触发快捷键（默认 Alt）
	tabCompletionContextLengthBefore: number // 上下文长度（光标前）
	tabCompletionContextLengthAfter: number // 上下文长度（光标后）
	tabCompletionTimeout: number // 请求超时时间（毫秒）
	tabCompletionProviderTag: string // 使用的 AI provider 标签
}

export const DEFAULT_TARS_SETTINGS: TarsSettings = {
	editorStatus: { isTextInserting: false },
	providers: [],
	systemTags: ['System', '系统'],
	newChatTags: ['NewChat', '新对话'],
	userTags: ['User', '我'],
	roleEmojis: {
		assistant: '✨',
		system: '🔧',
		newChat: '🚀',
		user: '💬'
	},
	enableInternalLink: true,
	enableInternalLinkForAssistantMsg: false,
	maxLinkParseDepth: 5,
	linkParseTimeout: 5000,
	answerDelayInMilliseconds: 2000,
	confirmRegenerate: true,
	enableTagSuggest: true,
	tagSuggestMaxLineLength: 20,
	enableExportToJSONL: false,
	enableReplaceTag: false,
	enableDefaultSystemMsg: false,
	defaultSystemMsg: '',
	enableStreamLog: false,
	debugMode: false, // 默认关闭调试模式
	debugLevel: 'error', // 默认只输出错误日志
	enableLlmConsoleLog: false,
	llmResponsePreviewChars: 100,
	// Tab 补全功能默认设置
	enableTabCompletion: false, // 默认关闭
	tabCompletionTriggerKey: 'Alt', // 默认使用 Alt 键
	tabCompletionContextLengthBefore: 1000, // 默认获取光标前 1000 字符
	tabCompletionContextLengthAfter: 500, // 默认获取光标后 500 字符
	tabCompletionTimeout: 5000, // 默认 5 秒超时
	tabCompletionProviderTag: '' // 默认为空，使用第一个可用的 provider
}

export const availableVendors: Vendor[] = [
	openAIVendor,
	// The following are arranged in alphabetical order
	azureVendor,
	claudeVendor,
	deepSeekVendor,
	doubaoVendor,
	doubaoImageVendor,
	geminiVendor,
	gptImageVendor,
	grokVendor,
	kimiVendor,
	ollamaVendor,
	openRouterVendor,
	qianFanVendor,
	qwenVendor,
	siliconFlowVendor,
	zhipuVendor
]

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const cloneTarsSettings = (override?: Partial<TarsSettings>): TarsSettings => {
	const clonedDefaults = cloneDeep(DEFAULT_TARS_SETTINGS)
	if (!override) {
		return clonedDefaults
	}
	const clonedOverride = cloneDeep(override) as Record<string, unknown>
	delete clonedOverride.promptTemplates
	return Object.assign(clonedDefaults, clonedOverride)
}
