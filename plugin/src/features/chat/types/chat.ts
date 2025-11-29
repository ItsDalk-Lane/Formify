import { App, TFile, TFolder } from 'obsidian';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface SelectedFile {
	id: string;
	name: string;
	path: string;
	extension: string;
	type: 'file';
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

export type ChatOpenMode = 'sidebar' | 'tab' | 'window';

export interface ChatSettings {
	chatFolder: string;
	defaultModel: string;
	autosaveChat: boolean;
	showSidebarByDefault: boolean;
	openMode: ChatOpenMode;
	enableSystemPrompt: boolean; // 是否启用系统提示词功能
	// 内链解析配置
	enableInternalLinkParsing: boolean; // 是否启用内链解析功能
	parseLinksInTemplates: boolean; // 是否解析提示词模板中的内链
	maxLinkParseDepth: number; // 内链嵌套解析的最大深度
	linkParseTimeout: number; // 单个链接解析超时时间(毫秒)
}

export interface ChatState {
	activeSession: ChatSession | null;
	isGenerating: boolean;
	inputValue: string;
	selectedModelId: string | null;
	contextNotes: string[];
	selectedImages: string[];
	selectedFiles: SelectedFile[];
	selectedFolders: SelectedFolder[];
	error?: string;
	// 添加模板选择相关状态
	selectedPromptTemplate?: {
		path: string;
		name: string;
		content: string;
	};
	showTemplateSelector: boolean;
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
};

