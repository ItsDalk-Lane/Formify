import { App, TFile, TFolder } from 'obsidian';
import type { ToolCall, ToolExecution } from './tools';

export type ChatRole = 'user' | 'assistant' | 'system';

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
}

export type ChatOpenMode = 'sidebar' | 'left-sidebar' | 'tab' | 'window' | 'persistent-modal';

/**
 * 技能提示词来源类型
 */
export type SkillPromptSource = 'custom' | 'template';

/**
 * 技能类型
 * - normal: 普通技能（调用 AI 大模型处理提示词）
 * - group: 技能组（用于组织其他技能）
 * - form: 表单技能（引用并执行 .cform 表单）
 */
export type SkillType = 'normal' | 'group' | 'form';

/**
 * AI 技能接口
 * 用于定义划词工具栏中的自定义技能
 */
export interface Skill {
	id: string;                // 技能唯一标识符
	name: string;              // 技能名称
	prompt: string;            // 提示词内容（可能包含模板引用和占位符）
	promptSource: SkillPromptSource; // 提示词来源类型：自定义或内置模板
	templateFile?: string;     // 当 promptSource 为 'template' 时，使用的模板文件路径
	modelTag?: string;         // 指定使用的 AI 模型标签，留空则使用默认模型
	/**
	 * 技能类型标识
	 * - 'normal': 普通技能
	 * - 'group': 技能组
	 * - 'form': 表单技能
	 * @default 'normal'（未设置时默认为普通技能，保持向下兼容）
	 */
	skillType?: SkillType;
	/**
	 * 是否为技能组（技能组本身不执行提示词，仅用于组织子技能）
	 * @deprecated 请使用 skillType === 'group' 替代，此字段保留用于向下兼容
	 * @default false
	 */
	isSkillGroup?: boolean;
	/**
	 * 子技能 ID 列表（可包含普通技能或嵌套技能组）
	 * @default []
	 */
	children?: string[];
	/**
	 * 表单技能引用的表单 commandId 数组
	 * 仅当 skillType === 'form' 时有效
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
	chatFolder: string;
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
	// 快捷技能配置
	enableSelectionToolbar: boolean; // 是否启用快捷技能
	maxToolbarButtons: number; // 工具栏最多显示的按钮数量
	selectionToolbarStreamOutput: boolean; // 快捷技能是否使用流式输出
	skills?: Skill[]; // 技能列表（已废弃，技能数据现在独立存储在 .obsidian/plugins/formify/skills.json 中）
}

export interface ChatState {
	activeSession: ChatSession | null;
	isGenerating: boolean;
	inputValue: string;
	selectedModelId: string | null;
	enableReasoningToggle: boolean;
	enableWebSearchToggle: boolean;
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
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	chatFolder: 'AI Chats',
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
	// 快捷技能默认配置
	enableSelectionToolbar: true, // 默认启用快捷技能
	maxToolbarButtons: 4, // 默认显示4个按钮
	selectionToolbarStreamOutput: true, // 默认启用流式输出
	skills: [], // 默认无技能（已废弃，仅用于向后兼容和数据迁移）
};

