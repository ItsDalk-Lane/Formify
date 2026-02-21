import { MarkdownView, Notice, requestUrl, TFile, TFolder, normalizePath } from 'obsidian';
import FormPlugin from 'src/main';
import type { ProviderSettings, SaveAttachment } from 'src/features/tars/providers';
import type { Message as ProviderMessage, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { availableVendors, TarsSettings } from 'src/features/tars/settings';
import { isImageGenerationModel } from 'src/features/tars/providers/openRouter';
import { MessageService } from './MessageService';
import { HistoryService, ChatHistoryEntry } from './HistoryService';
import { FileContentService } from './FileContentService';
import type { ChatMessage, ChatSession, ChatSettings, ChatState, McpToolMode, SelectedFile, SelectedFolder } from '../types/chat';
import { DEFAULT_CHAT_SETTINGS } from '../types/chat';
import { v4 as uuidv4 } from 'uuid';
import { InternalLinkParserService } from '../../../service/InternalLinkParserService';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptAssembler } from 'src/service/SystemPromptAssembler';
import { arrayBufferToBase64, getMimeTypeFromFilename } from 'src/features/tars/providers/utils';
import type { ToolCall, ToolDefinition, ToolExecution } from '../types/tools';
import { ToolRegistryService } from './ToolRegistryService';
import { ToolExecutionManager } from './ToolExecutionManager';

type ChatSubscriber = (state: ChatState) => void;

