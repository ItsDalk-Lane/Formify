import { MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import FormPlugin from 'src/main';
import type { ProviderSettings } from 'src/features/tars/providers';
import { availableVendors, TarsSettings } from 'src/features/tars/settings';
import { MessageService } from './MessageService';
import { HistoryService, ChatHistoryEntry } from './HistoryService';
import { FileContentService } from './FileContentService';
import type { ChatMessage, ChatSession, ChatSettings, ChatState, SelectedFile, SelectedFolder } from '../types/chat';
import { DEFAULT_CHAT_SETTINGS } from '../types/chat';
import type { Message as ProviderMessage, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { v4 as uuidv4 } from 'uuid';

type ChatSubscriber = (state: ChatState) => void;

export class ChatService {
	private settings: ChatSettings = DEFAULT_CHAT_SETTINGS;
	private readonly messageService: MessageService;
	private readonly historyService: HistoryService;
	private readonly fileContentService: FileContentService;
	private state: ChatState = {
		activeSession: null,
		isGenerating: false,
		inputValue: '',
		selectedModelId: null,
		contextNotes: [],
		selectedImages: [],
		selectedFiles: [],
		selectedFolders: []
	};
	private subscribers: Set<ChatSubscriber> = new Set();
	private controller: AbortController | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.fileContentService = new FileContentService(plugin.app);
		this.messageService = new MessageService(plugin.app, this.fileContentService);
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
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.state.inputValue = '';
		this.emitState();
		
		// 不再立即保存新会话，等待用户发送第一条消息时再创建文件
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

	// 文件和文件夹管理方法
	addSelectedFile(file: TFile) {
		const selectedFile: SelectedFile = {
			id: file.path,
			name: file.name,
			path: file.path,
			extension: file.extension || '',
			type: 'file'
		};

		// 避免重复添加
		const existingIndex = this.state.selectedFiles.findIndex(f => f.id === selectedFile.id);
		if (existingIndex === -1) {
			this.state.selectedFiles = [...this.state.selectedFiles, selectedFile];
		}

		this.emitState();
	}

	addSelectedFolder(folder: TFolder) {
		const selectedFolder: SelectedFolder = {
			id: folder.path,
			name: folder.name,
			path: folder.path,
			type: 'folder'
		};

		// 避免重复添加
		const existingIndex = this.state.selectedFolders.findIndex(f => f.id === selectedFolder.id);
		if (existingIndex === -1) {
			this.state.selectedFolders = [...this.state.selectedFolders, selectedFolder];
		}

		this.emitState();
	}

	removeSelectedFile(fileId: string) {
		this.state.selectedFiles = this.state.selectedFiles.filter((file) => file.id !== fileId);
		this.emitState();
	}

	removeSelectedFolder(folderId: string) {
		this.state.selectedFolders = this.state.selectedFolders.filter((folder) => folder.id !== folderId);
		this.emitState();
	}

	setSelectedFiles(files: SelectedFile[]) {
		this.state.selectedFiles = files;
		this.emitState();
	}

	setSelectedFolders(folders: SelectedFolder[]) {
		this.state.selectedFolders = folders;
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
		if (!trimmed && this.state.selectedImages.length === 0 &&
			this.state.selectedFiles.length === 0 && this.state.selectedFolders.length === 0) {
			return;
		}

		const session = this.state.activeSession ?? this.createNewSession();

		// 保存文件和文件夹到会话中
		session.selectedFiles = [...this.state.selectedFiles];
		session.selectedFolders = [...this.state.selectedFolders];

		const userMessage = this.messageService.createMessage('user', trimmed, {
			images: this.state.selectedImages
		});
		session.messages.push(userMessage);
		session.updatedAt = Date.now();

		// 清空选中状态
		this.state.inputValue = '';
		this.state.selectedImages = [];
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.emitState();

		// 如果这是第一条消息，创建历史文件并包含第一条用户消息
		if (session.messages.length === 1) {
			try {
				session.filePath = await this.historyService.createNewSessionFileWithFirstMessage(session, userMessage);
			} catch (error) {
				console.error('[ChatService] 创建会话文件失败:', error);
				new Notice('创建会话文件失败，但消息已发送');
			}
		} else {
			// 如果不是第一条消息，追加到现有文件
			try {
				await this.historyService.appendMessageToFile(session.filePath, userMessage);
			} catch (error) {
				console.error('[ChatService] 追加用户消息失败:', error);
				// 不显示错误通知，避免干扰用户
			}
		}

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
			// 设置文件路径，以便后续追加消息
			session.filePath = filePath;
			this.state.activeSession = session;
			this.state.contextNotes = session.contextNotes ?? [];
			this.state.selectedImages = session.selectedImages ?? [];
			this.state.selectedFiles = session.selectedFiles ?? [];
			this.state.selectedFolders = session.selectedFolders ?? [];
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

	async editMessage(messageId: string, content: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const message = session.messages.find((msg) => msg.id === messageId);
		if (!message || message.role !== 'user') return;
		message.content = content.trim();
		message.timestamp = Date.now();
		session.updatedAt = Date.now();
		this.emitState();
		
		// 使用rewriteMessagesOnly更新文件，而不是重写整个文件
		if (session.filePath) {
			try {
				await this.historyService.rewriteMessagesOnly(session.filePath, session.messages);
			} catch (error) {
				console.error('[ChatService] 更新消息编辑失败:', error);
				new Notice('更新文件失败，但消息已从界面更新');
			}
		}
	}

	async editAndRegenerate(messageId: string, content: string) {
		const session = this.state.activeSession;
		if (!session || this.state.isGenerating) return;

		// 找到要编辑的消息
		const messageIndex = session.messages.findIndex((msg) => msg.id === messageId);
		if (messageIndex === -1) return;

		const message = session.messages[messageIndex];
		if (!message || message.role !== 'user') return;

		// 更新消息内容
		message.content = content.trim();
		message.timestamp = Date.now();

		// 删除这条消息之后的所有消息（包括AI回复）
		session.messages = session.messages.slice(0, messageIndex + 1);
		session.updatedAt = Date.now();
		this.emitState();

		// 使用rewriteMessagesOnly更新文件，而不是重写整个文件
		if (session.filePath) {
			try {
				await this.historyService.rewriteMessagesOnly(session.filePath, session.messages);
			} catch (error) {
				console.error('[ChatService] 更新消息编辑失败:', error);
				// 不显示通知，避免干扰用户重新生成流程
			}
		}

		// 重新生成AI回复
		await this.generateAssistantResponse(session);
	}

	async deleteMessage(messageId: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const index = session.messages.findIndex((msg) => msg.id === messageId);
		if (index === -1) return;
		
		// 从内存中删除消息
		const deletedMessage = session.messages[index];
		session.messages.splice(index, 1);
		session.updatedAt = Date.now();
		this.emitState();
		
		// 对于删除操作，我们需要重写整个文件，因为无法简单地"追加删除"
		// 但我们可以优化为只重写消息部分，保留frontmatter
		if (session.filePath) {
			try {
				await this.historyService.rewriteMessagesOnly(session.filePath, session.messages);
			} catch (error) {
				console.error('[ChatService] 更新消息删除失败:', error);
				new Notice('更新文件失败，但消息已从界面删除');
			}
		}
	}

	insertMessageToEditor(messageId: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const message = session.messages.find((msg) => msg.id === messageId);
		if (!message) return;

		// 获取所有打开的markdown叶子
		const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');

		// 优先尝试获取当前活动的markdown视图
		const activeMarkdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

		// 如果有活动的markdown视图，直接插入到当前文件
		if (activeMarkdownView?.editor) {
			const editor = activeMarkdownView.editor;
			editor.replaceSelection(message.content);
			new Notice('内容已插入当前编辑器');
			return;
		}

		// 如果没有活动的markdown视图，但存在打开的markdown叶子
		if (markdownLeaves.length > 0) {
			// 尝试获取最近使用的markdown叶子
			let targetLeaf = markdownLeaves.find(leaf => leaf === this.plugin.app.workspace.activeLeaf);

			// 如果当前活动叶子不是markdown，取第一个markdown叶子
			if (!targetLeaf) {
				targetLeaf = markdownLeaves[0];
			}

			if (targetLeaf) {
				const targetView = targetLeaf.view as MarkdownView;
				if (targetView.editor) {
					const editor = targetView.editor;
					editor.replaceSelection(message.content);
					const fileName = targetView.file?.basename || '未知文件';
					new Notice(`内容已插入到文件: ${fileName}`);
					return;
				}
			}
		}

		// 如果没有任何打开的markdown文件，提示用户需要先打开一个markdown文件
		new Notice('当前没有打开的markdown文件，请先打开一个markdown文件后再尝试插入内容');
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
		
		// 使用rewriteMessagesOnly更新文件，而不是重写整个文件
		if (session.filePath) {
			try {
				await this.historyService.rewriteMessagesOnly(session.filePath, session.messages);
			} catch (error) {
				console.error('[ChatService] 更新消息删除失败:', error);
				// 不显示通知，避免干扰用户重新生成流程
			}
		}
		
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

	/**
	 * 将base64字符串转换为ArrayBuffer
	 * @param base64Data base64字符串（包含或不包含data URL前缀）
	 * @returns ArrayBuffer
	 */
	private base64ToArrayBuffer(base64Data: string): ArrayBuffer {
		// 移除data URL前缀，如果存在
		const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

		// 解码base64字符串
		const binaryString = window.atob(base64);
		const bytes = new Uint8Array(binaryString.length);

		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}

		return bytes.buffer;
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
			const messages = await this.buildProviderMessages(session);
			const assistantMessage = this.messageService.createMessage('assistant', '');
			session.messages.push(assistantMessage);
			session.updatedAt = Date.now();
			this.state.isGenerating = true;
			this.state.error = undefined;
			this.emitState();

			this.controller = new AbortController();
			const resolveEmbed: ResolveEmbedAsBinary = async (embed) => {
				// 检查是否是我们的虚拟EmbedCache对象
				if (embed && (embed as any)[Symbol.for('originalBase64')]) {
					const base64Data = (embed as any)[Symbol.for('originalBase64')] as string;
					return this.base64ToArrayBuffer(base64Data);
				}
				// 对于其他情况，返回空缓冲区
				return new ArrayBuffer(0);
			};

			// 创建一个临时消息对象用于流式更新
			let accumulatedContent = '';
			
			for await (const chunk of sendRequest(messages, this.controller, resolveEmbed)) {
				assistantMessage.content += chunk;
				accumulatedContent += chunk;
				session.updatedAt = Date.now();
				this.emitState();
			}

			this.state.isGenerating = false;
			this.controller = null;
			session.updatedAt = Date.now();
			this.emitState();

			// 追加AI回复到文件，而不是重写整个文件
			if (session.filePath) {
				try {
					await this.historyService.appendMessageToFile(session.filePath, assistantMessage);
				} catch (error) {
					console.error('[ChatService] 追加AI回复失败:', error);
					// 不显示错误通知，避免干扰用户
				}
			} else {
				// 如果没有文件路径（不应该发生），回退到完整保存
				console.warn('[ChatService] 会话没有文件路径，回退到完整保存');
				try {
					await this.saveActiveSession();
				} catch (error) {
					console.error('[ChatService] 保存AI回复失败:', error);
				}
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

	private async buildProviderMessages(session: ChatSession): Promise<ProviderMessage[]> {
		const contextNotes = [...(session.contextNotes ?? []), ...this.state.contextNotes];
		const selectedFiles = session.selectedFiles ?? [];
		const selectedFolders = session.selectedFolders ?? [];
		
		// 文件内容读取选项
		const fileContentOptions = {
			maxFileSize: 1024 * 1024, // 1MB
			maxContentLength: 10000, // 10000个字符
			includeExtensions: [], // 包含所有文件
			excludeExtensions: ['exe', 'dll', 'bin', 'zip', 'rar', 'tar', 'gz'], // 排除二进制文件
			excludePatterns: [
				/node_modules/,
				/\.git/,
				/\.DS_Store/,
				/Thumbs\.db/
			]
		};
		
		return await this.messageService.toProviderMessages(session.messages, {
			contextNotes,
			selectedFiles,
			selectedFolders,
			fileContentOptions
		});
	}

	getProviders(): ProviderSettings[] {
		return [...this.plugin.settings.tars.settings.providers];
	}
}

