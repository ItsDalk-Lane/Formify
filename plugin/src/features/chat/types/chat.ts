import { App, TFile, TFolder } from 'obsidian';
import type { ToolCall, ToolExecution } from './tools';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 文件角色类型
 * - processing_target: 需要处理的数据（如待分析的文章）
 * - reference: 参考资料（如背景知识文档）
 * - example: 示例（如格式模板）
 * - context: 上下文背景（如项目说明）
 */
export type FileRole = 
  | 'processing_target'
  | 'reference'
  | 'example'
  | 'context';

/**
 * 文件意图分析结果
 */
export interface FileIntentAnalysis {
  /** 推断的文件角色 */
  role: FileRole;
  /** 推断理由（用于调试） */
  reasoning: string;
  /** 置信度 */
  confidence: 'high' | 'medium' | 'low';
}

export interface SelectedFile {
	id: string;
	name: string;
	path: string;
	extension: string;
	type: 'file';
	isAutoAdded?: boolean; // 标记是否为自动添加的活跃文件
}

export interface SelectedFolder {
	id: string;
	name: string;
	path: string;
	type: 'folder';
}

export type SelectedItem = SelectedFile | SelectedFolder;

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: number;
	images?: string[];
	isError?: boolean;
	metadata?: Record<string, unknown>;
	toolCalls?: ToolCall[];
	/**
	 * 工具调用 ID（仅用于 tool 角色消息）
	 * 用于关联工具结果与对应的工具调用
	 */
	toolCallId?: string;
}

export interface ChatSession {
	id: string;
	title: string;
	modelId: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
	contextNotes?: string[];
	selectedImages?: string[];
	selectedFiles?: SelectedFile[];
	selectedFolders?: SelectedFolder[];
	filePath?: string; // 添加文件路径字段，用于跟踪会话文件
	systemPrompt?: string; // 添加系统提示词字段，用于内部存储
	enableTemplateAsSystemPrompt?: boolean; // 会话级模板系统提示词开关
}

export type ChatOpenMode = 'sidebar' | 'left-sidebar' | 'tab' | 'window' | 'persistent-modal';

/**
 * 快捷操作提示词来源类型
 */
export type QuickActionPromptSource = 'custom' | 'template';

/**
 * 快捷操作类型
 * - normal: 普通操作（调用 AI 大模型处理提示词）
 * - group: 操作组（用于组织其他操作）
 * - form: 表单操作（引用并执行 .cform 表单）
 */
export type QuickActionType = 'normal' | 'group' | 'form';

/**
 * AI 快捷操作接口
 * 用于定义划词工具栏中的自定义操作
 */
export interface QuickAction {
	id: string;                // 操作唯一标识符
	name: string;              // 操作名称
	prompt: string;            // 提示词内容（可能包含模板引用和占位符）
	promptSource: QuickActionPromptSource; // 提示词来源类型：自定义或内置模板
	templateFile?: string;     // 当 promptSource 为 'template' 时，使用的模板文件路径
	modelTag?: string;         // 指定使用的 AI 模型标签，留空则使用默认模型
	/**
	 * 操作类型标识
	 * - 'normal': 普通操作
	 * - 'group': 操作组
	 * - 'form': 表单操作
	 * @default 'normal'（未设置时默认为普通操作，保持向下兼容）
	 */
	actionType?: QuickActionType;
	/**
	 * 是否为操作组（操作组本身不执行提示词，仅用于组织子操作）
	 * @deprecated 请使用 actionType === 'group' 替代，此字段保留用于向下兼容
	 * @default false
	 */
	isActionGroup?: boolean;
	/**
	 * 子操作 ID 列表（可包含普通操作或嵌套操作组）
	 * @default []
	 */
	children?: string[];
	/**
	 * 表单操作引用的表单 commandId 数组
	 * 仅当 actionType === 'form' 时有效
	 */
	formCommandIds?: string[];
	showInToolbar: boolean;    // 是否在工具栏显示
	order: number;             // 排序顺序
	createdAt: number;         // 创建时间戳
	updatedAt: number;         // 更新时间戳
	/**
	 * 是否使用默认系统提示词（默认 true 保持向下兼容）
	 * - true: 使用全局系统提示词 + 解析后的提示词作为用户消息
	 * - false: 使用自定义配置（由 customPromptRole 控制）
	 * @default true
	 */
	useDefaultSystemPrompt?: boolean;
	/**
	 * 自定义提示词的角色（仅当 useDefaultSystemPrompt 为 false 时生效）
	 * - 'system': 提示词作为系统消息（占位符会被替换为 <用户消息内容> 指示）
	 * - 'user': 提示词作为用户消息（占位符会被替换为实际选中文本）
	 * @default 'system'
	 */
	customPromptRole?: 'system' | 'user';
}

