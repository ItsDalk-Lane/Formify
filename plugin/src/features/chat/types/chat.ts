export type ChatRole = 'user' | 'assistant' | 'system';

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
}

export type ChatOpenMode = 'sidebar' | 'tab' | 'window';

export interface ChatSettings {
	chatFolder: string;
	defaultModel: string;
	autosaveChat: boolean;
	showSidebarByDefault: boolean;
	openMode: ChatOpenMode;
}

export interface ChatState {
	activeSession: ChatSession | null;
	isGenerating: boolean;
	inputValue: string;
	selectedModelId: string | null;
	contextNotes: string[];
	selectedImages: string[];
	error?: string;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	chatFolder: 'AI Chats',
	defaultModel: '',
	autosaveChat: true,
	showSidebarByDefault: true,
	openMode: 'sidebar',
};

