import { MarkdownView, Notice, requestUrl, TFile, TFolder, normalizePath } from 'obsidian';
import { BUILTIN_VAULT_SERVER_ID } from 'src/builtin-mcp/constants';
import FormPlugin from 'src/main';
import {
	clonePlanSnapshot,
	type PlanSnapshot,
} from 'src/builtin-mcp/runtime/plan-state';
import type { ProviderSettings, SaveAttachment } from 'src/features/tars/providers';
import type { Message as ProviderMessage, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { availableVendors, TarsSettings } from 'src/features/tars/settings';
import { isImageGenerationModel } from 'src/features/tars/providers/openRouter';
import { MessageService } from './MessageService';
import { HistoryService, ChatHistoryEntry } from './HistoryService';
import { FileContentService } from './FileContentService';
import type { ChatMessage, ChatSession, ChatSettings, ChatState, McpToolMode, SelectedFile, SelectedFolder } from '../types/chat';
import { DEFAULT_CHAT_SETTINGS } from '../types/chat';
import type { CompareGroup, LayoutMode, MultiModelMode, ParallelResponseGroup } from '../types/multiModel';
import { v4 as uuidv4 } from 'uuid';
import { InternalLinkParserService } from '../../../service/InternalLinkParserService';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptAssembler } from 'src/service/SystemPromptAssembler';
import { arrayBufferToBase64, getMimeTypeFromFilename } from 'src/features/tars/providers/utils';
import type { ToolCall } from '../types/tools';
import { getChatHistoryPath } from 'src/utils/AIPathManager';
import type { MultiModelChatService } from './MultiModelChatService';
import type { MultiModelConfigService } from './MultiModelConfigService';
import { filterMessagesForCompareModel } from '../utils/compareContext';
import { buildEditedUserMessage, getEditableUserMessageContent } from '../utils/userMessageEditing';

type ChatSubscriber = (state: ChatState) => void;

export interface PreparedChatRequest {
	session: ChatSession;
	userMessage: ChatMessage;
	currentSelectedFiles: SelectedFile[];
	currentSelectedFolders: SelectedFolder[];
	originalUserInput: string;
	isImageGenerationIntent: boolean;
	isModelSupportImageGeneration: boolean;
}

export interface GenerateAssistantOptions {
	context?: string;
	taskDescription?: string;
	abortSignal?: AbortSignal;
	onChunk?: (chunk: string, message: ChatMessage) => void;
	executionIndex?: number;
	systemPromptOverride?: string;
	createMessageInSession?: boolean;
	manageGeneratingState?: boolean;
}

const serializePlanSnapshot = (
	snapshot: PlanSnapshot | null | undefined
): string => JSON.stringify(snapshot ?? null);

const isEphemeralContextMessage = (message: ChatMessage): boolean =>
	Boolean(message.metadata?.isEphemeralContext);

const formatPlanTaskForPrompt = (
	task: PlanSnapshot['tasks'][number],
	index: number
): string => {
	const criteria =
		task.acceptance_criteria.length > 0
			? task.acceptance_criteria.join('；')
			: '无';
	const outcome = task.outcome ? `；outcome=${task.outcome}` : '';
	return `${index + 1}. [${task.status}] ${task.name}；acceptance=${criteria}${outcome}`;
};

const isTerminalPlanStatus = (
	status: PlanSnapshot['tasks'][number]['status']
): boolean => status === 'done' || status === 'skipped';

const createPlanSummary = (
	tasks: PlanSnapshot['tasks']
): PlanSnapshot['summary'] => {
	const summary = {
		total: tasks.length,
		todo: 0,
		inProgress: 0,
		done: 0,
		skipped: 0,
	};

	for (const task of tasks) {
		if (task.status === 'todo') summary.todo += 1;
		if (task.status === 'in_progress') summary.inProgress += 1;
		if (task.status === 'done') summary.done += 1;
		if (task.status === 'skipped') summary.skipped += 1;
	}

	return summary;
};

