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
}

export type ChatOpenMode = 'sidebar' | 'tab' | 'window';

export interface ChatSettings {
	chatFolder: string;
	defaultModel: string;
	autosaveChat: boolean;
	showSidebarByDefault: boolean;
	openMode: ChatOpenMode;
	enableSystemPrompt: boolean; // 是否启用系统提示词功能
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
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	chatFolder: 'AI Chats',
	defaultModel: '',
	autosaveChat: true,
	showSidebarByDefault: true,
	openMode: 'sidebar',
	enableSystemPrompt: true, // 默认启用系统提示词功能
};