export class ChatService {
	private settings: ChatSettings = DEFAULT_CHAT_SETTINGS;
	private readonly messageService: MessageService;
	private readonly historyService: HistoryService;
	private readonly fileContentService: FileContentService;
	private readonly toolRegistry: ToolRegistryService;
	private readonly toolExecutionManager: ToolExecutionManager;
	private state: ChatState = {
		activeSession: null,
		isGenerating: false,
		inputValue: '',
		selectedModelId: null,
		enableReasoningToggle: false,
		enableWebSearchToggle: false,
		enableTemplateAsSystemPrompt: false,
		contextNotes: [],
		selectedImages: [],
		selectedFiles: [],
		selectedFolders: [],
		selectedText: undefined,
		showTemplateSelector: false,
		shouldSaveHistory: true, // 默认保存历史记录
		pendingToolExecutions: [],
		toolExecutions: [],
		mcpToolMode: 'auto',
		mcpSelectedServerIds: [],
	};
	private subscribers: Set<ChatSubscriber> = new Set();
	private controller: AbortController | null = null;
	private ollamaCapabilityCache = new Map<string, { reasoning: boolean; checkedAt: number; warned?: boolean }>();
	private lastMcpNoticeAt = 0;
	// 跟踪当前活动文件的路径
	private currentActiveFilePath: string | null = null;
	// 跟踪在当前活动文件会话期间，用户手动移除的文件路径（仅在当前文件活跃期间有效）
	private manuallyRemovedInCurrentSession: string | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.fileContentService = new FileContentService(plugin.app);
		this.messageService = new MessageService(plugin.app, this.fileContentService);
		this.historyService = new HistoryService(plugin.app, DEFAULT_CHAT_SETTINGS.chatFolder);
		this.toolRegistry = new ToolRegistryService();
		this.toolExecutionManager = new ToolExecutionManager(this.toolRegistry, (executions) => {
			this.state.pendingToolExecutions = executions.filter((e) => e.status === 'pending');
			this.state.toolExecutions = executions;
			this.emitState();
		});
	}

	private get app() {
		return this.plugin.app;
	}

	initialize(initialSettings?: Partial<ChatSettings>) {
		this.updateSettings(initialSettings ?? {});
		this.loadGlobalTools();
		this.syncToolSettingsFromTars();
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
			selectedImages: [],
			enableTemplateAsSystemPrompt: false
		};
		this.state.activeSession = session;
		this.state.contextNotes = [];
		this.state.selectedImages = [];
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.state.selectedText = undefined;
		this.state.inputValue = '';
		this.state.enableTemplateAsSystemPrompt = false;
		this.state.selectedPromptTemplate = undefined;
		this.state.showTemplateSelector = false;
		this.state.mcpToolMode = 'auto';
		this.state.mcpSelectedServerIds = [];
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

	addSelectedImages(images: string[]) {
		if (images.length === 0) {
			return;
		}
		this.state.selectedImages = this.mergeSelectedImages(this.state.selectedImages, images);
		this.emitState();
	}

	removeSelectedImage(image: string) {
		this.state.selectedImages = this.state.selectedImages.filter((img) => img !== image);
		this.emitState();
	}

	// 选中文本管理方法
	setSelectedText(text: string) {
		this.state.selectedText = text;
		this.emitState();
	}

	clearSelectedText() {
		this.state.selectedText = undefined;
		this.emitState();
	}

	// 历史保存控制方法
	setShouldSaveHistory(shouldSave: boolean) {
		this.state.shouldSaveHistory = shouldSave;
		this.emitState();
	}

	setReasoningToggle(enabled: boolean) {
		this.state.enableReasoningToggle = enabled;
		this.emitState();
	}

	setWebSearchToggle(enabled: boolean) {
		this.state.enableWebSearchToggle = enabled;
		this.emitState();
	}

	setTemplateAsSystemPromptToggle(enabled: boolean) {
		const session = this.state.activeSession;
		if (
			this.state.enableTemplateAsSystemPrompt === enabled &&
			(!session || session.enableTemplateAsSystemPrompt === enabled)
		) {
			return;
		}

		this.state.enableTemplateAsSystemPrompt = enabled;
		if (session) {
			session.enableTemplateAsSystemPrompt = enabled;
			if (session.filePath) {
				void this.historyService.updateSessionFrontmatter(session.filePath, {
					enableTemplateAsSystemPrompt: enabled
				}).catch((error) => {
					console.error('[ChatService] 更新模板系统提示词开关失败:', error);
				});
			}
		}
		this.emitState();
	}

	getReasoningToggle(): boolean {
		return this.state.enableReasoningToggle;
	}

	getWebSearchToggle(): boolean {
		return this.state.enableWebSearchToggle;
	}

	getTemplateAsSystemPromptToggle(): boolean {
		return this.state.enableTemplateAsSystemPrompt;
	}

	private getTarsToolSettings() {
		const tools = this.plugin.settings.tars.settings.tools;
		return (
			tools ?? {
				globalTools: [],
				executionMode: 'manual' as const,
				enabled: false
			}
		);
	}

	private async updateTarsToolSettings(update: Partial<{ globalTools: ToolDefinition[]; executionMode: 'manual' | 'auto'; enabled: boolean }>) {
		const current = this.getTarsToolSettings();
		this.plugin.settings.tars.settings.tools = {
			...current,
			...update
		};
		await this.plugin.saveSettings();
	}

	private syncToolSettingsFromTars() {
		this.state.pendingToolExecutions = this.toolExecutionManager.getPending();
	}

	loadGlobalTools() {
		const tools = this.getTarsToolSettings();
		for (const def of tools.globalTools ?? []) {
			// 如果是内置工具，只应用 enabled 覆盖（避免用 user 工具覆盖内置实现）
			if (this.toolRegistry.isBuiltin(def.id)) {
				this.toolRegistry.setToolEnabled(def.id, def.enabled);
				// 如果有 executionMode，也应用
				if (def.executionMode) {
					this.toolRegistry.setToolExecutionMode(def.id, def.executionMode);
				}
				continue;
			}
			// 确保 executionMode 字段存在
			const toolWithMode = {
				...def,
				executionMode: def.executionMode ?? 'manual'
			};
			this.toolRegistry.upsertUserTool(toolWithMode);
		}
	}

	/**
	 * 获取消息服务实例
	 */
	getMessageService(): MessageService {
		return this.messageService;
	}

	/**
	 * 获取工具注册服务实例
	 */
	getToolRegistry(): ToolRegistryService {
		return this.toolRegistry;
	}

	/**
	 * 获取工具执行管理器实例
	 */
	getToolExecutionManager(): ToolExecutionManager {
		return this.toolExecutionManager;
	}

	getTools(): ToolDefinition[] {
		return this.toolRegistry.list();
	}

	isBuiltinTool(id: string): boolean {
		return this.toolRegistry.isBuiltin(id);
	}

	async setToolExecutionMode(id: string, executionMode: 'manual' | 'auto') {
		this.toolRegistry.setToolExecutionMode(id, executionMode);
		const tools = this.getTarsToolSettings();
		const list = tools.globalTools ?? [];
		const now = Date.now();
		const hasEntry = list.some((t) => t.id === id);
		let next: ToolDefinition[];
		if (hasEntry) {
			next = list.map((t) => (t.id === id ? { ...t, executionMode, updatedAt: now } : t));
		} else {
			const def = this.toolRegistry.get(id);
			next = def ? [...list, { ...def, executionMode, updatedAt: now }] : list;
		}
		await this.updateTarsToolSettings({ globalTools: next });
		this.emitState();
	}

	async upsertToolDefinition(tool: ToolDefinition) {
		if (this.toolRegistry.isBuiltin(tool.id)) {
			new Notice(`不能创建/覆盖内置工具：${tool.id}`);
			return;
		}
		this.toolRegistry.upsertUserTool(tool);
		const tools = this.getTarsToolSettings();
		const list = tools.globalTools ?? [];
		const next = [...list.filter((t) => t.id !== tool.id), tool];
		await this.updateTarsToolSettings({ globalTools: next });
		this.emitState();
	}

	async deleteToolDefinition(id: string) {
		if (!this.toolRegistry.remove(id)) return;
		const tools = this.getTarsToolSettings();
		await this.updateTarsToolSettings({ globalTools: (tools.globalTools ?? []).filter((t) => t.id !== id) });
		this.emitState();
	}

	async setToolEnabled(id: string, enabled: boolean) {
		this.toolRegistry.setToolEnabled(id, enabled);
		const tools = this.getTarsToolSettings();
		const list = tools.globalTools ?? [];
		const now = Date.now();
		const hasEntry = list.some((t) => t.id === id);
		let next: ToolDefinition[];
		if (hasEntry) {
			next = list.map((t) => (t.id === id ? { ...t, enabled, updatedAt: now } : t));
		} else {
			const def = this.toolRegistry.get(id);
			next = def ? [...list, { ...def, enabled, updatedAt: now }] : list;
		}
		await this.updateTarsToolSettings({ globalTools: next });
		this.emitState();
	}

	getPendingToolExecutions(): ToolExecution[] {
		return this.toolExecutionManager.getPending();
	}

	async approveToolExecution(id: string) {
		const exec = await this.toolExecutionManager.approve(id);
		this.applyExecutionResultToMessage(exec);
		this.emitState();
	}

	rejectToolExecution(id: string) {
		const exec = this.toolExecutionManager.reject(id);
		this.applyExecutionResultToMessage(exec);
		this.emitState();
	}

	async approveAllPendingToolExecutions() {
		const pending = this.toolExecutionManager.getPending();
		for (const exec of pending) {
			await this.approveToolExecution(exec.id);
		}
	}

	rejectAllPendingToolExecutions() {
		const pending = this.toolExecutionManager.getPending();
		for (const exec of pending) {
			this.rejectToolExecution(exec.id);
		}
	}

	private applyExecutionResultToMessage(exec: ToolExecution) {
		const session = this.state.activeSession;
		if (!session) return;
		const msg = session.messages.find((m) => m.id === exec.messageId);
		if (!msg || !msg.toolCalls?.length) return;
		if (!exec.toolCallId) return;
		const call = msg.toolCalls.find((c) => c.id === exec.toolCallId);
		if (!call) return;

		if (exec.status === 'completed') {
			call.status = 'completed';
			call.result = exec.result;
		} else if (exec.status === 'failed') {
			call.status = 'failed';
			call.result = exec.error;
		} else if (exec.status === 'rejected') {
			call.status = 'failed';
			call.result = '用户已拒绝';
		}
	}

	async retryToolCall(messageId: string, toolCallId: string) {
		const session = this.state.activeSession;
		if (!session) return;
		const message = session.messages.find((msg) => msg.id === messageId);
		if (!message?.toolCalls?.length) return;
		const call = message.toolCalls.find((item) => item.id === toolCallId);
		if (!call) return;

		call.status = 'pending';
		call.result = undefined;
		call.timestamp = Date.now();

		const exec = this.toolExecutionManager.createPending({
			toolId: call.name,
			toolCallId: call.id,
			sessionId: session.id,
			messageId: message.id,
			args: call.arguments ?? {}
		});

		const tool = this.toolRegistry.get(call.name);
		const executionMode = tool?.executionMode ?? 'manual';
		if (executionMode === 'auto') {
			await this.approveToolExecution(exec.id);
		} else {
			new Notice(`工具调用待审批：${call.name}`);
		}
		this.emitState();
	}

	/**
	 * 保存当前会话状态（用于模态框模式）
	 * @returns 保存的会话状态
	 */
	saveSessionState(): { activeSession: ChatSession | null; selectedFiles: any[]; selectedFolders: any[] } {
		return {
			activeSession: this.state.activeSession ? JSON.parse(JSON.stringify(this.state.activeSession)) : null,
			selectedFiles: JSON.parse(JSON.stringify(this.state.selectedFiles)),
			selectedFolders: JSON.parse(JSON.stringify(this.state.selectedFolders))
		};
	}

	/**
	 * 恢复会话状态（用于模态框模式）
	 * @param savedState 保存的会话状态
	 */
	restoreSessionState(savedState: { activeSession: ChatSession | null; selectedFiles: any[]; selectedFolders: any[] }) {
		if (savedState.activeSession) {
			this.state.activeSession = savedState.activeSession;
			this.state.enableTemplateAsSystemPrompt = savedState.activeSession.enableTemplateAsSystemPrompt ?? false;
		} else {
			this.state.enableTemplateAsSystemPrompt = false;
		}
		this.state.selectedFiles = savedState.selectedFiles;
		this.state.selectedFolders = savedState.selectedFolders;
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
			// 只有切换到不同的文件时，才清除之前的手动移除标记
			// 如果新文件之前被手动移除过，不要清除标记
			if (this.manuallyRemovedInCurrentSession !== file.path) {
				this.manuallyRemovedInCurrentSession = null;
			}
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

	// 获取所有自动添加的文件
	getAutoAddedFiles(): SelectedFile[] {
		return this.state.selectedFiles.filter(file => file.isAutoAdded);
	}

	// 编辑区无活动文件时重置会话标记
	onNoActiveFile() {
		this.currentActiveFilePath = null;
		this.manuallyRemovedInCurrentSession = null;
	}

	// 重新打开AI Chat界面时清除当前文件的手动移除标记
	onChatViewReopened(currentFile: TFile | null) {
		if (!currentFile) return;
		// 如果当前文件之前被手动移除过，清除标记以允许重新自动添加
		if (this.manuallyRemovedInCurrentSession === currentFile.path) {
			this.manuallyRemovedInCurrentSession = null;
		}
		// 更新当前活动文件路径
		this.currentActiveFilePath = currentFile.path;
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

	/**
	 * 返回所有已启用的 MCP 服务器配置（供 UI 展示 MCP 服务器列表）
	 */
	getEnabledMcpServers(): Array<{ id: string; name: string }> {
		const mcpManager = this.plugin.featureCoordinator.getMcpClientManager();
		if (!mcpManager) return [];
		return mcpManager.getSettings().servers
			.filter((server) => server.enabled)
			.map((server) => ({ id: server.id, name: server.name }));
	}

	/**
	 * 设置当前会话的 MCP 工具调用模式
	 */
	setMcpToolMode(mode: McpToolMode) {
		this.state.mcpToolMode = mode;
		this.emitState();
	}

	/**
	 * 设置手动模式下选中的 MCP 服务器 ID 列表
	 */
	setMcpSelectedServerIds(ids: string[]) {
		this.state.mcpSelectedServerIds = [...ids];
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

		const contentToSend = content ?? this.state.inputValue;
		const inputReferencedImages = await this.resolveImagesFromInputReferences(contentToSend);
		if (inputReferencedImages.length > 0) {
			this.state.selectedImages = this.mergeSelectedImages(this.state.selectedImages, inputReferencedImages);
		}

		let trimmed = contentToSend.trim();
		if (!trimmed && this.state.selectedImages.length === 0 &&
			this.state.selectedFiles.length === 0 && this.state.selectedFolders.length === 0) {
			return;
		}

		// 保存用户输入的原始内容，用于在对话消息框中显示
		const originalUserInput = trimmed;

		// 检测图片生成意图（使用原始输入）
		const isImageGenerationIntent = this.detectImageGenerationIntent(originalUserInput);
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

		const selectedPromptTemplate = this.state.selectedPromptTemplate;
		const useTemplateAsSystemPrompt =
			this.state.enableTemplateAsSystemPrompt &&
			!!selectedPromptTemplate?.content;

		// 处理提示词模板（默认仅用于 Task 层）
		let finalUserMessage = originalUserInput;
		let taskTemplate: string | undefined;
		
		if (selectedPromptTemplate && !useTemplateAsSystemPrompt) {
			const templateContent = selectedPromptTemplate.content;
			const templateName = selectedPromptTemplate.name;
			
			// 创建提示词模板标签
			finalUserMessage = `${originalUserInput}\n\n[[${templateName}]]`;
			taskTemplate = templateContent;
		}

		// 获取系统提示词（开启模板系统提示词且选中模板时，直接使用模板原文）
		let systemPrompt: string | undefined;
		if (useTemplateAsSystemPrompt && selectedPromptTemplate) {
			systemPrompt = selectedPromptTemplate.content;
		} else {
			const assembler = new SystemPromptAssembler(this.app);
			const built = await assembler.buildGlobalSystemPrompt('tars_chat');
			if (built && built.trim().length > 0) {
				systemPrompt = built;
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
			images: this.state.selectedImages,
			metadata: {
				// Task 层：保留原始用户输入与模板，供 PromptBuilder 统一组装/解析
				taskUserInput: originalUserInput,
				taskTemplate: taskTemplate,
				// 存储选中文本，用于UI显示和发送给AI
				selectedText: this.state.selectedText
			}
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
		session.enableTemplateAsSystemPrompt = this.state.enableTemplateAsSystemPrompt;

		// 清空选中状态
		const currentSelectedFiles = [...this.state.selectedFiles];
		const currentSelectedFolders = [...this.state.selectedFolders];
		this.state.inputValue = '';
		this.state.selectedImages = [];
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.state.selectedText = undefined; // 清除选中的文本
		this.state.selectedPromptTemplate = undefined; // 清除选中的模板
		this.emitState();

		// 只有在应该保存历史记录时才保存
		if (this.state.shouldSaveHistory) {
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
		}

		// 如果检测到图片生成意图，显示提示信息
		if (isImageGenerationIntent && isModelSupportImageGeneration) {
			const provider = this.resolveProvider();
			const modelName = provider?.options.model || '当前模型';
			new Notice(`🎨 正在使用模型 ${modelName} 生成图片，请稍候...`);
		}

		const provider = this.resolveProvider();
		if (!provider) {
			new Notice('尚未配置任何AI模型，请先在Tars设置中添加Provider。');
			return;
		}

		await this.generateAssistantResponse(session);
	}

	stopGeneration() {
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
		if (this.state.isGenerating) {
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
			session.enableTemplateAsSystemPrompt = session.enableTemplateAsSystemPrompt ?? false;
			// 设置文件路径，以便后续追加消息
			session.filePath = filePath;
			this.state.activeSession = session;
			this.state.contextNotes = session.contextNotes ?? [];
			this.state.selectedImages = session.selectedImages ?? [];
			this.state.selectedFiles = session.selectedFiles ?? [];
			this.state.selectedFolders = session.selectedFolders ?? [];
			this.state.selectedModelId = session.modelId || this.getDefaultProviderTag();
			this.state.enableTemplateAsSystemPrompt = session.enableTemplateAsSystemPrompt;
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

	private normalizeOllamaBaseUrl(baseURL?: string) {
		const trimmed = (baseURL || '').trim();
		if (!trimmed) return 'http://127.0.0.1:11434';
		return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
	}

	private mergeSelectedImages(existingImages: string[], incomingImages: string[]): string[] {
		const mergedSet = new Set(existingImages);
		for (const image of incomingImages) {
			if (image && image.trim().length > 0) {
				mergedSet.add(image);
			}
		}
		return Array.from(mergedSet);
	}

	private isSupportedImageMimeType(mimeType: string): boolean {
		return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'].includes(mimeType);
	}

	private sanitizeCandidateToken(token: string): string {
		const trimmed = token.trim();
		const unwrapped = trimmed.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '');
		return unwrapped.replace(/[),.;]+$/g, '');
	}

	private extractImageReferenceCandidates(input: string): string[] {
		if (!input || input.trim().length === 0) {
			return [];
		}

		const candidates = new Set<string>();
		const pushCandidate = (value: string) => {
			const normalized = this.sanitizeCandidateToken(value);
			if (normalized.length > 0) {
				candidates.add(normalized);
			}
		};

		const markdownImageRegex = /!\[[^\]]*\]\(([^)]+)\)/gi;
		for (const match of input.matchAll(markdownImageRegex)) {
			if (match[1]) {
				pushCandidate(match[1]);
			}
		}

		const wikiImageRegex = /!\[\[([^\]]+)\]\]/gi;
		for (const match of input.matchAll(wikiImageRegex)) {
			if (match[1]) {
				pushCandidate(match[1]);
			}
		}

		const rawImageLinkRegex = /\[\[([^\]]+\.(?:png|jpe?g|gif|webp|bmp|svg)[^\]]*)\]\]/gi;
		for (const match of input.matchAll(rawImageLinkRegex)) {
			if (match[1]) {
				pushCandidate(match[1]);
			}
		}

		const dataUrlRegex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
		for (const match of input.matchAll(dataUrlRegex)) {
			if (match[0]) {
				pushCandidate(match[0]);
			}
		}

		const httpImageRegex = /https?:\/\/[^\s)\]>]+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s)\]>]*)?/gi;
		for (const match of input.matchAll(httpImageRegex)) {
			if (match[0]) {
				pushCandidate(match[0]);
			}
		}

		const obsidianUrlRegex = /obsidian:\/\/[^\s)\]>]+/gi;
		for (const match of input.matchAll(obsidianUrlRegex)) {
			if (match[0]) {
				pushCandidate(match[0]);
			}
		}

		const quotedWindowsPathRegex = /["']([a-zA-Z]:\\[^"']+\.(?:png|jpe?g|gif|webp|bmp|svg))["']/g;
		for (const match of input.matchAll(quotedWindowsPathRegex)) {
			if (match[1]) {
				pushCandidate(match[1]);
			}
		}

		const plainWindowsPathRegex = /[a-zA-Z]:\\[^\s"'<>|?*]+\.(?:png|jpe?g|gif|webp|bmp|svg)/g;
		for (const match of input.matchAll(plainWindowsPathRegex)) {
			if (match[0]) {
				pushCandidate(match[0]);
			}
		}

		const relativePathRegex = /(?:\.\/|\.\.\/)?[^\s"'<>]+(?:\/[^\s"'<>]+)*\.(?:png|jpe?g|gif|webp|bmp|svg)/gi;
		for (const match of input.matchAll(relativePathRegex)) {
			if (match[0]) {
				pushCandidate(match[0]);
			}
		}

		return Array.from(candidates);
	}

	private stripObsidianLinkDecorators(candidate: string): string {
		const withoutAlias = candidate.split('|')[0] ?? candidate;
		const withoutHeading = withoutAlias.split('#')[0] ?? withoutAlias;
		return this.sanitizeCandidateToken(withoutHeading);
	}

	private dataUrlToMimeType(dataUrl: string): string {
		const match = dataUrl.match(/^data:([^;]+);base64,/i);
		return match?.[1]?.toLowerCase() ?? 'application/octet-stream';
	}

	private arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
		const base64 = arrayBufferToBase64(buffer);
		return `data:${mimeType};base64,${base64}`;
	}

	private toSafeArrayBuffer(data: Uint8Array | Buffer): ArrayBuffer {
		return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
	}

	private async loadVaultImageAsDataUrl(vaultPath: string): Promise<string | null> {
		const normalized = normalizePath(vaultPath.replace(/^\//, ''));
		const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
		if (!(abstractFile instanceof TFile)) {
			return null;
		}
		const mimeType = getMimeTypeFromFilename(abstractFile.name);
		if (!this.isSupportedImageMimeType(mimeType)) {
			return null;
		}
		const binary = await this.app.vault.readBinary(abstractFile);
		return this.arrayBufferToDataUrl(binary, mimeType);
	}

	private tryResolveVaultPathFromObsidianUrl(urlText: string): string | null {
		try {
			const url = new URL(urlText);
			if (url.protocol !== 'obsidian:') {
				return null;
			}

			if (url.hostname === 'open') {
				const pathParam = url.searchParams.get('path');
				if (pathParam) {
					return decodeURIComponent(pathParam);
				}

				const fileParam = url.searchParams.get('file');
				if (fileParam) {
					const vaultName = url.searchParams.get('vault');
					if (!vaultName || vaultName === this.app.vault.getName()) {
						return decodeURIComponent(fileParam);
					}
				}
			}

			if (url.hostname === 'vault') {
				const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
				const [vaultName, ...segments] = path.split('/');
				if (vaultName && vaultName === this.app.vault.getName() && segments.length > 0) {
					return segments.join('/');
				}
			}
		} catch {
			return null;
		}

		return null;
	}

	private buildVaultPathCandidates(rawPath: string): string[] {
		const cleaned = this.stripObsidianLinkDecorators(rawPath).replace(/\\/g, '/');
		if (!cleaned) {
			return [];
		}

		const candidates = new Set<string>();
		candidates.add(cleaned);

		const activeFilePath = this.app.workspace.getActiveFile()?.path;
		if (activeFilePath && (cleaned.startsWith('./') || cleaned.startsWith('../'))) {
			const activeSegments = activeFilePath.split('/');
			activeSegments.pop();
			for (const segment of cleaned.split('/')) {
				if (segment === '.' || segment.length === 0) {
					continue;
				}
				if (segment === '..') {
					if (activeSegments.length > 0) {
						activeSegments.pop();
					}
					continue;
				}
				activeSegments.push(segment);
			}
			candidates.add(activeSegments.join('/'));
		}

		return Array.from(candidates).map((item) => normalizePath(item.replace(/^\//, '')));
	}

	private async loadExternalImageAsDataUrl(filePath: string): Promise<string | null> {
		try {
			const pathModule = await import('node:path');
			const fs = await import('node:fs/promises');
			const normalizedPath = this.stripObsidianLinkDecorators(filePath);
			const mimeType = getMimeTypeFromFilename(pathModule.basename(normalizedPath));
			if (!this.isSupportedImageMimeType(mimeType)) {
				return null;
			}

			const nodeBuffer = await fs.readFile(normalizedPath);
			const arrayBuffer = this.toSafeArrayBuffer(nodeBuffer);
			return this.arrayBufferToDataUrl(arrayBuffer, mimeType);
		} catch {
			return null;
		}
	}

	private async loadRemoteImageAsDataUrl(urlText: string): Promise<string | null> {
		try {
			const response = await requestUrl({
				url: urlText,
				method: 'GET'
			});
			const guessedMimeType = getMimeTypeFromFilename(urlText);
			const mimeType = this.isSupportedImageMimeType(guessedMimeType) ? guessedMimeType : 'image/png';
			return this.arrayBufferToDataUrl(response.arrayBuffer, mimeType);
		} catch {
			return null;
		}
	}

	private async resolveSingleImageReference(candidate: string): Promise<string | null> {
		const sanitized = this.sanitizeCandidateToken(candidate);
		if (!sanitized) {
			return null;
		}

		if (sanitized.startsWith('data:image/')) {
			const mimeType = this.dataUrlToMimeType(sanitized);
			return this.isSupportedImageMimeType(mimeType) ? sanitized : null;
		}

		if (sanitized.startsWith('http://') || sanitized.startsWith('https://')) {
			return this.loadRemoteImageAsDataUrl(sanitized);
		}

		if (sanitized.startsWith('obsidian://')) {
			const resolvedPath = this.tryResolveVaultPathFromObsidianUrl(sanitized);
			if (resolvedPath) {
				const fromVault = await this.loadVaultImageAsDataUrl(resolvedPath);
				if (fromVault) {
					return fromVault;
				}
				return this.loadExternalImageAsDataUrl(resolvedPath);
			}
			return null;
		}

		if (/^[a-zA-Z]:\\/.test(sanitized)) {
			return this.loadExternalImageAsDataUrl(sanitized);
		}

		const vaultPathCandidates = this.buildVaultPathCandidates(sanitized);
		for (const vaultPath of vaultPathCandidates) {
			const dataUrl = await this.loadVaultImageAsDataUrl(vaultPath);
			if (dataUrl) {
				return dataUrl;
			}
		}

		return null;
	}

	private async resolveImagesFromInputReferences(input: string): Promise<string[]> {
		const candidates = this.extractImageReferenceCandidates(input);
		if (candidates.length === 0) {
			return [];
		}

		const resolved = await Promise.all(candidates.map((candidate) => this.resolveSingleImageReference(candidate)));
		const valid = resolved.filter((item): item is string => typeof item === 'string' && item.length > 0);
		return Array.from(new Set(valid));
	}

	private async getOllamaCapabilities(baseURL: string, model: string) {
		const normalizedBase = this.normalizeOllamaBaseUrl(baseURL);
		const key = `${normalizedBase}|${model}`;
		const cache = this.ollamaCapabilityCache.get(key);
		const now = Date.now();
		if (cache && now - cache.checkedAt < 5 * 60 * 1000) {
			return cache;
		}

		try {
			const response = await requestUrl({
				url: `${normalizedBase}/api/show`,
				method: 'POST',
				body: JSON.stringify({ model })
			});
			const capabilities = Array.isArray(response.json?.capabilities) ? response.json.capabilities : [];
			const normalized = capabilities.map((cap: string) => String(cap).toLowerCase());
			const reasoning = normalized.includes('thinking') || normalized.includes('reasoning');
			const next = { reasoning, checkedAt: now };
			this.ollamaCapabilityCache.set(key, next);
			return next;
		} catch (error) {
			const next = { reasoning: false, checkedAt: now, warned: cache?.warned };
			this.ollamaCapabilityCache.set(key, next);
			return next;
		}
	}


	private async generateAssistantResponse(session: ChatSession) {
		try {
			const provider = this.resolveProvider();
			if (!provider) {
				throw new Error('尚未配置任何AI模型，请先在Tars设置中添加Provider。');
			}

			const providerOptionsRaw = (provider?.options as any) ?? {};
			const providerEnableReasoning =
				typeof providerOptionsRaw.enableReasoning === 'boolean'
					? providerOptionsRaw.enableReasoning
					: provider.vendor === 'Doubao'
						? ((providerOptionsRaw.thinkingType as string | undefined) ?? 'enabled') !== 'disabled'
						: false;
			const providerEnableThinking = providerOptionsRaw.enableThinking ?? false;
			const providerEnableWebSearch = provider?.options.enableWebSearch ?? false;
			let enableReasoning = this.state.enableReasoningToggle && providerEnableReasoning;
			let enableThinking = this.state.enableReasoningToggle && providerEnableThinking;
			const enableWebSearch = this.state.enableWebSearchToggle && providerEnableWebSearch;
			const providerOptions: Record<string, unknown> = {
				...providerOptionsRaw,
				enableReasoning,
				enableThinking,
				enableWebSearch
			};

			// 注入 MCP 工具（根据会话 MCP 模式进行过滤）
			const mcpManager = this.plugin.featureCoordinator.getMcpClientManager();
			const mcpMode = this.state.mcpToolMode;
			if (mcpManager && mcpMode !== 'disabled') {
				try {
					const allMcpTools = await mcpManager.getAvailableToolsWithLazyStart();
					// 按模式过滤工具：auto 全量，manual 仅选中服务器
					const mcpTools = mcpMode === 'manual'
						? allMcpTools.filter((tool) => this.state.mcpSelectedServerIds.includes(tool.serverId))
						: allMcpTools;
					if (mcpTools.length > 0) {
						providerOptions.mcpTools = mcpTools;
						providerOptions.mcpCallTool = (serverId: string, name: string, args: Record<string, unknown>) =>
							mcpManager.callTool(serverId, name, args);
						const maxLoops = mcpManager.getSettings().maxToolCallLoops;
						if (typeof maxLoops === 'number' && maxLoops > 0) {
							providerOptions.mcpMaxToolCallLoops = maxLoops;
						}
					} else {
						const hasEnabledMcpServer = mcpManager.getSettings().servers.some((server) => server.enabled);
						if (hasEnabledMcpServer) {
							this.showMcpNoticeOnce('MCP 已启用，但当前没有可用工具，请检查服务器状态与配置。')
						}
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					this.showMcpNoticeOnce(`MCP 工具初始化失败: ${msg}`)
					DebugLogger.error('[MCP] Chat 注入工具失败', err)
				}
			}

			const vendor = availableVendors.find((item) => item.name === provider.vendor);
			if (!vendor) {
				throw new Error(`无法找到供应商 ${provider.vendor}`);
			}

			// Ollama：根据模型能力禁用不支持的功能，避免请求失败
			if (vendor.name === 'Ollama') {
				const modelName = String((providerOptions as any).model ?? '');
				const baseURL = String((providerOptions as any).baseURL ?? '');
				if (modelName) {
					const caps = await this.getOllamaCapabilities(baseURL, modelName);
					enableReasoning = enableReasoning && caps.reasoning;
					enableThinking = enableThinking && caps.reasoning;
					(providerOptions as any).enableReasoning = enableReasoning;
					(providerOptions as any).enableThinking = enableThinking;
					if (!caps.reasoning) {
						const key = `${this.normalizeOllamaBaseUrl(baseURL)}|${modelName}`;
						const cached = this.ollamaCapabilityCache.get(key);
						if (cached && !cached.warned) {
							this.ollamaCapabilityCache.set(key, { ...cached, warned: true });
							new Notice('已根据 Ollama 模型能力自动关闭不支持的推理功能');
						}
					}
				}
			}

			const sendRequest = vendor.sendRequestFunc(providerOptions);
			const messages = await this.buildProviderMessages(session);
			DebugLogger.logLlmMessages('ChatService.generateAssistantResponse', messages, { level: 'debug' });
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

			// 保存图片附件：与 editor.ts 保持一致，直接使用 Obsidian 内置附件路径解析
			const saveAttachment: SaveAttachment = async (filename: string, data: ArrayBuffer): Promise<void> => {
				const attachmentPath = await this.plugin.app.fileManager.getAvailablePathForAttachment(filename);
				await this.plugin.app.vault.createBinary(attachmentPath, data);
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
					DebugLogger.logLlmResponsePreview('ChatService.generateAssistantResponse', assistantMessage.content, { level: 'debug', previewChars: 100 });
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
				DebugLogger.logLlmResponsePreview('ChatService.generateAssistantResponse', assistantMessage.content, { level: 'debug', previewChars: 100 });
			}

			this.state.isGenerating = false;
			this.controller = null;
			session.updatedAt = Date.now();
			this.emitState();

			// 追加AI回复到文件，而不是重写整个文件
			// 只有在应该保存历史记录且有文件路径时才保存
			if (this.state.shouldSaveHistory && session.filePath) {
				try {
					await this.historyService.appendMessageToFile(session.filePath, assistantMessage);
				} catch (error) {
					console.error('[ChatService] 追加AI回复失败:', error);
					// 不显示错误通知，避免干扰用户
				}
			} else if (this.state.shouldSaveHistory) {
				// 如果没有文件路径但应该保存历史（不应该发生），回退到完整保存
				console.warn('[ChatService] 会话没有文件路径，回退到完整保存');
				try {
					await this.saveActiveSession();
				} catch (error) {
					console.error('[ChatService] 保存AI回复失败:', error);
				}
			}
			// 如果 shouldSaveHistory 为 false，不保存任何历史文件
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

	private showMcpNoticeOnce(message: string): void {
		const now = Date.now()
		if (now - this.lastMcpNoticeAt < 10000) return
		this.lastMcpNoticeAt = now
		new Notice(message, 5000)
	}

	private resolveProvider(): ProviderSettings | null {
		const providers = this.plugin.settings.tars.settings.providers;
		if (!providers.length) return null;
		if (!this.state.selectedModelId) {
			return providers[0];
		}
		return providers.find((provider) => provider.tag === this.state.selectedModelId) ?? providers[0];
	}

	/**
	 * 构建发送给 Provider 的消息列表
	 * @param session 当前会话
	 */
	async buildProviderMessages(session: ChatSession): Promise<ProviderMessage[]> {
		return this.buildProviderMessagesForAgent(session.messages, session, session.systemPrompt);
	}

	/**
	 * 构建 Agent 循环所需的 Provider 消息列表
	 * @param messages 待发送的消息列表
	 * @param session 当前会话
	 * @param systemPrompt 系统提示词
	 */
	async buildProviderMessagesForAgent(messages: ChatMessage[], session: ChatSession, systemPrompt?: string): Promise<ProviderMessage[]> {
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
		let effectiveSystemPrompt: string | undefined = systemPrompt ?? session.systemPrompt;
		const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';

		// 从 Tars 全局设置读取内链解析配置
		const tarsSettings = this.plugin.settings.tars.settings;
		const internalLinkParsing = tarsSettings.internalLinkParsing;

		return await this.messageService.toProviderMessages(messages, {
			contextNotes,
			systemPrompt: effectiveSystemPrompt,
			selectedFiles,
			selectedFolders,
			fileContentOptions,
			parseLinksInTemplates: internalLinkParsing?.parseInTemplates ?? true,
			sourcePath,
			linkParseOptions: {
				enabled: internalLinkParsing?.enabled ?? true,
				maxDepth: internalLinkParsing?.maxDepth ?? 5,
				timeout: internalLinkParsing?.timeout ?? 5000,
				preserveOriginalOnError: true,
				enableCache: true
			}
		});
	}

	getProviders(): ProviderSettings[] {
		return [...this.plugin.settings.tars.settings.providers];
	}
}