export interface ChatSettings {
	defaultModel: string;
	autosaveChat: boolean;
	showSidebarByDefault: boolean;
	openMode: ChatOpenMode;
	enableSystemPrompt: boolean; // 是否启用系统提示词功能
	// 内链解析配置（已迁移到 Tars 设置中的 internalLinkParsing）
	/** @deprecated 已迁移到 Tars 设置中的 internalLinkParsing.enabled */
	enableInternalLinkParsing?: boolean;
	/** @deprecated 已迁移到 Tars 设置中的 internalLinkParsing.parseInTemplates */
	parseLinksInTemplates?: boolean;
	/** @deprecated 已迁移到 Tars 设置中的 internalLinkParsing.maxDepth */
	maxLinkParseDepth?: number;
	/** @deprecated 已迁移到 Tars 设置中的 internalLinkParsing.timeout */
	linkParseTimeout?: number;
	// 自动添加活跃文件配置
	autoAddActiveFile: boolean; // 是否自动将当前活跃的Markdown文件添加为上下文
	// 功能区图标配置
	showRibbonIcon: boolean; // 是否在功能区显示AI Chat图标
	// 编辑器触发配置
	enableChatTrigger: boolean; // 是否启用编辑器触发功能
	chatTriggerSymbol: string[]; // 触发符号数组，默认 ["@"]
	chatModalWidth: number; // 模态框宽度
	chatModalHeight: number; // 模态框高度
	// 快捷操作配置
	enableQuickActions: boolean; // 是否启用快捷操作
	maxQuickActionButtons: number; // 工具栏最多显示的按钮数量
	quickActionsStreamOutput: boolean; // 快捷操作是否使用流式输出
	quickActions?: QuickAction[]; // 操作列表（持久化存储于 data.json.chat.quickActions）
}

/**
 * 会话级 MCP 工具调用模式
 * - disabled: 禁用，不向 AI 请求附加任何 MCP 工具
 * - auto: 自动，附加所有已连接且运行中的 MCP 服务器工具
 * - manual: 手动，仅附加用户选中的 MCP 服务器工具
 */
export type McpToolMode = 'disabled' | 'auto' | 'manual';

export interface ChatState {
	activeSession: ChatSession | null;
	isGenerating: boolean;
	inputValue: string;
	selectedModelId: string | null;
	enableReasoningToggle: boolean;
	enableWebSearchToggle: boolean;
	enableTemplateAsSystemPrompt: boolean;
	contextNotes: string[];
	selectedImages: string[];
	selectedFiles: SelectedFile[];
	selectedFolders: SelectedFolder[];
	selectedText?: string; // 划词选中的文本内容
	error?: string;
	// 添加模板选择相关状态
	selectedPromptTemplate?: {
		path: string;
		name: string;
		content: string;
	};
	showTemplateSelector: boolean;
	// 是否应该保存历史记录（用于模态框模式，模态框中的对话不需要保存历史）
	shouldSaveHistory: boolean;

	// 工具相关状态
	pendingToolExecutions: ToolExecution[];
	toolExecutions?: ToolExecution[];

	// MCP 会话级控制（运行时状态，不持久化）
	/** 当前会话的 MCP 工具调用模式，默认 'auto' */
	mcpToolMode: McpToolMode;
	/** 手动模式下用户选中的 MCP 服务器 ID 数组 */
	mcpSelectedServerIds: string[];
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	defaultModel: '',
	autosaveChat: true,
	showSidebarByDefault: true,
	openMode: 'sidebar',
	enableSystemPrompt: true, // 默认启用系统提示词功能
	// 内链解析默认配置
	enableInternalLinkParsing: true, // 默认启用内链解析
	parseLinksInTemplates: true, // 默认解析模板中的内链
	maxLinkParseDepth: 5, // 默认最大深度5层
	linkParseTimeout: 5000, // 默认超时5秒
	// 自动添加活跃文件默认配置
	autoAddActiveFile: true, // 默认启用自动添加活跃文件
	// 功能区图标默认配置
	showRibbonIcon: true, // 默认显示功能区图标
	// 编辑器触发默认配置
	enableChatTrigger: true, // 默认启用编辑器触发
	chatTriggerSymbol: ['@'], // 默认触发符号 ["@"]
	chatModalWidth: 700, // 默认模态框宽度
	chatModalHeight: 500, // 默认模态框高度
	// 快捷操作默认配置
	enableQuickActions: true, // 默认启用快捷操作
	maxQuickActionButtons: 4, // 默认显示4个按钮
	quickActionsStreamOutput: true, // 默认启用流式输出
	quickActions: [], // 默认无操作（持久化存储于 data.json.chat.quickActions）
};
