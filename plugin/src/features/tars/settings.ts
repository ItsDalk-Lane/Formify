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
import { poeVendor } from './providers/poe'
import { qianFanVendor } from './providers/qianFan'
import { qwenVendor } from './providers/qwen'
import { siliconFlowVendor } from './providers/siliconflow'
import { zhipuVendor } from './providers/zhipu'
import type { ToolDefinition } from 'src/features/chat/types/tools'
import type { SystemPromptsDataFile } from './system-prompts/types'
import { type McpSettings, DEFAULT_MCP_SETTINGS } from './mcp/types'

export const APP_FOLDER = 'Tars'

export interface EditorStatus {
	isTextInserting: boolean
}

export interface TarsSettings {
	editorStatus: EditorStatus
	providers: ProviderSettings[]
	/** 是否启用全局系统提示词（由系统提示词管理器提供） */
	enableGlobalSystemPrompts: boolean
	// 统一的内链解析配置
	internalLinkParsing: {
		/** 总开关：控制整个插件的内链解析功能 */
		enabled: boolean
		/** 嵌套内链的最大解析层数 */
		maxDepth: number
		/** 单个链接解析超时时间（毫秒） */
		timeout: number
		/** 是否解析提示词模板中的内链 */
		parseInTemplates: boolean
	}
	/** @deprecated 使用 internalLinkParsing.enabled 替代 */
	enableInternalLink?: boolean
	/** @deprecated 使用 internalLinkParsing.maxDepth 替代 */
	maxLinkParseDepth?: number
	/** @deprecated 使用 internalLinkParsing.timeout 替代 */
	linkParseTimeout?: number
	/** @deprecated 已废弃：旧版默认系统消息开关，仅用于向下兼容迁移 */
	enableDefaultSystemMsg?: boolean
	/** @deprecated 已废弃：旧版默认系统消息内容，仅用于向下兼容迁移 */
	defaultSystemMsg?: string
	/** 系统提示词持久化数据（存储于 data.json） */
	systemPromptsData?: SystemPromptsDataFile
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
	/** Tab 补全用户提示词模板（支持 {{rules}} 与 {{context}}） */
	tabCompletionPromptTemplate: string

	/** 全局工具配置（保留旧配置兼容） */
	tools?: {
		globalTools: ToolDefinition[]
		executionMode: 'manual' | 'auto'
		enabled: boolean
	}
	/** MCP 服务器配置 */
	mcp?: McpSettings
}

export const DEFAULT_TARS_SETTINGS: TarsSettings = {
	editorStatus: { isTextInserting: false },
	providers: [],
	enableGlobalSystemPrompts: false,
	// 统一的内链解析配置默认值
	internalLinkParsing: {
		enabled: true,
		maxDepth: 5,
		timeout: 5000,
		parseInTemplates: true,
	},
	// 保留旧字段的默认值以确保向下兼容
	enableInternalLink: true,
	maxLinkParseDepth: 5,
	linkParseTimeout: 5000,
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
	tabCompletionProviderTag: '', // 默认为空，使用第一个可用的 provider
	tabCompletionPromptTemplate: '{{rules}}\n\n{{context}}',
	tools: {
		globalTools: [],
		executionMode: 'manual',
		enabled: false
	},
	mcp: DEFAULT_MCP_SETTINGS,
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
	poeVendor,
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
