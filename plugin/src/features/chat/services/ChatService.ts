import { MarkdownView, Notice } from 'obsidian';
import FormPlugin from 'src/main';
import type { ProviderSettings } from 'src/features/tars/providers';
import { availableVendors, TarsSettings } from 'src/features/tars/settings';
import { MessageService } from './MessageService';
import { HistoryService, ChatHistoryEntry } from './HistoryService';
import type { ChatMessage, ChatSession, ChatSettings, ChatState } from '../types/chat';
import { DEFAULT_CHAT_SETTINGS } from '../types/chat';
import type { Message as ProviderMessage, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { v4 as uuidv4 } from 'uuid';

type ChatSubscriber = (state: ChatState) => void;

export class ChatService {
	private settings: ChatSettings = DEFAULT_CHAT_SETTINGS;
	private readonly messageService: MessageService;
	private readonly historyService: HistoryService;
	private state: ChatState = {
		activeSession: null,
		isGenerating: false,
		inputValue: '',
		selectedModelId: null,
		contextNotes: [],
		selectedImages: []
	};
	private subscribers: Set<ChatSubscriber> = new Set();
	private controller: AbortController | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.messageService = new MessageService();
		this.historyService = new HistoryService(plugin.app, DEFAULT_CHAT_SETTINGS.chatFolder);
	}

	initialize(initialSettings?: Partial<ChatSettings>) {
		this.updateSettings(initialSettings ?? {});
		if (!this.state.selectedModelId) {
			this.state.selectedModelId = this.getDefaultProviderTag();
		}
		if (!this.state.activeSession) {
			this.createNewSession();
		}
		this.emitState();
	}

	getState(): ChatState {
		return JSON.parse(JSON.stringify(this.state));
	}

	subscribe(callback: ChatSubscriber): () => void {
		this.subscribers.add(callback);
		callback(this.getState());
		return () => {
			this.subscribers.delete(callback);
		};
	}

	createNewSession(initialTitle = '新的聊天'): ChatSession {
		const now = Date.now();
		const session: ChatSession = {
			id: `chat-${uuidv4()}`,
			title: initialTitle,
			modelId: this.state.selectedModelId ?? this.getDefaultProviderTag() ?? '',
			messages: [],
			createdAt: now,
			updatedAt: now,
			contextNotes: [],
			selectedImages: []
		};
		this.state.activeSession = session;
		this.state.contextNotes = [];
		this.state.selectedImages = [];
		this.state.inputValue = '';
		this.emitState();
		return session;
	}

	setInputValue(value: string) {
		this.state.inputValue = value;
		this.emitState();
	}

	addContextNote(note: string) {
		if (!note.trim()) return;
		const normalized = note.trim();
		this.state.contextNotes = Array.from(new Set([...this.state.contextNotes, normalized]));
		if (this.state.activeSession) {
			const sessionNotes = new Set(this.state.activeSession.contextNotes ?? []);
			sessionNotes.add(normalized);
			this.state.activeSession.contextNotes = Array.from(sessionNotes);
		}
		this.emitState();
	}

	removeContextNote(note: string) {
		this.state.contextNotes = this.state.contextNotes.filter((ctx) => ctx !== note);
		if (this.state.activeSession?.contextNotes) {
			this.state.activeSession.contextNotes = this.state.activeSession.contextNotes.filter((ctx) => ctx !== note);
		}
		this.emitState();
	}

	setSelectedImages(images: string[]) {
		this.state.selectedImages = images;
		this.emitState();
	}

	removeSelectedImage(image: string) {
		this.state.selectedImages = this.state.selectedImages.filter((img) => img !== image);
		this.emitState();
	}

	setModel(tag: string) {
		this.state.selectedModelId = tag;
		if (this.state.activeSession) {
			this.state.activeSession.modelId = tag;
		}
		this.emitState();
	}

	async sendMessage(content?: string) {
		if (this.state.isGenerating) {
			new Notice('当前已有请求在进行中，请稍候...');
			return;
		}

		const trimmed = (content ?? this.state.inputValue).trim();
		if (!trimmed && this.state.selectedImages.length === 0) {
			return;
		}

		const session = this.state.activeSession ?? this.createNewSession();
		const userMessage = this.messageService.createMessage('user', trimmed, {
			images: this.state.selectedImages
		});
		session.messages.push(userMessage);
		session.updatedAt = Date.now();
		this.state.inputValue = '';
		this.state.selectedImages = [];
		this.emitState();

		await this.generateAssistantResponse(session);
	}

	stopGeneration() {
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
			this.state.isGenerating = false;
			this.emitState();
		}
	}

	async listHistory(): Promise<ChatHistoryEntry[]> {
		return this.historyService.listSessions();
	}

	async loadHistory(filePath: string) {
		const session = await this.historyService.loadSession(filePath);
		if (session) {
			this.state.activeSession = session;
			this.state.contextNotes = session.contextNotes ?? [];
			this.state.selectedImages = session.selectedImages ?? [];
			this.state.selectedModelId = session.modelId || this.getDefaultProviderTag();
			this.emitState();
		}
	}

	async saveActiveSession() {
		if (!this.state.activeSession) return;
		await this.historyService.saveSession(this.state.activeSession);
		new Notice('聊天会话已保存');
	}

	async deleteHistory(filePath: string) {
		await this.historyService.deleteSession(filePath);
	}

	updateSettings(settings: Partial<ChatSettings>) {
		this.settings = { ...this.settings, ...settings };
		this.historyService.setFolder(this.settings.chatFolder);
		if (!this.state.selectedModelId) {
			this.state.selectedModelId = this.settings.defaultModel || this.getDefaultProviderTag();
		}
		this.emitState();
	}

	editMessage(messageId: string, content: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const message = session.messages.find((msg) => msg.id === messageId);
		if (!message || message.role !== 'user') return;
		message.content = content.trim();
		message.timestamp = Date.now();
		session.updatedAt = Date.now();
		this.emitState();
	}

	deleteMessage(messageId: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const index = session.messages.findIndex((msg) => msg.id === messageId);
		if (index === -1) return;
		session.messages.splice(index, 1);
		session.updatedAt = Date.now();
		this.emitState();
	}

	insertMessageToEditor(messageId: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const message = session.messages.find((msg) => msg.id === messageId);
		if (!message) return;
		const markdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.editor) {
			new Notice('当前没有可写入的编辑器');
			return;
		}
		const editor = markdownView.editor;
		editor.replaceSelection(message.content);
		markdownView.editor.focus();
		new Notice('内容已插入当前编辑器');
	}

	async regenerateFromMessage(messageId: string) {
		const session = this.state.activeSession;
		if (!session || this.state.isGenerating) return;
		const index = session.messages.findIndex((msg) => msg.id === messageId);
		if (index === -1) return;
		const target = session.messages[index];
		if (target.role !== 'assistant') {
			new Notice('只能对AI消息执行重新生成操作');
			return;
		}
		session.messages.splice(index, 1);
		session.updatedAt = Date.now();
		this.emitState();
		await this.generateAssistantResponse(session);
	}

	async refreshProviderSettings(tarsSettings: TarsSettings) {
		if (!tarsSettings.providers.length) {
			this.state.selectedModelId = null;
		} else if (!this.state.selectedModelId) {
			this.state.selectedModelId = tarsSettings.providers[0].tag;
		}
		this.emitState();
	}

	dispose() {
		this.subscribers.clear();
		this.controller?.abort();
		this.controller = null;
	}

	private emitState() {
		const snapshot = this.getState();
		this.subscribers.forEach((callback) => callback(snapshot));
	}

	private getDefaultProviderTag(): string | null {
		return this.plugin.settings.tars.settings.providers[0]?.tag ?? null;
	}

	private async generateAssistantResponse(session: ChatSession) {
		try {
			const provider = this.resolveProvider();
			if (!provider) {
				throw new Error('尚未配置任何AI模型，请先在Tars设置中添加Provider。');
			}
			const vendor = availableVendors.find((item) => item.name === provider.vendor);
			if (!vendor) {
				throw new Error(`无法找到供应商 ${provider.vendor}`);
			}
			const sendRequest = vendor.sendRequestFunc(provider.options);
			const messages = this.buildProviderMessages(session);
			const assistantMessage = this.messageService.createMessage('assistant', '');
			session.messages.push(assistantMessage);
			session.updatedAt = Date.now();
			this.state.isGenerating = true;
			this.state.error = undefined;
			this.emitState();

			this.controller = new AbortController();
			const resolveEmbed: ResolveEmbedAsBinary = async () => new ArrayBuffer(0);

			for await (const chunk of sendRequest(messages, this.controller, resolveEmbed)) {
				assistantMessage.content += chunk;
				session.updatedAt = Date.now();
				this.emitState();
			}

			this.state.isGenerating = false;
			this.controller = null;
			session.updatedAt = Date.now();
			this.emitState();

			if (this.settings.autosaveChat) {
				await this.saveActiveSession();
			}
		} catch (error) {
			console.error('[Chat][ChatService] generateAssistantResponse error', error);
			this.state.isGenerating = false;
			this.controller = null;
			this.state.error = error instanceof Error ? error.message : String(error);
			if (session.messages.length > 0) {
				const last = session.messages[session.messages.length - 1];
				if (last.role === 'assistant') {
					last.isError = true;
				}
			}
			this.emitState();
			new Notice(this.state.error ?? '生成失败，请稍后再试。');
		}
	}

	private resolveProvider(): ProviderSettings | null {
		const providers = this.plugin.settings.tars.settings.providers;
		if (!providers.length) return null;
		if (!this.state.selectedModelId) {
			return providers[0];
		}
		return providers.find((provider) => provider.tag === this.state.selectedModelId) ?? providers[0];
	}

	private buildProviderMessages(session: ChatSession): ProviderMessage[] {
		const contextNotes = [...(session.contextNotes ?? []), ...this.state.contextNotes];
		return this.messageService.toProviderMessages(session.messages, {
			contextNotes
		});
	}

	getProviders(): ProviderSettings[] {
		return [...this.plugin.settings.tars.settings.providers];
	}
}