export class ChatService {
	private static readonly LAYOUT_MODE_STORAGE_KEY = 'formify-chat-layout-mode';
	private settings: ChatSettings = DEFAULT_CHAT_SETTINGS;
	private readonly messageService: MessageService;
	private readonly historyService: HistoryService;
	private readonly fileContentService: FileContentService;
	private multiModelService: MultiModelChatService | null = null;
	private multiModelConfigService: MultiModelConfigService | null = null;
	private state: ChatState = {
		activeSession: null,
		isGenerating: false,
		inputValue: '',
		selectedModelId: null,
		selectedModels: [],
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
		mcpToolMode: 'auto',
		mcpSelectedServerIds: [],
		activeCompareGroupId: undefined,
		multiModelMode: 'single',
		parallelResponses: undefined,
		layoutMode: 'horizontal',
	};
	private subscribers: Set<ChatSubscriber> = new Set();
	private controller: AbortController | null = null;
	private ollamaCapabilityCache = new Map<string, { reasoning: boolean; checkedAt: number; warned?: boolean }>();
	private lastMcpNoticeAt = 0;
	private vaultPlanUnsubscribe: (() => void) | null = null;
	private pendingPlanSync: Promise<void> = Promise.resolve();
	// 跟踪当前活动文件的路径
	private currentActiveFilePath: string | null = null;
	// 跟踪在当前活动文件会话期间，用户手动移除的文件路径（仅在当前文件活跃期间有效）
	private manuallyRemovedInCurrentSession: string | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.fileContentService = new FileContentService(plugin.app);
		this.messageService = new MessageService(plugin.app, this.fileContentService);
		this.historyService = new HistoryService(plugin.app, getChatHistoryPath(plugin.settings.aiDataFolder));
	}

	private get app() {
		return this.plugin.app;
	}

	private bindVaultPlanStateSync(): void {
		this.vaultPlanUnsubscribe?.();
		const manager = this.plugin.featureCoordinator.getMcpClientManager();
		if (!manager) {
			return;
		}

		this.vaultPlanUnsubscribe = manager.onVaultPlanChange((snapshot) => {
			const session = this.state.activeSession;
			if (!session) {
				return;
			}

			const nextSnapshot = clonePlanSnapshot(snapshot);
			if (
				serializePlanSnapshot(session.livePlan)
				=== serializePlanSnapshot(nextSnapshot)
			) {
				return;
			}

			session.livePlan = nextSnapshot;
			this.emitState();
			void this.persistSessionPlanFrontmatter(session);
		});
	}

	private async persistSessionPlanFrontmatter(session: ChatSession): Promise<void> {
		if (!this.state.shouldSaveHistory || !session.filePath) {
			return;
		}

		try {
			await this.historyService.updateSessionFrontmatter(session.filePath, {
				livePlan: clonePlanSnapshot(session.livePlan ?? null),
			});
		} catch (error) {
			console.error('[ChatService] 持久化任务计划失败:', error);
		}
	}

	private queueSessionPlanSync(session: ChatSession | null): void {
		this.pendingPlanSync = this.pendingPlanSync
			.catch(() => undefined)
			.then(async () => {
				const manager = this.plugin.featureCoordinator.getMcpClientManager();
				if (!manager) {
					return;
				}
				await manager.syncVaultPlanSnapshot(
					clonePlanSnapshot(session?.livePlan ?? null)
				);
			})
			.catch((error) => {
				console.warn('[ChatService] 同步任务计划失败:', error);
			});
	}

	private async ensurePlanSyncReady(): Promise<void> {
		await this.pendingPlanSync.catch(() => undefined);
	}

	initialize(initialSettings?: Partial<ChatSettings>) {
		this.updateSettings(initialSettings ?? {});

		const persistedLayoutMode = this.readPersistedLayoutMode();
		if (persistedLayoutMode) {
			this.state.layoutMode = persistedLayoutMode;
		}
		if (!this.state.selectedModelId) {
			this.state.selectedModelId = this.getDefaultProviderTag();
		}
		if (this.state.selectedModels.length === 0 && this.state.selectedModelId) {
			this.state.selectedModels = [this.state.selectedModelId];
		}
		if (!this.state.activeSession) {
			this.createNewSession();
		}
		this.bindVaultPlanStateSync();
		this.queueSessionPlanSync(this.state.activeSession);
		this.emitState();
	}

	getState(): ChatState {
		return JSON.parse(JSON.stringify(this.state));
	}

	getActiveSession(): ChatSession | null {
		return this.state.activeSession;
	}

	subscribe(callback: ChatSubscriber): () => void {
		this.subscribers.add(callback);
		callback(this.getState());
		return () => {
			this.subscribers.delete(callback);
		};
	}

	setMultiModelService(service: MultiModelChatService | null) {
		this.multiModelService = service;
	}

	setMultiModelConfigService(service: MultiModelConfigService | null) {
		this.multiModelConfigService = service;
	}

	getMultiModelConfigService(): MultiModelConfigService | null {
		return this.multiModelConfigService;
	}

	notifyStateChange() {
		this.emitState();
	}

	setGeneratingState(isGenerating: boolean) {
		this.state.isGenerating = isGenerating;
		this.emitState();
	}

	setErrorState(error?: string) {
		this.state.error = error;
		this.emitState();
	}

	setParallelResponses(group?: ParallelResponseGroup) {
		this.state.parallelResponses = group;
		this.emitState();
	}

	clearParallelResponses() {
		this.state.parallelResponses = undefined;
		this.emitState();
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
			enableTemplateAsSystemPrompt: false,
			multiModelMode: this.state.multiModelMode,
			activeCompareGroupId: this.state.activeCompareGroupId,
			layoutMode: this.state.layoutMode,
			livePlan: null,
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
		this.state.activeCompareGroupId = undefined;
		this.state.parallelResponses = undefined;
		// 注意：不清空手动移除记录，这是插件级别的持久化数据
		this.emitState();
		this.queueSessionPlanSync(session);
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

	getAutosaveChatEnabled(): boolean {
		return Boolean(this.settings.autosaveChat);
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







	/**
	 * 获取消息服务实例
	 */
	getMessageService(): MessageService {
		return this.messageService;
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
		this.queueSessionPlanSync(this.state.activeSession);
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
		return mcpManager.getEnabledServerSummaries();
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
		if (this.state.multiModelMode === 'single') {
			this.state.selectedModels = tag ? [tag] : [];
		}
		if (this.state.activeSession) {
			this.state.activeSession.modelId = tag;
		}
		this.emitState();
	}

	setSelectedModels(tags: string[]) {
		this.state.selectedModels = Array.from(new Set(tags.filter(Boolean)));
		this.emitState();
	}

	addSelectedModel(tag: string) {
		if (!tag) return;
		this.state.selectedModels = Array.from(new Set([...this.state.selectedModels, tag]));
		this.emitState();
	}

	removeSelectedModel(tag: string) {
		this.state.selectedModels = this.state.selectedModels.filter((item) => item !== tag);
		this.emitState();
	}

	getSelectedModels(): string[] {
		return [...this.state.selectedModels];
	}

	setMultiModelMode(mode: MultiModelMode) {
		this.state.multiModelMode = mode;
		if (mode === 'single' && this.state.selectedModelId) {
			this.state.selectedModels = [this.state.selectedModelId];
		}
		this.syncSessionMultiModelState();
		void this.persistActiveSessionMultiModelFrontmatter();
		this.emitState();
	}

	setLayoutMode(mode: LayoutMode) {
		this.state.layoutMode = mode;
		this.syncSessionMultiModelState();
		this.persistLayoutMode(mode);
		void this.persistActiveSessionMultiModelFrontmatter();
		this.emitState();
	}

	setActiveCompareGroup(groupId?: string) {
		this.state.activeCompareGroupId = groupId;
		this.syncSessionMultiModelState();
		void this.persistActiveSessionMultiModelFrontmatter();
		this.emitState();
	}

	async loadCompareGroups(): Promise<CompareGroup[]> {
		if (!this.multiModelConfigService) {
			return [];
		}
		return this.multiModelConfigService.loadCompareGroups();
	}

	async saveCompareGroup(group: CompareGroup): Promise<string | null> {
		if (!this.multiModelConfigService) {
			return null;
		}
		return this.multiModelConfigService.saveCompareGroup(group);
	}

	async deleteCompareGroup(id: string): Promise<void> {
		if (!this.multiModelConfigService) {
			return;
		}
		await this.multiModelConfigService.deleteCompareGroup(id);
	}

	watchMultiModelConfigs(callback: Parameters<MultiModelConfigService['watchConfigs']>[0]): (() => void) | null {
		if (!this.multiModelConfigService) {
			return null;
		}
		return this.multiModelConfigService.watchConfigs(callback);
	}

	async prepareChatRequest(
		content?: string,
		options?: { skipImageSupportValidation?: boolean }
	): Promise<PreparedChatRequest | null> {
		if (this.state.isGenerating) {
			new Notice('当前已有请求在进行中，请稍候...');
			return null;
		}

		const contentToSend = content ?? this.state.inputValue;
		const inputReferencedImages = await this.resolveImagesFromInputReferences(contentToSend);
		if (inputReferencedImages.length > 0) {
			this.state.selectedImages = this.mergeSelectedImages(this.state.selectedImages, inputReferencedImages);
		}

		const trimmed = contentToSend.trim();
		if (
			!trimmed &&
			this.state.selectedImages.length === 0 &&
			this.state.selectedFiles.length === 0 &&
			this.state.selectedFolders.length === 0
		) {
			return null;
		}

		const originalUserInput = trimmed;
		const isImageGenerationIntent = this.detectImageGenerationIntent(originalUserInput);
		const isModelSupportImageGeneration = this.isCurrentModelSupportImageGeneration();

		if (
			!options?.skipImageSupportValidation &&
			isImageGenerationIntent &&
			!isModelSupportImageGeneration
		) {
			const provider = this.resolveProvider();
			const modelName = provider?.options.model || '当前模型';
			new Notice(`⚠️ 当前模型 (${modelName}) 不支持图像生成功能。

请选择支持图像生成的模型，如：
• google/gemini-2.5-flash-image-preview
• openai/gpt-5-image-mini
• 其他包含 "image" 的模型`, 10000);
			return null;
		}

		const session = this.state.activeSession ?? this.createNewSession();
		this.syncSessionMultiModelState(session);
		session.selectedFiles = [...this.state.selectedFiles];
		session.selectedFolders = [...this.state.selectedFolders];

		const selectedPromptTemplate = this.state.selectedPromptTemplate;
		const useTemplateAsSystemPrompt =
			this.state.enableTemplateAsSystemPrompt &&
			!!selectedPromptTemplate?.content;

		let finalUserMessage = originalUserInput;
		let taskTemplate: string | undefined;

		if (selectedPromptTemplate && !useTemplateAsSystemPrompt) {
			const templateContent = selectedPromptTemplate.content;
			const templateName = selectedPromptTemplate.name;
			finalUserMessage = `${originalUserInput}\n\n[[${templateName}]]`;
			taskTemplate = templateContent;
		}

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

		let messageContent = finalUserMessage;
		if (this.state.selectedFiles.length > 0 || this.state.selectedFolders.length > 0) {
			const fileTags: string[] = [];
			const folderTags: string[] = [];

			for (const file of this.state.selectedFiles) {
				fileTags.push(`[[${file.name}]]`);
			}

			for (const folder of this.state.selectedFolders) {
				folderTags.push(`#${folder.path}`);
			}

			if (fileTags.length > 0 || folderTags.length > 0) {
				const allTags = [...fileTags, ...folderTags].join(' ');
				messageContent += `\n\n${allTags}`;
			}
		}

		const userMessage = this.messageService.createMessage('user', messageContent, {
			images: this.state.selectedImages,
			metadata: {
				taskUserInput: originalUserInput,
				taskTemplate,
				selectedText: this.state.selectedText
			}
		});

		if (messageContent.trim() || this.state.selectedImages.length > 0) {
			session.messages.push(userMessage);
		}
		session.updatedAt = Date.now();
		session.systemPrompt = systemPrompt;
		session.enableTemplateAsSystemPrompt = this.state.enableTemplateAsSystemPrompt;

		const currentSelectedFiles = [...this.state.selectedFiles];
		const currentSelectedFolders = [...this.state.selectedFolders];
		this.state.inputValue = '';
		this.state.selectedImages = [];
		this.state.selectedFiles = [];
		this.state.selectedFolders = [];
		this.state.selectedText = undefined;
		this.state.selectedPromptTemplate = undefined;
		this.emitState();

		if (this.state.shouldSaveHistory) {
			if (session.messages.length === 1 || (systemPrompt && session.messages.length === 2)) {
				try {
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
				try {
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
				}
			}
		}

		return {
			session,
			userMessage,
			currentSelectedFiles,
			currentSelectedFolders,
			originalUserInput,
			isImageGenerationIntent,
			isModelSupportImageGeneration
		};
	}

	async sendMessage(content?: string) {
		const prepared = await this.prepareChatRequest(content, {
			skipImageSupportValidation: this.state.multiModelMode !== 'single'
		});
		if (!prepared) {
			return;
		}
		await this.ensurePlanSyncReady();

		if (this.state.multiModelMode === 'compare') {
			if (!this.multiModelService) {
				new Notice('多模型服务尚未初始化');
				return;
			}
			await this.multiModelService.sendCompareMessage(prepared);
			return;
		}

		if (prepared.isImageGenerationIntent && prepared.isModelSupportImageGeneration) {
			const provider = this.resolveProvider();
			const modelName = provider?.options.model || '当前模型';
			new Notice(`🎨 正在使用模型 ${modelName} 生成图片，请稍候...`);
		}

		const provider = this.resolveProvider();
		if (!provider) {
			new Notice('尚未配置任何AI模型，请先在Tars设置中添加Provider。');
			return;
		}

		await this.generateAssistantResponse(prepared.session);
	}

	stopGeneration() {
		if (this.state.multiModelMode !== 'single' && this.multiModelService) {
			this.multiModelService.stopAllGeneration();
		}
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
		if (this.state.isGenerating) {
			this.state.isGenerating = false;
			this.emitState();
		}
	}

	stopAllGeneration() {
		this.multiModelService?.stopAllGeneration();
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
		if (this.state.isGenerating) {
			this.state.isGenerating = false;
			this.emitState();
		}
	}

	stopModelGeneration(modelTag: string) {
		this.multiModelService?.stopModelGeneration(modelTag);
	}

	async retryModel(messageId: string) {
		if (!this.multiModelService) {
			return;
		}
		await this.multiModelService.retryModel(messageId);
	}

	async retryAllFailed() {
		if (!this.multiModelService) {
			return;
		}
		await this.multiModelService.retryAllFailed();
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
			const restoredMultiModelState = this.restoreMultiModelStateFromSession(session);
			this.state.multiModelMode = restoredMultiModelState.multiModelMode;
			this.state.activeCompareGroupId = restoredMultiModelState.activeCompareGroupId;
			this.state.selectedModels = restoredMultiModelState.selectedModels;
			this.state.layoutMode = restoredMultiModelState.layoutMode;
			this.state.parallelResponses = undefined;
			this.state.enableTemplateAsSystemPrompt = session.enableTemplateAsSystemPrompt;
			// 重置模板选择状态
			this.state.selectedPromptTemplate = undefined;
			this.state.showTemplateSelector = false;
			this.emitState();
			this.queueSessionPlanSync(session);
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
		this.historyService.setFolder(getChatHistoryPath(this.plugin.settings.aiDataFolder));
		if ('autosaveChat' in settings) {
			this.state.shouldSaveHistory = Boolean(this.settings.autosaveChat);
		}
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
		const editedMessage = buildEditedUserMessage(message, content);
		message.content = editedMessage.content;
		message.metadata = editedMessage.metadata;
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
		const editedMessage = buildEditedUserMessage(message, content);
		message.content = editedMessage.content;
		message.metadata = editedMessage.metadata;
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

		// 对比模式：使用多模型服务重新生成
		if (this.state.multiModelMode === 'compare' && this.multiModelService) {
			const editableContent = getEditableUserMessageContent(message);
			const prepared: PreparedChatRequest = {
				session,
				userMessage: message,
				currentSelectedFiles: [...(session.selectedFiles ?? [])],
				currentSelectedFolders: [...(session.selectedFolders ?? [])],
				originalUserInput: editableContent,
				isImageGenerationIntent: this.detectImageGenerationIntent(editableContent),
				isModelSupportImageGeneration: this.isCurrentModelSupportImageGeneration()
			};
			await this.multiModelService.sendCompareMessage(prepared);
			return;
		}

		// 单模型模式：原有逻辑
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

		// 对比模式：始终走多模型重试逻辑，避免误回退到单模型裁剪历史
		if (this.state.multiModelMode === 'compare') {
			await this.multiModelService?.retryModel(messageId);
			return;
		}

		// 单模型模式：原有逻辑
		// 重新生成历史消息时，目标消息及其后的对话都应被移除
		// 否则会残留后续上下文，导致对话历史不一致
		session.messages = session.messages.slice(0, index);
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
			this.state.selectedModels = [];
		} else if (!this.state.selectedModelId) {
			this.state.selectedModelId = tarsSettings.providers[0].tag;
			if (this.state.selectedModels.length === 0) {
				this.state.selectedModels = [tarsSettings.providers[0].tag];
			}
		} else {
			const providerTags = new Set(tarsSettings.providers.map((provider) => provider.tag));
			if (!providerTags.has(this.state.selectedModelId)) {
				this.state.selectedModelId = tarsSettings.providers[0].tag;
			}
			this.state.selectedModels = this.state.selectedModels.filter((tag) => providerTags.has(tag));
			if (this.state.selectedModels.length === 0 && this.state.selectedModelId) {
				this.state.selectedModels = [this.state.selectedModelId];
			}
		}
		this.emitState();
	}

	dispose() {
		this.subscribers.clear();
		this.multiModelService?.stopAllGeneration();
		this.controller?.abort();
		this.controller = null;
		this.vaultPlanUnsubscribe?.();
		this.vaultPlanUnsubscribe = null;
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
	detectImageGenerationIntent(content: string): boolean {
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

	isProviderSupportImageGenerationByTag(modelTag: string): boolean {
		const provider = this.findProviderByTagExact(modelTag);
		return provider ? this.providerSupportsImageGeneration(provider) : false;
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

	async getOllamaCapabilitiesForModel(modelTag: string): Promise<{
		supported: boolean;
		shouldWarn: boolean;
		modelName: string;
	} | null> {
		const provider = this.findProviderByTagExact(modelTag);
		if (!provider || provider.vendor !== 'Ollama' || !this.state.enableReasoningToggle) {
			return null;
		}

		const modelName = String((provider.options as any)?.model ?? provider.tag ?? modelTag);
		const baseURL = String((provider.options as any)?.baseURL ?? '');
		if (!modelName) {
			return null;
		}

		const caps = await this.getOllamaCapabilities(baseURL, modelName);
		const key = `${this.normalizeOllamaBaseUrl(baseURL)}|${modelName}`;
		const cached = this.ollamaCapabilityCache.get(key);
		const shouldWarn = !caps.reasoning && Boolean(cached) && !cached?.warned;
		if (shouldWarn && cached) {
			this.ollamaCapabilityCache.set(key, { ...cached, warned: true });
		}

		return {
			supported: caps.reasoning,
			shouldWarn,
			modelName
		};
	}


	private async generateAssistantResponse(session: ChatSession) {
		const modelTag = this.state.selectedModelId ?? this.getDefaultProviderTag();
		if (!modelTag) {
			new Notice('尚未配置任何AI模型，请先在Tars设置中添加Provider。');
			return;
		}

		try {
			const assistantMessage = await this.generateAssistantResponseForModel(session, modelTag, {
				createMessageInSession: true,
				manageGeneratingState: true
			});

			if (this.state.shouldSaveHistory && session.filePath) {
				try {
					await this.historyService.appendMessageToFile(session.filePath, assistantMessage);
				} catch (error) {
					console.error('[ChatService] 追加AI回复失败:', error);
				}
			} else if (this.state.shouldSaveHistory) {
				console.warn('[ChatService] 会话没有文件路径，回退到完整保存');
				try {
					await this.saveActiveSession();
				} catch (error) {
					console.error('[ChatService] 保存AI回复失败:', error);
				}
			}
		} catch (error) {
			this.handleAssistantGenerationError(session, error);
		}
	}

	async generateAssistantResponseForModel(
		session: ChatSession,
		modelTag: string,
		options?: GenerateAssistantOptions
	): Promise<ChatMessage> {
		const provider = this.findProviderByTagExact(modelTag);
		if (!provider) {
			throw new Error(`未找到模型配置: ${modelTag}`);
		}

		const providerOptionsRaw = (provider.options as any) ?? {};
		const providerEnableReasoning =
			typeof providerOptionsRaw.enableReasoning === 'boolean'
				? providerOptionsRaw.enableReasoning
				: provider.vendor === 'Doubao'
					? ((providerOptionsRaw.thinkingType as string | undefined) ?? 'enabled') !== 'disabled'
					: false;
		const providerEnableThinking = providerOptionsRaw.enableThinking ?? false;
		const providerEnableWebSearch = provider.options.enableWebSearch ?? false;
		let enableReasoning = this.state.enableReasoningToggle && providerEnableReasoning;
		let enableThinking = this.state.enableReasoningToggle && providerEnableThinking;
		const enableWebSearch = this.state.enableWebSearchToggle && providerEnableWebSearch;
		const providerOptions: Record<string, unknown> = {
			...providerOptionsRaw,
			enableReasoning,
			enableThinking,
			enableWebSearch
		};

		if (!enableReasoning && typeof providerOptionsRaw.thinkingType === 'string') {
			providerOptions.thinkingType = 'disabled';
		}

		const mcpManager = this.plugin.featureCoordinator.getMcpClientManager();
		const mcpMode = this.state.mcpToolMode;
		if (mcpManager && mcpMode !== 'disabled') {
			try {
				const allMcpTools = await mcpManager.getAvailableToolsWithLazyStart();
				const mcpTools = mcpMode === 'manual'
					? allMcpTools.filter((tool) => this.state.mcpSelectedServerIds.includes(tool.serverId))
					: allMcpTools;
				let guardedPlanSnapshot = this.hasLivePlan(session)
					? clonePlanSnapshot(session.livePlan ?? null)
					: null;
				if (mcpTools.length > 0) {
					providerOptions.mcpTools = mcpTools;
					providerOptions.mcpCallTool = async (
						serverId: string,
						name: string,
						args: Record<string, unknown>
					) => {
						let shouldRefreshGuardedPlan = false;
						if (
							guardedPlanSnapshot
							&& serverId === BUILTIN_VAULT_SERVER_ID
							&& name === 'write_plan'
						) {
							shouldRefreshGuardedPlan = true;
							if (!this.isPlanRewriteRequest(guardedPlanSnapshot, args)) {
								this.validatePlanContinuationWritePlanArgs(
									guardedPlanSnapshot,
									args
								);
							}
						}

						const result = await mcpManager.callTool(serverId, name, args);
						if (shouldRefreshGuardedPlan) {
							const nextGuardedPlan =
								this.parsePlanSnapshotFromWritePlanResult(result);
							if (nextGuardedPlan) {
								guardedPlanSnapshot = nextGuardedPlan;
							}
						}
						return result;
					};
					const maxLoops = mcpManager.getSettings().maxToolCallLoops;
					if (typeof maxLoops === 'number' && maxLoops > 0) {
						providerOptions.mcpMaxToolCallLoops = maxLoops;
					}
				} else {
					const hasEnabledMcpServer = mcpManager.getSettings().servers.some((server) => server.enabled);
					if (hasEnabledMcpServer) {
						this.showMcpNoticeOnce('MCP 已启用，但当前没有可用工具，请检查服务器状态与配置。');
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.showMcpNoticeOnce(`MCP 工具初始化失败: ${msg}`);
				DebugLogger.error('[MCP] Chat 注入工具失败', err);
			}
		}

		const vendor = availableVendors.find((item) => item.name === provider.vendor);
		if (!vendor) {
			throw new Error(`无法找到供应商 ${provider.vendor}`);
		}

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
		const messages = await this.buildProviderMessagesWithOptions(session, {
			context: options?.context,
			taskDescription: options?.taskDescription,
			systemPrompt: options?.systemPromptOverride,
			modelTag
		});
		DebugLogger.logLlmMessages('ChatService.generateAssistantResponseForModel', messages, { level: 'debug' });

		const assistantMessage = this.messageService.createMessage('assistant', '', {
			modelTag,
			modelName: this.getModelDisplayName(provider),
			taskDescription: options?.taskDescription,
			executionIndex: options?.executionIndex,
			metadata: {
				hiddenFromModel: this.state.multiModelMode !== 'single'
			}
		});

		const shouldAttachToSession = options?.createMessageInSession ?? false;
		const shouldManageGeneratingState = options?.manageGeneratingState ?? true;
		if (shouldAttachToSession) {
			session.messages.push(assistantMessage);
		}
		session.updatedAt = Date.now();
		if (shouldManageGeneratingState) {
			this.state.isGenerating = true;
			this.state.error = undefined;
			this.emitState();
		}

		const requestController = new AbortController();
		const externalSignal = options?.abortSignal;
		const abortListener = () => requestController.abort();
		if (externalSignal) {
			if (externalSignal.aborted) {
				requestController.abort();
			} else {
				externalSignal.addEventListener('abort', abortListener, { once: true });
			}
		}
		if (shouldAttachToSession) {
			this.controller = requestController;
		}

		const resolveEmbed: ResolveEmbedAsBinary = async (embed) => {
			if (embed && (embed as any)[Symbol.for('originalBase64')]) {
				const base64Data = (embed as any)[Symbol.for('originalBase64')] as string;
				return this.base64ToArrayBuffer(base64Data);
			}
			return new ArrayBuffer(0);
		};

		const saveAttachment: SaveAttachment = async (filename: string, data: ArrayBuffer): Promise<void> => {
			const attachmentPath = await this.plugin.app.fileManager.getAvailablePathForAttachment(filename);
			await this.plugin.app.vault.createBinary(attachmentPath, data);
		};

		try {
			const supportsImageGeneration = this.providerSupportsImageGeneration(provider);
			if (supportsImageGeneration) {
				try {
					for await (const chunk of sendRequest(messages, requestController, resolveEmbed, saveAttachment)) {
						assistantMessage.content += chunk;
						session.updatedAt = Date.now();
						options?.onChunk?.(chunk, assistantMessage);
						if (shouldAttachToSession) {
							this.emitState();
						}
					}
				} catch (error) {
					this.rethrowImageGenerationError(error);
				}
			} else {
				for await (const chunk of sendRequest(messages, requestController, resolveEmbed)) {
					assistantMessage.content += chunk;
					session.updatedAt = Date.now();
					options?.onChunk?.(chunk, assistantMessage);
					if (shouldAttachToSession) {
						this.emitState();
					}
				}
			}

			DebugLogger.logLlmResponsePreview('ChatService.generateAssistantResponseForModel', assistantMessage.content, {
				level: 'debug',
				previewChars: 100
			});
			return assistantMessage;
		} finally {
			if (externalSignal) {
				externalSignal.removeEventListener('abort', abortListener);
			}
			if (shouldAttachToSession && this.controller === requestController) {
				this.controller = null;
			}
			if (shouldManageGeneratingState) {
				this.state.isGenerating = false;
			}
			session.updatedAt = Date.now();
			if (shouldManageGeneratingState || shouldAttachToSession) {
				this.emitState();
			}
		}
	}

	private showMcpNoticeOnce(message: string): void {
		const now = Date.now()
		if (now - this.lastMcpNoticeAt < 10000) return
		this.lastMcpNoticeAt = now
		new Notice(message, 5000)
	}

	private handleAssistantGenerationError(session: ChatSession, error: unknown) {
		console.error('[Chat][ChatService] generateAssistantResponse error', error);
		this.state.isGenerating = false;
		this.controller = null;

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
				if (!last.content) {
					last.content = errorMessage;
				}
			}
		}
		this.emitState();
		new Notice(errorMessage, 10000);
	}

	private providerSupportsImageGeneration(provider: ProviderSettings): boolean {
		const vendor = availableVendors.find((item) => item.name === provider.vendor);
		if (!vendor || !vendor.capabilities.includes('Image Generation')) {
			return false;
		}
		if (provider.vendor === 'OpenRouter') {
			return isImageGenerationModel(provider.options.model);
		}
		return true;
	}

	private rethrowImageGenerationError(error: unknown): never {
		if (error instanceof Error) {
			const errorMessage = error.message.toLowerCase();
			if (errorMessage.includes('not support') || errorMessage.includes('modalities') || errorMessage.includes('output_modalities')) {
				throw new Error(`当前模型不支持图像生成功能。

解决方法：
1. 选择支持图像生成的模型，如 google/gemini-2.5-flash-image-preview
2. 在模型设置中确认已启用图像生成功能
3. 检查API密钥是否有图像生成权限`);
			}
			if (errorMessage.includes('content policy') || errorMessage.includes('safety') || errorMessage.includes('inappropriate')) {
				throw new Error(`图像生成请求被内容策略阻止。

解决方法：
1. 修改您的描述，避免敏感内容
2. 使用更中性、通用的描述
3. 尝试不同的描述角度`);
			}
			if (errorMessage.includes('quota') || errorMessage.includes('balance') || errorMessage.includes('insufficient')) {
				throw new Error(`账户配额或余额不足。

解决方法：
1. 检查API账户余额
2. 升级到更高的配额计划
3. 等待配额重置（如果是按天计算）`);
			}
			if (errorMessage.includes('保存图片附件失败')) {
				throw new Error(`图片生成成功，但保存到本地失败。

解决方法：
1. 检查Obsidian附件文件夹权限
2. 确保有足够的磁盘空间
3. 尝试在设置中更改图片保存位置`);
			}
			throw error;
		}
		throw new Error(`图像生成过程中发生未知错误: ${String(error)}`);
	}

	private resolveProvider(): ProviderSettings | null {
		return this.resolveProviderByTag(this.state.selectedModelId ?? undefined);
	}

	resolveProviderByTag(tag?: string): ProviderSettings | null {
		const providers = this.plugin.settings.tars.settings.providers;
		if (!providers.length) return null;
		if (!tag) {
			return providers[0];
		}
		return providers.find((provider) => provider.tag === tag) ?? providers[0];
	}

	findProviderByTagExact(tag?: string): ProviderSettings | null {
		if (!tag) {
			return null;
		}
		return this.plugin.settings.tars.settings.providers.find((provider) => provider.tag === tag) ?? null;
	}

	private getModelDisplayName(provider: ProviderSettings): string {
		return provider.options.model || provider.tag;
	}

	/**
	 * 构建发送给 Provider 的消息列表
	 * @param session 当前会话
	 */
	async buildProviderMessages(session: ChatSession): Promise<ProviderMessage[]> {
		const visibleMessages = session.messages.filter((message) => !message.metadata?.hiddenFromModel);
		return this.buildProviderMessagesForAgent(visibleMessages, session, session.systemPrompt);
	}

	async buildProviderMessagesWithOptions(
		session: ChatSession,
		options?: {
			context?: string;
			taskDescription?: string;
			systemPrompt?: string;
			modelTag?: string;
		}
	): Promise<ProviderMessage[]> {
		const visibleMessages =
			(session.multiModelMode ?? this.state.multiModelMode) === 'compare' && options?.modelTag
				? filterMessagesForCompareModel(session.messages, options.modelTag)
				: session.messages.filter((message) => !message.metadata?.hiddenFromModel);
		const requestMessages = [...visibleMessages];

		if (options?.context || options?.taskDescription) {
			const contextParts: string[] = [];
			if (options.taskDescription) {
				contextParts.push(`当前任务：${options.taskDescription}`);
			}
			if (options.context) {
				contextParts.push(`前一步输出：\n${options.context}`);
			}
			requestMessages.push(this.messageService.createMessage('user', contextParts.join('\n\n'), {
				metadata: {
					hidden: true,
					hiddenFromHistory: true,
					hiddenFromModel: false,
					isEphemeralContext: true
				}
			}));
		}

		const livePlanContext = this.buildLivePlanUserContext(session.livePlan);
		if (livePlanContext) {
			requestMessages.push(
				this.messageService.createMessage('user', livePlanContext, {
					metadata: {
						hidden: true,
						hiddenFromHistory: true,
						hiddenFromModel: false,
						isEphemeralContext: true,
					},
				})
			);
		}

		return this.buildProviderMessagesForAgent(
			requestMessages,
			session,
			options?.systemPrompt ?? session.systemPrompt
		);
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
		const activePlanGuidance = this.buildLivePlanGuidance(session.livePlan);
		if (activePlanGuidance) {
			effectiveSystemPrompt = effectiveSystemPrompt
				? `${effectiveSystemPrompt}\n\n${activePlanGuidance}`
				: activePlanGuidance;
		}
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

	async rewriteSessionMessages(session: ChatSession) {
		if (!this.state.shouldSaveHistory) {
			return;
		}
		this.syncSessionMultiModelState(session);
		if (session.filePath) {
			await this.historyService.rewriteMessagesOnly(session.filePath, session.messages);
			await this.persistSessionMultiModelFrontmatter(session);
			return;
		}
		await this.saveActiveSession();
	}

	private readPersistedLayoutMode(): LayoutMode | null {
		try {
			const raw = window.localStorage.getItem(ChatService.LAYOUT_MODE_STORAGE_KEY);
			if (raw === 'horizontal' || raw === 'tabs' || raw === 'vertical') {
				return raw;
			}
		} catch (error) {
			console.warn('[ChatService] 读取布局偏好失败:', error);
		}
		return null;
	}

	private persistLayoutMode(mode: LayoutMode): void {
		try {
			window.localStorage.setItem(ChatService.LAYOUT_MODE_STORAGE_KEY, mode);
		} catch (error) {
			console.warn('[ChatService] 保存布局偏好失败:', error);
		}
	}

	private hasLivePlan(session: ChatSession): boolean {
		return Boolean(session.livePlan && session.livePlan.summary.total > 0);
	}

	private buildLivePlanGuidance(
		livePlan: PlanSnapshot | null | undefined
	): string | null {
		if (!livePlan || livePlan.summary.total === 0) {
			return null;
		}

		return [
			'当前会话存在一个 livePlan。',
			'你需要根据最新用户消息自行判断：用户是要继续执行当前计划、先调整计划，还是暂时不处理这个计划。',
			'如果用户要继续执行：沿用当前计划，保持计划身份不变，并按顺序逐项推进。',
			'如果用户要调整计划：先调用 write_plan 提交调整后的完整计划，再按新计划执行。',
			'如果用户当前并不是在处理这个计划：不要擅自推进或改写它。',
			'无论是调整计划还是宣称某个任务已完成/已跳过，都必须先用 write_plan 同步计划状态，再输出正文说明。',
		].join('\n');
	}

	private buildLivePlanUserContext(
		livePlan: PlanSnapshot | null | undefined
	): string | null {
		if (!livePlan || livePlan.summary.total === 0) {
			return null;
		}

		const prioritizedTask =
			livePlan.tasks.find((task) => task.status === 'in_progress')
			?? livePlan.tasks.find((task) => task.status === 'todo')
			?? null;

		return [
			'当前会话已有 livePlan。请结合最新用户消息自己判断：是继续原计划、先调整计划，还是忽略这个计划。',
			`计划标题：${livePlan.title}`,
			...(livePlan.description ? [`计划说明：${livePlan.description}`] : []),
			'当前计划任务：',
			...livePlan.tasks.map((task, index) => formatPlanTaskForPrompt(task, index)),
			`当前优先任务：${prioritizedTask?.name ?? '无'}`,
			'如果你决定继续原计划：保持标题、任务名、任务顺序和任务数量不变，并逐项推进。',
			'如果你决定调整计划：先调用 write_plan 提交新的完整计划，再继续执行。',
			'如果你决定暂时不处理这个计划：不要调用 write_plan 去推进它。',
		].join('\n');
	}

	private isPlanRewriteRequest(
		currentPlan: PlanSnapshot,
		args: Record<string, unknown>
	): boolean {
		const nextTitle =
			typeof args.title === 'string' && args.title.trim()
				? args.title.trim()
				: currentPlan.title;
		if (nextTitle !== currentPlan.title) {
			return true;
		}

		const currentDescription = currentPlan.description?.trim() ?? '';
		const nextDescription =
			typeof args.description === 'string' && args.description.trim()
				? args.description.trim()
				: currentDescription;
		if (nextDescription !== currentDescription) {
			return true;
		}

		if (!Array.isArray(args.tasks) || args.tasks.length !== currentPlan.tasks.length) {
			return true;
		}

		return args.tasks.some((taskInput, index) => {
			if (!taskInput || typeof taskInput !== 'object') {
				return false;
			}

			const nextTaskInput = taskInput as Record<string, unknown>;
			const currentTask = currentPlan.tasks[index];
			const nextName = String(nextTaskInput.name ?? '').trim();
			if (nextName !== currentTask.name) {
				return true;
			}

			if (!Array.isArray(nextTaskInput.acceptance_criteria)) {
				return true;
			}

			const nextCriteria = nextTaskInput.acceptance_criteria
				.map((item) => String(item ?? '').trim())
				.filter(Boolean);
			return (
				nextCriteria.length !== currentTask.acceptance_criteria.length
				|| nextCriteria.some(
					(item, criteriaIndex) =>
						item !== currentTask.acceptance_criteria[criteriaIndex]
				)
			);
		});
	}

	private validatePlanContinuationWritePlanArgs(
		currentPlan: PlanSnapshot,
		args: Record<string, unknown>
	): PlanSnapshot {
		const nextTitle =
			typeof args.title === 'string' && args.title.trim()
				? args.title.trim()
				: currentPlan.title;
		if (nextTitle !== currentPlan.title) {
			throw new Error('沿用当前计划推进任务时，write_plan 不允许改标题；如果要改计划，请直接提交新的完整计划。');
		}

		const currentDescription = currentPlan.description?.trim() ?? '';
		const nextDescription =
			typeof args.description === 'string' && args.description.trim()
				? args.description.trim()
				: currentDescription;
		if (nextDescription !== currentDescription) {
			throw new Error('沿用当前计划推进任务时，write_plan 不允许改写计划描述；如果要改计划，请直接提交新的完整计划。');
		}

		if (!Array.isArray(args.tasks) || args.tasks.length !== currentPlan.tasks.length) {
			throw new Error('沿用当前计划推进任务时，write_plan 必须保留原计划的任务数量。');
		}

		const nextTasks = args.tasks.map((taskInput, index) => {
			if (!taskInput || typeof taskInput !== 'object') {
				throw new Error(`沿用当前计划推进任务时，第 ${index + 1} 个任务必须是对象。`);
			}

			const nextTaskInput = taskInput as Record<string, unknown>;
			const currentTask = currentPlan.tasks[index];
			const nextName = String(nextTaskInput.name ?? '').trim();
			if (nextName !== currentTask.name) {
				throw new Error('沿用当前计划推进任务时，write_plan 不允许改任务名称或任务顺序。');
			}

			const nextStatus = nextTaskInput.status;
			if (
				nextStatus !== 'todo'
				&& nextStatus !== 'in_progress'
				&& nextStatus !== 'done'
				&& nextStatus !== 'skipped'
			) {
				throw new Error(`沿用当前计划推进任务时，第 ${index + 1} 个任务状态非法。`);
			}

			if (!Array.isArray(nextTaskInput.acceptance_criteria)) {
				throw new Error(
					'沿用当前计划推进任务时，write_plan 必须完整保留每个任务的 acceptance_criteria。'
				);
			}

			const nextCriteria = nextTaskInput.acceptance_criteria
				.map((item) => String(item ?? '').trim())
				.filter(Boolean);
			if (
				nextCriteria.length !== currentTask.acceptance_criteria.length
				|| nextCriteria.some(
					(item, criteriaIndex) =>
						item !== currentTask.acceptance_criteria[criteriaIndex]
				)
			) {
				throw new Error('沿用当前计划推进任务时，write_plan 不允许改写任务验收标准。');
			}

			const nextOutcome = String(nextTaskInput.outcome ?? '').trim();
			if (isTerminalPlanStatus(nextStatus) && !nextOutcome) {
				throw new Error(`沿用当前计划推进任务时，第 ${index + 1} 个已完成/已跳过任务必须带 outcome。`);
			}

			if (isTerminalPlanStatus(currentTask.status)) {
				if (nextStatus !== currentTask.status) {
					throw new Error('沿用当前计划推进任务时，已完成或已跳过的任务不允许回退。');
				}
				if ((currentTask.outcome ?? '') !== nextOutcome) {
					throw new Error('沿用当前计划推进任务时，已完成或已跳过任务的 outcome 不允许改写。');
				}
			}

			return {
				name: currentTask.name,
				status: nextStatus,
				acceptance_criteria: nextCriteria,
				...(nextOutcome ? { outcome: nextOutcome } : {}),
			};
		});

		const nextPlan: PlanSnapshot = {
			title: currentPlan.title,
			...(currentDescription ? { description: currentDescription } : {}),
			tasks: nextTasks,
			summary: createPlanSummary(nextTasks),
		};

		this.assertContinuePlanProgression(currentPlan, nextPlan);
		return nextPlan;
	}

	private parsePlanSnapshotFromWritePlanResult(result: string): PlanSnapshot | null {
		try {
			const parsed = JSON.parse(result) as Record<string, unknown>;
			if (typeof parsed.title !== 'string' || !Array.isArray(parsed.tasks)) {
				return null;
			}

			const tasks = parsed.tasks.map((taskInput) => {
				if (!taskInput || typeof taskInput !== 'object') {
					throw new Error('invalid task');
				}

				const task = taskInput as Record<string, unknown>;
				const status = task.status;
				if (
					status !== 'todo'
					&& status !== 'in_progress'
					&& status !== 'done'
					&& status !== 'skipped'
				) {
					throw new Error('invalid status');
				}

				const acceptanceCriteria = Array.isArray(task.acceptance_criteria)
					? task.acceptance_criteria.map((item) => String(item ?? '').trim()).filter(Boolean)
					: [];
				const outcome = String(task.outcome ?? '').trim();

				return {
					name: String(task.name ?? '').trim(),
					status,
					acceptance_criteria: acceptanceCriteria,
					...(outcome ? { outcome } : {}),
				};
			});

			const description = String(parsed.description ?? '').trim();
			return {
				title: parsed.title.trim(),
				...(description ? { description } : {}),
				tasks,
				summary: createPlanSummary(tasks),
			};
		} catch {
			return null;
		}
	}

	private assertContinuePlanProgression(
		currentPlan: PlanSnapshot,
		nextPlan: PlanSnapshot
	): void {
		let terminalTransitions = 0;
		let firstNonTerminalIndex = -1;
		let inProgressCount = 0;

		for (let index = 0; index < nextPlan.tasks.length; index += 1) {
			const currentTask = currentPlan.tasks[index];
			const nextTask = nextPlan.tasks[index];

			if (!isTerminalPlanStatus(currentTask.status) && isTerminalPlanStatus(nextTask.status)) {
				terminalTransitions += 1;
			}

			if (!isTerminalPlanStatus(nextTask.status) && firstNonTerminalIndex === -1) {
				firstNonTerminalIndex = index;
			}

			if (nextTask.status === 'in_progress') {
				inProgressCount += 1;
			}
		}

		if (terminalTransitions > 1) {
			throw new Error('沿用当前计划推进任务时，一次 write_plan 只能完成或跳过一个任务。');
		}

		if (inProgressCount > 1) {
			throw new Error('沿用当前计划推进任务时，同一时间只能保留一个 in_progress 任务。');
		}

		if (firstNonTerminalIndex === -1) {
			return;
		}

		for (
			let index = firstNonTerminalIndex + 1;
			index < nextPlan.tasks.length;
			index += 1
		) {
			if (nextPlan.tasks[index].status !== 'todo') {
				throw new Error(
					'沿用当前计划推进任务时，后续任务必须按原顺序保留为 todo，不能提前完成、跳过或启动。'
				);
			}
		}
	}

	private syncSessionMultiModelState(session = this.state.activeSession): void {
		if (!session) {
			return;
		}
		session.multiModelMode = this.state.multiModelMode;
		session.activeCompareGroupId = this.state.activeCompareGroupId;
		session.layoutMode = this.state.layoutMode;
	}

	private async persistActiveSessionMultiModelFrontmatter(): Promise<void> {
		if (!this.state.activeSession?.filePath) {
			return;
		}
		this.syncSessionMultiModelState(this.state.activeSession);
		await this.persistSessionMultiModelFrontmatter(this.state.activeSession);
	}

	private async persistSessionMultiModelFrontmatter(session: ChatSession): Promise<void> {
		if (!session.filePath) {
			return;
		}
		await this.historyService.updateSessionFrontmatter(session.filePath, {
			multiModelMode: session.multiModelMode ?? 'single',
			activeCompareGroupId: session.activeCompareGroupId,
			layoutMode: session.layoutMode ?? this.state.layoutMode
		});
	}

	private restoreMultiModelStateFromSession(session: ChatSession): {
		multiModelMode: MultiModelMode;
		activeCompareGroupId?: string;
		selectedModels: string[];
		layoutMode: LayoutMode;
	} {
		const selectedModels = Array.from(
			new Set(
				session.messages
					.filter((message) => message.role === 'assistant' && message.modelTag)
					.map((message) => message.modelTag!)
			)
		);
		const hasParallelGroup = session.messages.some((message) => Boolean(message.parallelGroupId));
		const inferredMode: MultiModelMode = hasParallelGroup
			? 'compare'
			: 'single';
		const multiModelMode = session.multiModelMode ?? inferredMode;
		const layoutMode = session.layoutMode ?? this.readPersistedLayoutMode() ?? this.state.layoutMode;

		return {
			multiModelMode,
			activeCompareGroupId: session.activeCompareGroupId,
			selectedModels: multiModelMode === 'single'
				? [session.modelId || this.getDefaultProviderTag() || ''].filter(Boolean)
				: selectedModels,
			layoutMode
		};
	}
}
