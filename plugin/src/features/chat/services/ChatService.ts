import { MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import FormPlugin from 'src/main';
import type { ProviderSettings, SaveAttachment } from 'src/features/tars/providers';
import type { Message as ProviderMessage, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { availableVendors, TarsSettings } from 'src/features/tars/settings';
import { isImageGenerationModel } from 'src/features/tars/providers/openRouter';
import { MessageService } from './MessageService';
import { HistoryService, ChatHistoryEntry } from './HistoryService';
import { FileContentService } from './FileContentService';
import type { ChatMessage, ChatSession, ChatSettings, ChatState, SelectedFile, SelectedFolder } from '../types/chat';
import { DEFAULT_CHAT_SETTINGS } from '../types/chat';
import { v4 as uuidv4 } from 'uuid';
import { InternalLinkParserService } from '../../../services/InternalLinkParserService';

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
		selectedFolders: [],
		showTemplateSelector: false
	};
	private subscribers: Set<ChatSubscriber> = new Set();
	private controller: AbortController | null = null;
	// 跟踪当前活动文件的路径
	private currentActiveFilePath: string | null = null;
	// 跟踪在当前活动文件会话期间，用户手动移除的文件路径（仅在当前文件活跃期间有效）
	private manuallyRemovedInCurrentSession: string | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.fileContentService = new FileContentService(plugin.app);
		this.messageService = new MessageService(plugin.app, this.fileContentService);
		this.historyService = new HistoryService(plugin.app, DEFAULT_CHAT_SETTINGS.chatFolder);
	}

	private get app() {
		return this.plugin.app;
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
		// 如果正在生成内容，先停止生成
		if (this.state.isGenerating) {
			this.stopGeneration();
		}
		
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
		this.state.selectedPromptTemplate = undefined;
		this.state.showTemplateSelector = false;
		// 注意：不清空手动移除记录，这是插件级别的持久化数据
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

	// 添加活跃文件（自动添加）
	addActiveFile(file: TFile | null) {
		if (!file || !this.settings.autoAddActiveFile) {
			return;
		}

		// 只自动添加Markdown文件
		if (file.extension !== 'md') {
			return;
		}

		// 检测到活动文件发生变化
		if (this.currentActiveFilePath !== file.path) {
			// 清除之前的手动移除标记（因为已经切换到新文件了）
			this.manuallyRemovedInCurrentSession = null;
			// 更新当前活动文件路径
			this.currentActiveFilePath = file.path;
		}

		// 如果用户在当前活动文件会话期间手动移除过这个文件，不再自动添加
		if (this.manuallyRemovedInCurrentSession === file.path) {
			return;
		}

		// 检查是否已经存在（避免重复添加）
		const existingIndex = this.state.selectedFiles.findIndex(f => f.id === file.path);
		if (existingIndex !== -1) {
			return;
		}

		// 先移除所有之前自动添加的活跃文件（单例模式）
		this.state.selectedFiles = this.state.selectedFiles.filter(f => !f.isAutoAdded);

		// 添加新的活跃文件
		const selectedFile: SelectedFile = {
			id: file.path,
			name: file.name,
			path: file.path,
			extension: file.extension || '',
			type: 'file',
			isAutoAdded: true
		};

		this.state.selectedFiles = [...this.state.selectedFiles, selectedFile];
		this.emitState();
	}

	// 移除自动添加的活跃文件
	removeAutoAddedFile(filePath: string) {
		const fileToRemove = this.state.selectedFiles.find(f => f.id === filePath && f.isAutoAdded);
		if (fileToRemove) {
			this.state.selectedFiles = this.state.selectedFiles.filter((file) => file.id !== filePath);
			this.emitState();
		}
	}

	// 移除所有自动添加的文件
	removeAllAutoAddedFiles() {
		this.state.selectedFiles = this.state.selectedFiles.filter(file => !file.isAutoAdded);
		this.emitState();
	}

	// 编辑区无活动文件时重置会话标记
	onNoActiveFile() {
		this.currentActiveFilePath = null;
		this.manuallyRemovedInCurrentSession = null;
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

	removeSelectedFile(fileId: string, isManualRemoval: boolean = true) {
		// 只有当是用户手动移除时，才记录标记
		if (isManualRemoval) {
			const removedFile = this.state.selectedFiles.find(f => f.id === fileId);
			if (removedFile?.isAutoAdded) {
				// 记录用户在当前活动文件会话期间手动移除了这个文件
				// 只要当前活动文件还是这个文件，就不再自动添加
				this.manuallyRemovedInCurrentSession = fileId;
			}
		}
		
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

	// 模板选择相关方法
	setTemplateSelectorVisibility(visible: boolean) {
		this.state.showTemplateSelector = visible;
		this.emitState();
	}

	async selectPromptTemplate(templatePath: string) {
		try {
			// 读取模板文件内容
			const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
			if (!templateFile || !(templateFile instanceof TFile)) {
				throw new Error(`模板文件不存在: ${templatePath}`);
			}

			const templateContent = await this.plugin.app.vault.read(templateFile);
			const templateName = templateFile.basename;

			// 设置选中的模板
			this.state.selectedPromptTemplate = {
				path: templatePath,
				name: templateName,
				content: templateContent
			};

			// 隐藏模板选择器
			this.state.showTemplateSelector = false;

			// 不修改输入框内容，保持用户当前的输入
			// 模板内容将作为系统提示词在发送消息时使用

			this.emitState();
		} catch (error) {
			console.error('[ChatService] 选择提示词模板失败:', error);
			new Notice(`选择提示词模板失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	clearSelectedPromptTemplate() {
		this.state.selectedPromptTemplate = undefined;
		this.emitState();
	}

	getPromptTemplateContent(): string | undefined {
		return this.state.selectedPromptTemplate?.content;
	}

	hasPromptTemplateVariables(): boolean {
		if (!this.state.selectedPromptTemplate?.content) return false;
		const variableRegex = /\{\{([^}]+)\}\}/g;
		return variableRegex.test(this.state.selectedPromptTemplate.content);
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

		let trimmed = (content ?? this.state.inputValue).trim();
		if (!trimmed && this.state.selectedImages.length === 0 &&
			this.state.selectedFiles.length === 0 && this.state.selectedFolders.length === 0) {
			return;
		}

		// 内链解析：处理用户输入中的内链
		if (this.settings.enableInternalLinkParsing && trimmed) {
			const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
			const parser = new InternalLinkParserService(this.app);
			trimmed = await parser.parseLinks(trimmed, sourcePath, {
				enableParsing: true,
				maxDepth: this.settings.maxLinkParseDepth,
				timeout: this.settings.linkParseTimeout,
				preserveOriginalOnError: true,
				enableCache: true
			});
		}

		// 检测图片生成意图
		const isImageGenerationIntent = this.detectImageGenerationIntent(trimmed);
		const isModelSupportImageGeneration = this.isCurrentModelSupportImageGeneration();
		
		// 如果用户意图生成图片但当前模型不支持，提示用户
		if (isImageGenerationIntent && !isModelSupportImageGeneration) {
			const provider = this.resolveProvider();
			const modelName = provider?.options.model || '当前模型';
			new Notice(`⚠️ 当前模型 (${modelName}) 不支持图像生成功能。

请选择支持图像生成的模型，如：
• google/gemini-2.5-flash-image-preview
• openai/gpt-5-image-mini
• 其他包含 "image" 的模型`, 10000);
			return;
		}

		const session = this.state.activeSession ?? this.createNewSession();

		// 保存文件和文件夹到会话中
		session.selectedFiles = [...this.state.selectedFiles];
		session.selectedFolders = [...this.state.selectedFolders];

		// 处理提示词模板
		let finalUserMessage = trimmed;
		let templateSystemPrompt: string | undefined;
		let templateTag: string | undefined;
		
		if (this.state.selectedPromptTemplate) {
			let templateContent = this.state.selectedPromptTemplate.content;
			const templateName = this.state.selectedPromptTemplate.name;
			
			// 内链解析：如果启用了解析模板中的内链，则解析模板内容
			if (this.settings.enableInternalLinkParsing && this.settings.parseLinksInTemplates) {
				const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
				const parser = new InternalLinkParserService(this.app);
				templateContent = await parser.parseLinks(templateContent, sourcePath, {
					enableParsing: true,
					maxDepth: this.settings.maxLinkParseDepth,
					timeout: this.settings.linkParseTimeout,
					preserveOriginalOnError: true,
					enableCache: true
				});
			}
			
			const variableRegex = /\{\{([^}]+)\}\}/g;
			const hasVariables = variableRegex.test(templateContent);
			
			// 创建提示词模板标签
			templateTag = `[[${templateName}]]`;
			
			if (hasVariables) {
				// 如果模板有变量，用用户输入替换所有变量，并将结果作为系统提示词
				templateSystemPrompt = templateContent.replace(variableRegex, trimmed);
				// 用户输入已经替换到模板中，但用户消息仍显示用户输入和模板标签
				finalUserMessage = `${trimmed}\n\n${templateTag}`;
			} else {
				// 如果模板没有变量，将模板内容作为系统提示词，用户输入作为用户消息
				templateSystemPrompt = templateContent;
				// 用户消息显示用户输入和模板标签
				finalUserMessage = `${trimmed}\n\n${templateTag}`;
			}
		}

		// 获取系统提示词（仅在没有使用模板时）
		let systemPrompt: string | undefined;
		// 如果有模板系统提示词，使用模板系统提示词，忽略原有的系统提示词
		if (templateSystemPrompt) {
			systemPrompt = templateSystemPrompt;
		} else if (this.settings.enableSystemPrompt) {
			// 检查AI助手的系统提示词设置
			const tarsSettings = this.plugin.settings.tars.settings;
			if (tarsSettings.enableDefaultSystemMsg && tarsSettings.defaultSystemMsg) {
				systemPrompt = tarsSettings.defaultSystemMsg;
			}
		}

		// 创建用户消息，包含文件和文件夹信息
		let messageContent = finalUserMessage;
		if (this.state.selectedFiles.length > 0 || this.state.selectedFolders.length > 0) {
			const fileTags = [];
			const folderTags = [];
			
			// 处理文件标签 - 只包含文件名，不包含路径
			if (this.state.selectedFiles.length > 0) {
				for (const file of this.state.selectedFiles) {
					fileTags.push(`[[${file.name}]]`); // 只使用文件名，不使用路径
				}
			}
			
			// 处理文件夹标签
			if (this.state.selectedFolders.length > 0) {
				for (const folder of this.state.selectedFolders) {
					folderTags.push(`#${folder.path}`);
				}
			}
			
			// 添加文件和文件夹标签到消息内容中，不添加"附件:"标题
			if (fileTags.length > 0 || folderTags.length > 0) {
				const allTags = [...fileTags, ...folderTags].join(' ');
				messageContent += `\n\n${allTags}`;
			}
		}

		const userMessage = this.messageService.createMessage('user', messageContent, {
			images: this.state.selectedImages
		});
		
		// 不再将系统提示词作为消息添加到会话中，而是作为内部参数传递
		// 这样系统提示不会显示在聊天界面和历史消息中
		
		// 只有当用户消息有内容或者有图片时，才添加用户消息
		if (messageContent.trim() || this.state.selectedImages.length > 0) {
			session.messages.push(userMessage);
		}
		session.updatedAt = Date.now();
		
		// 将系统提示词作为会话的内部属性存储
		session.systemPrompt = systemPrompt;

		// 清空选中状态
		const currentSelectedFiles = [...this.state.selectedFiles];
		const currentSelectedFolders = [...this.state.selectedFolders];
		this.state.inputValue = '';
		this.state.selectedImages = [];
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.state.selectedPromptTemplate = undefined; // 清除选中的模板
		this.emitState();

		// 如果这是第一条消息，创建历史文件并包含第一条用户消息
		if (session.messages.length === 1 || (systemPrompt && session.messages.length === 2)) {
			try {
				// 获取第一条消息（可能是系统消息或用户消息）
				const firstMessage = session.messages[0];
				session.filePath = await this.historyService.createNewSessionFileWithFirstMessage(
					session, 
					firstMessage, 
					currentSelectedFiles, 
					currentSelectedFolders
				);
			} catch (error) {
				console.error('[ChatService] 创建会话文件失败:', error);
				new Notice('创建会话文件失败，但消息已发送');
			}
		} else {
			// 如果不是第一条消息，追加到现有文件
			try {
				// 获取最后一条消息（可能是用户消息或系统消息）
				const lastMessage = session.messages.last();
				if (lastMessage) {
					await this.historyService.appendMessageToFile(
						session.filePath ?? '', 
						lastMessage, 
						currentSelectedFiles, 
						currentSelectedFolders
					);
				}
			} catch (error) {
				console.error('[ChatService] 追加用户消息失败:', error);
				// 不显示错误通知，避免干扰用户
			}
		}

		// 如果检测到图片生成意图，显示提示信息
		if (isImageGenerationIntent && isModelSupportImageGeneration) {
			const provider = this.resolveProvider();
			const modelName = provider?.options.model || '当前模型';
			new Notice(`🎨 正在使用模型 ${modelName} 生成图片，请稍候...`);
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
			// 重置模板选择状态
			this.state.selectedPromptTemplate = undefined;
			this.state.showTemplateSelector = false;
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

	/**
	 * 检测用户输入是否包含图片生成意图
	 * @param content 用户输入内容
	 * @returns 是否包含图片生成意图
	 */
	private detectImageGenerationIntent(content: string): boolean {
		if (!content) return false;
		
		const lowerContent = content.toLowerCase();
		
		// 图片生成关键词列表
		const imageGenerationKeywords = [
			// 中文关键词
			'生成图片', '生成图像', '画一个', '画一张', '创建图片', '创建图像',
			'绘制', '画一幅', '画一幅画', '生成一幅画', '画个', '画张',
			'图片生成', '图像生成', '画图', '作画', '绘画',
			'设计一个', '设计一张', '创作一个', '创作一张',
			'制作图片', '制作图像', '制作一张图',
			// 英文关键词
			'generate image', 'generate an image', 'create image', 'create an image',
			'draw a', 'draw an', 'draw me a', 'draw me an',
			'paint a', 'paint an', 'paint me a', 'paint me an',
			'make a picture', 'make an image', 'create a picture',
			'generate a picture', 'generate picture', 'create picture',
			'design a', 'design an', 'design me a', 'design me an',
			'make a', 'make an', 'make me a', 'make me an',
			'visualize', 'visualize a', 'visualize an',
			'show me a', 'show me an', 'display a', 'display an'
		];
		
		// 检查是否包含任何图片生成关键词
		return imageGenerationKeywords.some(keyword => lowerContent.includes(keyword));
	}

	/**
	 * 检查当前选择的模型是否支持图像生成
	 * @returns 是否支持图像生成
	 */
	private isCurrentModelSupportImageGeneration(): boolean {
		const provider = this.resolveProvider();
		if (!provider) return false;
		
		const vendor = availableVendors.find((item) => item.name === provider.vendor);
		if (!vendor) return false;
		
		// 检查供应商是否支持图像生成功能
		if (!vendor.capabilities.includes('Image Generation')) return false;
		
		// 对于OpenRouter，需要进一步检查具体模型
		if (provider.vendor === 'OpenRouter') {
			return isImageGenerationModel(provider.options.model);
		}
		
		// 其他供应商，只要支持图像生成功能就返回true
		return true;
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

			// 创建saveAttachment函数，用于保存生成的图片
			const saveAttachment: SaveAttachment = async (filename: string, data: ArrayBuffer): Promise<void> => {
				try {
					// 获取当前附件文件夹路径
					const attachmentFolderPath = this.plugin.app.vault.getConfig('attachmentFolderPath');
					
					// 确定保存路径
					let savePath = filename;
					if (attachmentFolderPath) {
						// 如果配置了附件文件夹路径，使用该路径
						// 处理相对路径和绝对路径
						if (attachmentFolderPath === '/') {
							// 根目录，直接使用文件名
							savePath = filename;
						} else if (typeof attachmentFolderPath === 'string' && attachmentFolderPath.startsWith('/')) {
							// 绝对路径
							savePath = attachmentFolderPath.slice(1) + '/' + filename;
						} else {
							// 相对于当前文件夹的路径
							const activeFile = this.plugin.app.workspace.getActiveFile();
							if (activeFile) {
								const currentDir = activeFile.parent?.path || '';
								savePath = currentDir ? `${currentDir}/${attachmentFolderPath}/${filename}` : `${attachmentFolderPath}/${filename}`;
							} else {
								savePath = `${attachmentFolderPath}/${filename}`;
							}
						}
					} else {
						// 没有配置附件文件夹，使用默认行为（保存在当前文件同一目录）
						const activeFile = this.plugin.app.workspace.getActiveFile();
						if (activeFile && activeFile.parent) {
							savePath = `${activeFile.parent.path}/${filename}`;
						}
					}
					
					// 创建文件
					await this.plugin.app.vault.createBinary(savePath, data);
				} catch (error) {
					console.error('[ChatService] 保存图片附件失败:', error);
					throw new Error(`保存图片附件失败: ${error instanceof Error ? error.message : String(error)}`);
				}
			};

			// 创建一个临时消息对象用于流式更新
			let accumulatedContent = '';
			
			// 检测是否是图片生成请求
			const isImageGenerationRequest = this.detectImageGenerationIntent(
				session.messages[session.messages.length - 2]?.content || ''
			);
			
			// 检查当前模型是否支持图像生成
			const isModelSupportImageGeneration = this.isCurrentModelSupportImageGeneration();
			
			// 如果模型支持图像生成，总是传递saveAttachment函数
			if (isModelSupportImageGeneration) {
				try {
					for await (const chunk of sendRequest(messages, this.controller, resolveEmbed, saveAttachment)) {
						assistantMessage.content += chunk;
						accumulatedContent += chunk;
						session.updatedAt = Date.now();
						this.emitState();
					}
				} catch (error) {
					// 针对图片生成错误的特殊处理
					if (error instanceof Error) {
						const errorMessage = error.message.toLowerCase();
						
						// 检查是否是模型不支持图像生成的错误
						if (errorMessage.includes('not support') || errorMessage.includes('modalities') || errorMessage.includes('output_modalities')) {
							throw new Error(`当前模型不支持图像生成功能。

解决方法：
1. 选择支持图像生成的模型，如 google/gemini-2.5-flash-image-preview
2. 在模型设置中确认已启用图像生成功能
3. 检查API密钥是否有图像生成权限`);
						}
						
						// 检查是否是内容策略错误
						if (errorMessage.includes('content policy') || errorMessage.includes('safety') || errorMessage.includes('inappropriate')) {
							throw new Error(`图像生成请求被内容策略阻止。

解决方法：
1. 修改您的描述，避免敏感内容
2. 使用更中性、通用的描述
3. 尝试不同的描述角度`);
						}
						
						// 检查是否是配额或余额不足错误
						if (errorMessage.includes('quota') || errorMessage.includes('balance') || errorMessage.includes('insufficient')) {
							throw new Error(`账户配额或余额不足。

解决方法：
1. 检查API账户余额
2. 升级到更高的配额计划
3. 等待配额重置（如果是按天计算）`);
						}
						
						// 检查是否是图片保存错误
						if (errorMessage.includes('保存图片附件失败')) {
							throw new Error(`图片生成成功，但保存到本地失败。

解决方法：
1. 检查Obsidian附件文件夹权限
2. 确保有足够的磁盘空间
3. 尝试在设置中更改图片保存位置`);
						}
						
						// 其他错误，直接抛出
						throw error;
					} else {
						throw new Error(`图像生成过程中发生未知错误: ${String(error)}`);
					}
				}
			} else {
				// 不支持图像生成的模型，不传递saveAttachment函数
				for await (const chunk of sendRequest(messages, this.controller, resolveEmbed)) {
					assistantMessage.content += chunk;
					accumulatedContent += chunk;
					session.updatedAt = Date.now();
					this.emitState();
				}
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
			
			// 处理错误消息
			let errorMessage = '生成失败，请稍后再试。';
			if (error instanceof Error) {
				errorMessage = error.message;
			} else {
				errorMessage = `生成过程中发生未知错误: ${String(error)}`;
			}
			
			this.state.error = errorMessage;
			if (session.messages.length > 0) {
				const last = session.messages[session.messages.length - 1];
				if (last.role === 'assistant') {
					last.isError = true;
					// 在消息中显示错误信息，而不是仅显示在状态中
					if (!last.content) {
						last.content = errorMessage;
					}
				}
			}
			this.emitState();
			new Notice(errorMessage, 10000); // 显示10秒，让用户有足够时间阅读
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
		
		// 使用会话中存储的系统提示词，而不是重新计算
		let systemPrompt: string | undefined = session.systemPrompt;
		
		return await this.messageService.toProviderMessages(session.messages, {
			contextNotes,
			systemPrompt,
			selectedFiles,
			selectedFolders,
			fileContentOptions
		});
	}

	getProviders(): ProviderSettings[] {
		return [...this.plugin.settings.tars.settings.providers];
	}
}

