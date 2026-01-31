import { WorkspaceLeaf, Notice, TFile, MarkdownView } from 'obsidian';
import { Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import FormPlugin from 'src/main';
import { ChatService } from './services/ChatService';
import { ChatView, VIEW_TYPE_CHAT_SIDEBAR, VIEW_TYPE_CHAT_TAB } from './views/ChatView';
import { ChatModal } from './views/ChatModal';
import { ChatPersistentModal } from './views/ChatPersistentModal';
import { createChatTriggerExtension, updateChatTriggerSettings } from './trigger/ChatTriggerExtension';
import {
	createSelectionToolbarExtension,
	updateSelectionToolbarSettings,
	SelectionInfo,
	getContentWithoutFrontmatter,
	setTriggerSource,
	setToolbarVisible
} from './selection-toolbar/SelectionToolbarExtension';
import { SkillExecutionService } from './selection-toolbar/SkillExecutionService';
import { SkillDataService } from './selection-toolbar/SkillDataService';
import type { ChatSettings, ChatOpenMode, Skill } from './types/chat';
import type { TarsSettings } from '../tars/settings';
import { localInstance } from 'src/i18n/locals';
import { createRoot, Root } from 'react-dom/client';
import { StrictMode } from 'react';
import { SelectionToolbar } from './selection-toolbar/SelectionToolbar';
import { SkillResultModal } from './selection-toolbar/SkillResultModal';
import type { ChatMessage } from './types/chat';
import { PromptBuilder } from 'src/service/PromptBuilder';
import { SystemPromptAssembler } from 'src/service/SystemPromptAssembler';
import { DebugLogger } from 'src/utils/DebugLogger';
import { ModifyTextModal } from './selection-toolbar/ModifyTextModal';
import { createModifyGhostTextExtension, setModifyGhostEffect } from './selection-toolbar/ModifyGhostTextExtension';
import { availableVendors } from '../tars/settings';
import type { Message, ProviderSettings } from '../tars/providers';
import { buildProviderOptionsWithReasoningDisabled } from '../tars/providers/utils';

export class ChatFeatureManager {
	private readonly service: ChatService;
	private ribbonEl: HTMLElement | null = null;
	private chatTriggerExtension: Extension | null = null;
	private selectionToolbarExtension: Extension | null = null;
	private skillExecutionService: SkillExecutionService | null = null;
	private skillDataService: SkillDataService | null = null;
	private cachedSkills: Skill[] = []; // 缓存的技能列表

	// 选区工具栏 React 组件容器
	private toolbarContainer: HTMLElement | null = null;
	private toolbarRoot: Root | null = null;
	private currentSelectionInfo: SelectionInfo | null = null;
	private currentEditorView: EditorView | null = null;
	private isToolbarVisible = false;
	private currentTriggerSymbolRange: { from: number; to: number } | null = null; // 记录触发符号位置
	private modifyModalContainer: HTMLElement | null = null;
	private modifyModalRoot: Root | null = null;
	private isModifyModalVisible = false;
	private selectedModifyModelTag = '';
	private pendingModifyContext: {
		triggerSource: 'selection' | 'symbol';
		anchorCoords?: SelectionInfo['coords'];
		contentForAI: string;
		replaceFrom: number;
		replaceTo: number;
		ghostPos: number;
	} | null = null;
	private modifyGhostExtensions: Extension[] = [];

	// 技能结果模态框状态
	private resultModalContainer: HTMLElement | null = null;
	private resultModalRoot: Root | null = null;
	private currentIsLoading: boolean = false;
	private currentRenderModal: (() => void) | null = null;
	private isResultModalVisible: boolean = false;
	private selectedSkillModelTag: string = ''; // 当前技能执行的模型选择
	private currentResult: string = ''; // 当前执行结果
	private currentError: string | undefined = undefined; // 当前错误信息

	// 持久化模态框单例
	private persistentModal: ChatPersistentModal | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.service = new ChatService(plugin);
	}

	async initialize(initialSettings?: Partial<ChatSettings>) {
		this.service.initialize(initialSettings);
		this.registerViews();
		this.registerCommands();
		this.createRibbon();
		this.registerChatTriggerExtension();
		this.registerSelectionToolbarExtension();
		this.registerModifyGhostTextExtension();
		this.initializeSkillExecutionService();
		await this.initializeSkillDataService(initialSettings);

		// 延迟自动打开聊天界面，确保工作区完全准备好
		const shouldAutoOpen = initialSettings?.showSidebarByDefault ?? this.plugin.settings.chat.showSidebarByDefault;
		if (shouldAutoOpen) {
			// 使用 setTimeout 确保在下一个事件循环中执行
			const openMode = initialSettings?.openMode ?? this.plugin.settings.chat.openMode;
			setTimeout(() => {
				void this.activateChatView(openMode);
			}, 300);
		}
	}

	private registerModifyGhostTextExtension() {
		this.modifyGhostExtensions = createModifyGhostTextExtension();
		this.plugin.registerEditorExtension(this.modifyGhostExtensions);
	}

	updateChatSettings(settings: Partial<ChatSettings>) {
		this.service.updateSettings(settings);
		
		// 如果设置了功能区图标显示状态，则更新图标
		if ('showRibbonIcon' in settings) {
			this.updateRibbonIcon(settings.showRibbonIcon ?? false);
		}

		// 如果触发设置变化，更新编辑器扩展
		if ('enableChatTrigger' in settings || 'chatTriggerSymbol' in settings) {
			this.updateChatTriggerExtension();
		}

		// 如果划词工具栏设置变化，更新选区工具栏扩展
		if ('enableSelectionToolbar' in settings || 'maxToolbarButtons' in settings || 'skills' in settings) {
			this.updateSelectionToolbarExtension();
		}
	}

	updateProviderSettings(settings: TarsSettings) {
		void this.service.refreshProviderSettings(settings);
	}

	getService(): ChatService {
		return this.service;
	}

	/**
	 * 刷新技能缓存
	 */
	async refreshSkillsCache(): Promise<void> {
		if (this.skillDataService) {
			this.cachedSkills = await this.skillDataService.getSortedSkills();
			DebugLogger.debug('[ChatFeatureManager] 技能缓存已刷新，共', this.cachedSkills.length, '个技能');
		}
	}

	/**
	 * 查找已存在的指定类型的视图
	 * @param viewType 视图类型
	 * @returns 已存在的视图 leaf，如果不存在则返回 null
	 */
	private findExistingView(viewType: string): WorkspaceLeaf | null {
		let existingLeaf: WorkspaceLeaf | null = null;

		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() === viewType) {
				existingLeaf = leaf;
				return true; // 停止迭代
			}
			return false;
		});

		return existingLeaf;
	}

	async activateChatView(mode: ChatOpenMode) {
		try {
			if (mode === 'window') {
				// 在新窗口中打开 - 首先检查是否已存在
				const existingLeaf = this.findExistingView(VIEW_TYPE_CHAT_TAB);
				if (existingLeaf) {
					// 如果已存在，聚焦该窗口
					this.plugin.app.workspace.revealLeaf(existingLeaf);
				} else {
					await this.openInWindow();
				}
			} else if (mode === 'persistent-modal') {
				// 打开持久化模态框
				this.openChatInPersistentModal();
			} else if (mode === 'sidebar') {
				// 添加延迟确保工作区完全加载
				await this.waitForWorkspaceReady();

				// 首先检查是否已存在侧边栏视图
				const existingLeaf = this.findExistingView(VIEW_TYPE_CHAT_SIDEBAR);
				if (existingLeaf) {
					// 如果已存在，聚焦该视图
					this.plugin.app.workspace.revealLeaf(existingLeaf);
				} else {
					// 创建新的侧边栏视图
					const leaf = this.plugin.app.workspace.getRightLeaf(false);
					if (!leaf) {
						console.warn('FormFlow Chat: 无法获取右侧边栏，可能工作区还未完全初始化');
						// 尝试使用左侧边栏作为备选方案
						const leftLeaf = this.plugin.app.workspace.getLeftLeaf(false);
						if (leftLeaf) {
							await this.openLeaf(leftLeaf, VIEW_TYPE_CHAT_SIDEBAR, true);
						}
						return;
					}
					await this.openLeaf(leaf, VIEW_TYPE_CHAT_SIDEBAR, true);
				}
			} else if (mode === 'left-sidebar') {
				// 添加延迟确保工作区完全加载
				await this.waitForWorkspaceReady();

				// 首先检查是否已存在侧边栏视图
				const existingLeaf = this.findExistingView(VIEW_TYPE_CHAT_SIDEBAR);
				if (existingLeaf) {
					// 如果已存在，聚焦该视图
					this.plugin.app.workspace.revealLeaf(existingLeaf);
				} else {
					// 创建新的左侧边栏视图
					const leaf = this.plugin.app.workspace.getLeftLeaf(false);
					if (!leaf) {
						console.warn('FormFlow Chat: 无法获取左侧边栏，可能工作区还未完全初始化');
						// 尝试使用右侧边栏作为备选方案
						const rightLeaf = this.plugin.app.workspace.getRightLeaf(false);
						if (rightLeaf) {
							await this.openLeaf(rightLeaf, VIEW_TYPE_CHAT_SIDEBAR, true);
						}
						return;
					}
					await this.openLeaf(leaf, VIEW_TYPE_CHAT_SIDEBAR, true);
				}
			} else {
				// tab mode - 首先检查是否已存在标签页视图
				const existingLeaf = this.findExistingView(VIEW_TYPE_CHAT_TAB);
				if (existingLeaf) {
					// 如果已存在，聚焦该标签页
					this.plugin.app.workspace.revealLeaf(existingLeaf);
				} else {
					// 创建新的标签页视图
					const leaf = this.plugin.app.workspace.getLeaf(true);
					await this.openLeaf(leaf, VIEW_TYPE_CHAT_TAB, true);
				}
			}
		} catch (error) {
			console.error('FormFlow Chat: 激活聊天视图失败:', error);
		}
	}

	dispose() {
		this.ribbonEl?.remove();
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT_SIDEBAR);
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT_TAB);
		this.service.dispose();

		// 清理选区工具栏
		this.hideSelectionToolbar();
		this.hideResultModal();

		// 清理持久化模态框
		if (this.persistentModal) {
			this.persistentModal.close();
			this.persistentModal = null;
		}
	}

	/**
	 * 在模态框中打开 AI Chat
	 * @param activeFile 当前活动的文件（可选）
	 */
	openChatInModal(activeFile?: TFile | null) {
		const settings = this.plugin.settings.chat;

		// 检查是否有活动的 Markdown 文件
		const file = activeFile ?? this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			new Notice(localInstance.chat_trigger_no_active_file);
			return;
		}

		// 创建并打开模态框
		const modal = new ChatModal(
			this.plugin.app,
			this.service,
			{
				width: settings.chatModalWidth ?? 700,
				height: settings.chatModalHeight ?? 500,
				activeFile: file
			}
		);
		modal.open();
	}

	/**
	 * 在持久化模态框中打开 AI Chat
	 * 与临时模态框的区别:保存历史、不创建新会话、与侧边栏共享会话
	 * 使用单例模式，确保同一时间只有一个持久化模态框实例
	 * @param activeFile 当前活动的文件（可选）
	 */
	openChatInPersistentModal(activeFile?: TFile | null) {
		// 如果已存在持久化模态框，聚焦它并更新当前文件
		if (this.persistentModal) {
			this.persistentModal.focus();

			// 如果指定了新的活动文件，更新上下文
			const file = activeFile ?? this.plugin.app.workspace.getActiveFile();
			if (file) {
				this.service.addActiveFile(file);
			}
			return;
		}

		// 创建新的持久化模态框
		const settings = this.plugin.settings.chat;
		const file = activeFile ?? this.plugin.app.workspace.getActiveFile();

		this.persistentModal = new ChatPersistentModal(
			this.plugin.app,
			this.service,
			{
				width: settings.chatModalWidth ?? 700,
				height: settings.chatModalHeight ?? 500,
				activeFile: file,
				onClose: () => {
					// 模态框关闭时清除引用
					this.persistentModal = null;
				}
			}
		);
		this.persistentModal.open();
	}

	/**
	 * 注册 Chat 触发编辑器扩展
	 */
	private registerChatTriggerExtension() {
		const settings = this.plugin.settings.chat;

		// 更新全局设置
		updateChatTriggerSettings(settings);

		// 创建编辑器扩展
		this.chatTriggerExtension = createChatTriggerExtension(
			this.plugin.app,
			settings,
			{
				onShowToolbar: (view, activeFile, symbolRange) => {
					this.showToolbarBySymbol(view, activeFile, symbolRange);
				}
			}
		);

		// 注册扩展到 Obsidian
		this.plugin.registerEditorExtension(this.chatTriggerExtension);
	}

	/**
	 * 更新 Chat 触发编辑器扩展
	 */
	private updateChatTriggerExtension() {
		const settings = this.plugin.settings.chat;
		
		// 更新全局设置
		updateChatTriggerSettings(settings);
		
		// 通知工作区更新编辑器选项
		this.plugin.app.workspace.updateOptions();
	}

	/**
	 * 初始化技能执行服务
	 */
	private initializeSkillExecutionService() {
		this.skillExecutionService = new SkillExecutionService(
			this.plugin.app,
			() => this.plugin.settings.tars.settings,
			() => this.plugin.settings.promptTemplateFolder || 'System/ai prompts'
		);
	}

	/**
	 * 初始化技能数据服务并执行数据迁移
	 */
	private async initializeSkillDataService(initialSettings?: Partial<ChatSettings>) {
		try {
			this.skillDataService = SkillDataService.getInstance(this.plugin.app);
			await this.skillDataService.initialize();

			// 执行数据迁移：从旧设置迁移技能数据到独立文件
			const legacySkills = initialSettings?.skills ?? this.plugin.settings.chat.skills ?? [];
			await this.skillDataService.migrateFromSettings(legacySkills);

			// 加载技能到缓存
			this.cachedSkills = await this.skillDataService.getSortedSkills();

			DebugLogger.debug('[ChatFeatureManager] 技能数据服务初始化完成，已加载', this.cachedSkills.length, '个技能');
		} catch (error) {
			DebugLogger.error('[ChatFeatureManager] 技能数据服务初始化失败', error);
		}
	}

	/**
	 * 注册选区工具栏编辑器扩展
	 */
	private registerSelectionToolbarExtension() {
		const settings = this.plugin.settings.chat;

		// 更新全局设置
		updateSelectionToolbarSettings(settings);

		// 创建编辑器扩展
		this.selectionToolbarExtension = createSelectionToolbarExtension(
			this.plugin.app,
			settings,
			{
				onShowToolbar: (info, view, activeFile) => {
					this.showSelectionToolbar(info, view, activeFile);
				},
				onHideToolbar: () => {
					this.hideSelectionToolbar();
				}
			}
		);

		// 注册扩展到 Obsidian
		this.plugin.registerEditorExtension(this.selectionToolbarExtension);
	}

	/**
	 * 更新选区工具栏编辑器扩展
	 */
	private updateSelectionToolbarExtension() {
		const settings = this.plugin.settings.chat;
		
		// 更新全局设置
		updateSelectionToolbarSettings(settings);
		
		// 如果工具栏当前可见，重新渲染
		if (this.isToolbarVisible && this.currentSelectionInfo) {
			this.renderToolbar();
		}
		
		// 通知工作区更新编辑器选项
		this.plugin.app.workspace.updateOptions();
	}

	/**
	 * 显示选区工具栏
	 */
	private showSelectionToolbar(info: SelectionInfo, view: EditorView, activeFile: TFile | null) {
		this.currentSelectionInfo = info;
		this.currentEditorView = view;
		this.isToolbarVisible = true;

		// 设置全局状态
		setToolbarVisible(true);

		// 创建工具栏容器（如果不存在）
		if (!this.toolbarContainer) {
			this.toolbarContainer = document.createElement('div');
			this.toolbarContainer.className = 'selection-toolbar-container';
			document.body.appendChild(this.toolbarContainer);
			this.toolbarRoot = createRoot(this.toolbarContainer);
		}

		this.renderToolbar();
	}

	/**
	 * 通过符号触发显示工具栏
	 */
	private showToolbarBySymbol(view: EditorView, activeFile: TFile | null, symbolRange?: { from: number; to: number }) {
		// 记录触发符号位置和 EditorView
		if (symbolRange) {
			this.currentTriggerSymbolRange = symbolRange;
		}
		this.currentEditorView = view;

		// 设置全局触发来源和可见状态
		setTriggerSource('symbol');
		setToolbarVisible(true);

		// 获取完整文本（不包括 frontmatter）
		const fullText = getContentWithoutFrontmatter(this.plugin.app);

		// 获取光标位置
		const cursorPos = view.state.selection.main.head;

		// 获取光标位置的屏幕坐标
		const coords = view.coordsAtPos(cursorPos);
		if (!coords) {
			return;
		}

		// 创建 SelectionInfo
		const selectionInfo: SelectionInfo = {
			text: '', // 符号触发时没有选中文本
			fullText: fullText, // 完整文本（不包括 frontmatter）
			from: cursorPos,
			to: cursorPos,
			coords: {
				top: coords.top,
				left: coords.left,
				right: coords.right,
				bottom: coords.bottom
			},
			triggerSource: 'symbol', // 通过符号触发
			triggerSymbolRange: symbolRange // 记录触发符号位置
		};

		this.showSelectionToolbar(selectionInfo, view, activeFile);
	}

	/**
	 * 渲染工具栏组件
	 */
	private renderToolbar() {
		if (!this.toolbarRoot || !this.currentSelectionInfo) {
			return;
		}

		const settings = this.plugin.settings.chat;
		// 使用缓存的技能列表，不从 settings 中获取
		const settingsWithCachedSkills = { ...settings, skills: this.cachedSkills };

		const { triggerSource, fullText } = this.currentSelectionInfo;

		this.toolbarRoot.render(
			<StrictMode>
				<SelectionToolbar
					visible={this.isToolbarVisible}
					selectionInfo={this.currentSelectionInfo}
					settings={settingsWithCachedSkills}
					onOpenChat={(selection) => this.openChatWithSelection(selection, triggerSource, fullText)}
					onModify={() => this.openModifyModal(triggerSource, fullText)}
					onCopy={() => this.copySelection()}
					onCut={() => this.cutSelection()}
					onExecuteSkill={(skill, selection) => this.executeSkill(skill, selection, triggerSource, fullText)}
					onClose={() => this.hideSelectionToolbar()}
				/>
			</StrictMode>
		);
	}

	/**
	 * 隐藏选区工具栏
	 */
	private hideSelectionToolbar() {
		this.isToolbarVisible = false;
		this.currentSelectionInfo = null;
		this.currentTriggerSymbolRange = null; // 清除触发符号位置
		this.currentEditorView = null; // 清除 EditorView 引用

		// 清除全局状态
		setToolbarVisible(false);
		setTriggerSource(null);

		if (this.toolbarRoot) {
			const settings = this.plugin.settings.chat;
			const settingsWithCachedSkills = { ...settings, skills: this.cachedSkills };

			this.toolbarRoot.render(
				<StrictMode>
					<SelectionToolbar
						visible={false}
						selectionInfo={null}
						settings={settingsWithCachedSkills}
						onOpenChat={() => {}}
						onModify={() => {}}
						onCopy={() => {}}
						onCut={() => {}}
						onExecuteSkill={() => {}}
						onClose={() => {}}
					/>
				</StrictMode>
			);
		}
	}

	/**
	 * 复制选中的文本
	 */
	private copySelection() {
		if (!this.currentSelectionInfo || !this.currentSelectionInfo.text) {
			return;
		}

		const text = this.currentSelectionInfo.text;
		navigator.clipboard.writeText(text).then(() => {
			new Notice('已复制到剪贴板');
		}).catch(() => {
			new Notice('复制失败');
		});

		this.hideSelectionToolbar();
	}

	/**
	 * 剪切选中的文本
	 */
	private cutSelection() {
		if (!this.currentEditorView || !this.currentSelectionInfo) {
			return;
		}

		const { from, to, text } = this.currentSelectionInfo;
		const editorView = this.currentEditorView;

		// 复制到剪贴板
		navigator.clipboard.writeText(text).then(() => {
			// 删除选中的文本
			editorView.dispatch({
				changes: {
					from,
					to,
					insert: ''
				}
			});
			new Notice('已剪切到剪贴板');
			this.hideSelectionToolbar();
		}).catch(() => {
			new Notice('剪切失败');
			this.hideSelectionToolbar();
		});
	}

	private getFrontmatterLength(docText: string): number {
		const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
		const match = docText.match(frontmatterRegex);
		return match ? match[0].length : 0;
	}

	private resolveProviders(): ProviderSettings[] {
		return (this.plugin.settings.tars?.settings?.providers ?? []) as ProviderSettings[];
	}

	private resolveDefaultModifyModelTag(providers: ProviderSettings[]): string {
		const fromChat = this.plugin.settings.chat?.defaultModel ?? '';
		if (fromChat && providers.some(p => p.tag === fromChat)) {
			return fromChat;
		}
		return providers[0]?.tag ?? '';
	}

	private openModifyModal(triggerSource?: 'selection' | 'symbol', fullText?: string) {
		if (!this.currentEditorView || !this.currentSelectionInfo) {
			return;
		}

		const view = this.currentEditorView;
		const selectionInfo = this.currentSelectionInfo;
		const source = triggerSource ?? selectionInfo.triggerSource;

		// 符号触发：点击任何操作后需删除触发符号
		if (source === 'symbol' && this.currentTriggerSymbolRange && this.currentEditorView) {
			this.deleteTriggerSymbol();
		}

		// 隐藏工具栏，但保留 editor 引用用于后续展示灰字
		this.hideSelectionToolbar();
		this.currentEditorView = view;

		const docText = view.state.doc.toString();
		const frontmatterLen = this.getFrontmatterLength(docText);
		const bodyStart = frontmatterLen;
		const docEnd = view.state.doc.length;

		const providers = this.resolveProviders();
		this.selectedModifyModelTag = this.selectedModifyModelTag || this.resolveDefaultModifyModelTag(providers);

		if (!this.selectedModifyModelTag) {
			this.selectedModifyModelTag = this.resolveDefaultModifyModelTag(providers);
		}

		if (source === 'selection') {
			this.pendingModifyContext = {
				triggerSource: 'selection',
				anchorCoords: selectionInfo.coords,
				contentForAI: selectionInfo.text,
				replaceFrom: selectionInfo.from,
				replaceTo: selectionInfo.to,
				ghostPos: selectionInfo.to
			};
		} else {
			this.pendingModifyContext = {
				triggerSource: 'symbol',
				anchorCoords: selectionInfo.coords,
				contentForAI: fullText ?? getContentWithoutFrontmatter(this.plugin.app),
				replaceFrom: bodyStart,
				replaceTo: docEnd,
				ghostPos: docEnd
			};
		}

		this.showModifyModal();
	}

	private showModifyModal() {
		if (!this.modifyModalContainer) {
			this.modifyModalContainer = document.createElement('div');
			this.modifyModalContainer.className = 'modify-text-modal-container';
			document.body.appendChild(this.modifyModalContainer);
			this.modifyModalRoot = createRoot(this.modifyModalContainer);
		}
		this.isModifyModalVisible = true;
		this.renderModifyModal();
	}

	private hideModifyModal() {
		this.isModifyModalVisible = false;
		this.renderModifyModal();
	}

	private renderModifyModal() {
		if (!this.modifyModalRoot) {
			return;
		}
		const providers = this.resolveProviders();
		const anchorCoords = this.pendingModifyContext?.anchorCoords;
		this.modifyModalRoot.render(
			<StrictMode>
				<ModifyTextModal
					visible={this.isModifyModalVisible}
					providers={providers}
					selectedModelTag={this.selectedModifyModelTag}
					anchorCoords={anchorCoords}
					onChangeModel={(tag) => {
						this.selectedModifyModelTag = tag;
						this.renderModifyModal();
					}}
					onSend={(instruction) => {
						this.hideModifyModal();
						void this.executeModifyRequest(instruction);
					}}
					onClose={() => this.hideModifyModal()}
				/>
			</StrictMode>
		);
	}

	private async executeModifyRequest(instruction: string) {
		if (!this.currentEditorView) {
			return;
		}
		const ctx = this.pendingModifyContext;
		if (!ctx) {
			return;
		}

		// 让编辑器重新获得焦点，并将光标折叠到灰字展示位置
		try {
			this.currentEditorView.focus();
			this.currentEditorView.dispatch({
				selection: { anchor: ctx.ghostPos },
				annotations: Transaction.userEvent.of('modify-ghost-internal')
			});
		} catch {
			// ignore
		}

		const providers = this.resolveProviders();
		const provider = providers.find(p => p.tag === this.selectedModifyModelTag) ?? providers[0];
		if (!provider) {
			new Notice('尚未配置AI模型');
			return;
		}

		try {
			this.currentEditorView.dispatch({
				effects: setModifyGhostEffect.of({
					text: '生成中...',
					pos: ctx.ghostPos,
					replaceFrom: ctx.replaceFrom,
					replaceTo: ctx.replaceTo,
					isLoading: true
				}),
				annotations: Transaction.userEvent.of('modify-ghost-internal')
			});

			const result = await this.requestModifyText(provider, instruction, ctx.contentForAI);
			if (!result.trim()) {
				new Notice('AI 未返回可用内容');
				return;
			}

			this.currentEditorView.dispatch({
				effects: setModifyGhostEffect.of({
					text: result,
					pos: ctx.ghostPos,
					replaceFrom: ctx.replaceFrom,
					replaceTo: ctx.replaceTo,
					isLoading: false
				})
			});
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async requestModifyText(provider: ProviderSettings, instruction: string, content: string): Promise<string> {
		const vendor = availableVendors.find(v => v.name === provider.vendor);
		if (!vendor) {
			throw new Error(`未知的模型供应商: ${provider.vendor}`);
		}

		const assembler = new SystemPromptAssembler(this.plugin.app);
		const globalSystemPrompt = (await assembler.buildGlobalSystemPrompt('selection_toolbar')).trim();

		const userInstruction = `任务：根据用户指令修改输入文本。\n\n规则：\n1. 仅输出修改后的最终文本，不要解释\n2. 保持原文语言\n3. 保留 Markdown 结构（如有）\n\n用户指令：\n${instruction}`;

		const taskMessage: ChatMessage = {
			id: 'modify-task',
			role: 'user',
			content: userInstruction,
			timestamp: Date.now(),
			images: [],
			isError: false,
			metadata: {
				taskUserInput: instruction,
				taskTemplate: null,
				selectedText: content
			}
		};

		const promptBuilder = new PromptBuilder(this.plugin.app);
		const sourcePath = this.plugin.app.workspace.getActiveFile()?.path ?? '';
		const messages: Message[] = await promptBuilder.buildChatProviderMessages([taskMessage], {
			systemPrompt: globalSystemPrompt.length > 0 ? globalSystemPrompt : undefined,
			sourcePath,
			parseLinksInTemplates: false,
			linkParseOptions: {
				enabled: false,
				maxDepth: 1,
				timeout: 1,
				preserveOriginalOnError: true,
				enableCache: true
			},
			maxHistoryRounds: 0
		});

		const controller = new AbortController();
		const resolveEmbed = async () => new ArrayBuffer(0);
		// 禁用推理功能
		const providerOptions = buildProviderOptionsWithReasoningDisabled(
			provider.options,
			provider.vendor
		);
		const sendRequest = vendor.sendRequestFunc(providerOptions);
		DebugLogger.logLlmMessages('ChatFeatureManager.requestModifyText', messages, { level: 'debug' });
		let output = '';
		for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
			output += chunk;
			if (controller.signal.aborted) {
				break;
			}
		}
		DebugLogger.logLlmResponsePreview('ChatFeatureManager.requestModifyText', output, { level: 'debug', previewChars: 100 });
		return output.trim();
	}

	/**
	 * 删除触发符号
	 */
	private deleteTriggerSymbol() {
		if (!this.currentTriggerSymbolRange || !this.currentEditorView) {
			return;
		}

		const { from, to } = this.currentTriggerSymbolRange;

		// 删除触发符号
		this.currentEditorView.dispatch({
			changes: {
				from,
				to,
				insert: ''
			}
		});

		// 清除触发符号位置
		this.currentTriggerSymbolRange = null;
	}

	/**
	 * 携带选中文本打开 AI Chat
	 */
	private openChatWithSelection(selection: string, triggerSource?: 'selection' | 'symbol', fullText?: string) {
		// 如果是符号触发，删除触发符号
		if (triggerSource === 'symbol' && this.currentTriggerSymbolRange && this.currentEditorView) {
			this.deleteTriggerSymbol();
		}

		this.hideSelectionToolbar();

		const settings = this.plugin.settings.chat;
		const activeFile = this.plugin.app.workspace.getActiveFile();

		// 根据触发来源决定传递给 ChatModal 的内容
		// 符号触发：传递完整文本（不包括 frontmatter）
		// 选中文本触发：传递选中的文本
		const initialSelection = triggerSource === 'symbol' ? (fullText || selection) : selection;

		// 创建并打开模态框
		const modal = new ChatModal(
			this.plugin.app,
			this.service,
			{
				width: settings.chatModalWidth ?? 700,
				height: settings.chatModalHeight ?? 500,
				activeFile: activeFile,
				initialSelection: initialSelection
			}
		);
		modal.open();
	}

	/**
	 * 执行技能
	 */
	private async executeSkill(skill: Skill, selection: string, triggerSource?: 'selection' | 'symbol', fullText?: string) {
		// 如果是符号触发，删除触发符号
		if (triggerSource === 'symbol' && this.currentTriggerSymbolRange && this.currentEditorView) {
			this.deleteTriggerSymbol();
		}

		this.hideSelectionToolbar();

		if (!this.skillExecutionService) {
			new Notice('技能执行服务未初始化');
			return;
		}

		// 根据触发来源决定实际使用的文本
		const actualSelection = triggerSource === 'symbol' ? (fullText || '') : selection;

		// 表单技能：只执行表单，不显示输出模态框
		const isFormSkill = (skill.skillType === 'form') || ((skill.formCommandIds?.length ?? 0) > 0)
		if (isFormSkill) {
			try {
				const result = await this.skillExecutionService.executeSkill(skill, actualSelection)
				if (!result.success) {
					new Notice(result.error || '执行表单技能失败')
				}
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e))
			}
			return
		}

		// 普通技能/技能组：显示结果模态框
		this.showResultModal(skill, selection, triggerSource, fullText);
	}

	/**
	 * 显示技能结果模态框
	 */
	private showResultModal(skill: Skill, selection: string, triggerSource?: 'selection' | 'symbol', fullText?: string) {
		this.isResultModalVisible = true;

		// 判断是否需要执行时选择模型
		const requiresModelSelection = skill.modelTag === '__EXEC_TIME__';

		// 创建结果模态框容器
		if (!this.resultModalContainer) {
			this.resultModalContainer = document.createElement('div');
			this.resultModalContainer.className = 'skill-result-modal-container';
			document.body.appendChild(this.resultModalContainer);
			this.resultModalRoot = createRoot(this.resultModalContainer);
		}

		// 根据触发来源决定实际使用的文本
		const actualSelection = triggerSource === 'symbol' ? (fullText || '') : selection;
		const providers = this.service.getProviders();

		// 重置状态
		this.currentResult = '';
		this.currentError = undefined;

		// 初始化加载状态（如果需要选择模型，初始不显示加载）
		this.currentIsLoading = !requiresModelSelection;

		const renderModal = () => {
			if (!this.isResultModalVisible) return;
			if (!this.resultModalRoot) return;

			this.resultModalRoot.render(
				<StrictMode>
					<SkillResultModal
						app={this.plugin.app}
						visible={true}
						skill={skill}
						selection={selection}
						result={this.currentResult}
						isLoading={this.currentIsLoading}
						error={this.currentError}
						providers={providers}
						selectedModelTag={this.selectedSkillModelTag}
						onModelChange={(tag) => this.handleSkillModelChange(tag, skill, actualSelection)}
						requiresModelSelection={requiresModelSelection}
						onClose={() => this.hideResultModal()}
						onStop={() => {
							this.cancelCurrentSkillExecution();
							this.currentIsLoading = false;
							renderModal();
						}}
						onRegenerate={() => this.regenerateSkillResult(skill, selection, triggerSource, fullText)}
						onInsert={(mode) => this.insertSkillResult(this.currentResult, mode, triggerSource, fullText)}
						onCopy={() => {}}
					/>
				</StrictMode>
			);
		};

		// 保存渲染函数引用
		this.currentRenderModal = renderModal;

		// 初始渲染（加载状态）
		renderModal();

		// 如果不需要选择模型，立即执行（现有逻辑）
		if (!requiresModelSelection) {
			// 根据设置决定使用流式输出还是非流式输出
			const useStreamOutput = this.plugin.settings.chat.selectionToolbarStreamOutput ?? true;

			if (useStreamOutput) {
				// 执行技能并流式更新结果
				this.executeSkillAndStream(skill, actualSelection, {
					onChunk: (chunk) => {
							if (!this.isResultModalVisible) return;
							this.currentResult += chunk;
							renderModal();
					},
					onComplete: () => {
							if (!this.isResultModalVisible) return;
							this.currentIsLoading = false;
							renderModal();
					},
					onError: (err) => {
							if (!this.isResultModalVisible) return;
							this.currentIsLoading = false;
							this.currentError = err;
							renderModal();
					}
				});
			} else {
				// 非流式输出：等待完整响应
				this.executeSkillNonStream(skill, actualSelection).then((response) => {
					if (!this.isResultModalVisible) return;
					this.currentResult = response;
					this.currentIsLoading = false;
					renderModal();
				}).catch((err) => {
					if (!this.isResultModalVisible) return;
					this.currentIsLoading = false;
					this.currentError = err instanceof Error ? err.message : String(err);
					renderModal();
				});
			}
		}
		// 如果需要选择模型，等待用户选择后再执行（在handleSkillModelChange中处理）
	}

	/**
	 * 处理技能模型切换
	 */
	private handleSkillModelChange(modelTag: string, skill: Skill, selection: string): void {
		this.selectedSkillModelTag = modelTag;

		// 如果未选择模型，仅更新UI
		if (!modelTag) {
			this.currentRenderModal?.();
			return;
		}

		// 开始执行
		this.currentIsLoading = true;
		this.currentResult = '';
		this.currentError = undefined;
		this.currentRenderModal?.();

		const useStreamOutput = this.plugin.settings.chat.selectionToolbarStreamOutput ?? true;

		if (useStreamOutput) {
			this.executeSkillAndStream(skill, selection, {
				onChunk: (chunk) => {
					if (!this.isResultModalVisible) return;
					this.currentResult += chunk;
					this.currentRenderModal?.();
				},
				onComplete: () => {
					if (!this.isResultModalVisible) return;
					this.currentIsLoading = false;
					this.currentRenderModal?.();
				},
				onError: (err) => {
					if (!this.isResultModalVisible) return;
					this.currentIsLoading = false;
					this.currentError = err;
					this.currentRenderModal?.();
				}
			}, modelTag);
		} else {
			this.executeSkillNonStream(skill, selection, modelTag).then((response) => {
				if (!this.isResultModalVisible) return;
				this.currentResult = response;
				this.currentIsLoading = false;
				this.currentRenderModal?.();
			}).catch((err) => {
				if (!this.isResultModalVisible) return;
				this.currentIsLoading = false;
				this.currentError = err instanceof Error ? err.message : String(err);
				this.currentRenderModal?.();
			});
		}
	}

	/**
	 * 非流式执行技能
	 */
	private async executeSkillNonStream(skill: Skill, selection: string, overrideModelTag?: string): Promise<string> {
		if (!this.skillExecutionService) {
			throw new Error('技能执行服务未初始化');
		}

		const result = await this.skillExecutionService.executeSkill(skill, selection, overrideModelTag);

		if (!result.success) {
			throw new Error(result.error || '执行失败');
		}

		return result.content;
	}

	/**
	 * 执行技能并流式返回结果
	 */
	private async executeSkillAndStream(
		skill: Skill,
		selection: string,
		callbacks: {
			onChunk: (chunk: string) => void;
			onComplete: () => void;
			onError: (error: string) => void;
		},
		overrideModelTag?: string
	) {
		if (!this.skillExecutionService) {
			callbacks.onError('技能执行服务未初始化');
			return;
		}

		try {
			const generator = this.skillExecutionService.executeSkillStream(skill, selection, overrideModelTag);
			for await (const chunk of generator) {
				callbacks.onChunk(chunk);
			}
			callbacks.onComplete();
		} catch (e) {
			callbacks.onError(e instanceof Error ? e.message : String(e));
		}
	}

	/**
	 * 重新生成技能结果
	 */
	private regenerateSkillResult(skill: Skill, selection: string, triggerSource?: 'selection' | 'symbol', fullText?: string) {
		this.hideResultModal();
		this.showResultModal(skill, selection, triggerSource, fullText);
	}

	/**
	 * 插入技能结果到编辑器
	 */
	private insertSkillResult(result: string, mode: 'replace' | 'append' | 'insert', triggerSource?: 'selection' | 'symbol', fullText?: string) {
		this.hideResultModal();

		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.editor) {
			new Notice('请先打开一个 Markdown 文件');
			return;
		}

		const editor = activeView.editor;

		switch (mode) {
			case 'replace':
				// 根据触发来源决定替换行为
				if (triggerSource === 'symbol') {
					// 符号触发：替换整个文件内容（不包括 frontmatter）
					const fullContent = editor.getValue();
					const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
					const match = fullContent.match(frontmatterRegex);

					if (match) {
						// 有 frontmatter：只替换正文部分
						const frontmatterEnd = match[0].length;
						const frontmatter = fullContent.slice(0, frontmatterEnd);
						editor.setValue(frontmatter + result);
					} else {
						// 没有 frontmatter：替换整个文件
						editor.setValue(result);
					}
					new Notice('已替换文件内容');
				} else {
					// 选中文本触发：替换当前选中文本
					editor.replaceSelection(result);
					new Notice('已替换选中文本');
				}
				break;
			case 'append':
				// 在选中文本后追加
				const selection = editor.getSelection();
				editor.replaceSelection(selection + '\n\n' + result);
				new Notice('已追加到选中内容');
				break;
			case 'insert':
				// 在光标位置插入
				const cursor = editor.getCursor();
				editor.replaceRange(result, cursor);
				new Notice('已插入到光标位置');
				break;
		}
	}

	/**
	 * 取消当前正在执行的技能
	 */
	cancelCurrentSkillExecution(): void {
		if (this.skillExecutionService) {
			this.skillExecutionService.cancelCurrentExecution();
		}
	}

	/**
	 * 隐藏结果模态框
	 */
	private hideResultModal() {
		this.isResultModalVisible = false;
		this.currentIsLoading = false;
		this.selectedSkillModelTag = ''; // 清空模型选择
		this.currentResult = ''; // 清空结果
		this.currentError = undefined; // 清空错误

		// 清理渲染函数引用
		this.currentRenderModal = null;

		// 取消正在执行的技能
		this.cancelCurrentSkillExecution();

		if (this.resultModalRoot) {
			this.resultModalRoot.render(
				<StrictMode>
					<SkillResultModal
						app={this.plugin.app}
						visible={false}
						skill={{ id: '', name: '', prompt: '', promptSource: 'custom', showInToolbar: false, order: 0, createdAt: 0, updatedAt: 0 }}
						selection=""
						result=""
						isLoading={false}
						onClose={() => {}}
						onRegenerate={() => {}}
						onInsert={() => {}}
						onCopy={() => {}}
					/>
				</StrictMode>
			);
		}
	}

	private registerViews() {
		this.plugin.registerView(VIEW_TYPE_CHAT_SIDEBAR, (leaf) => new ChatView(leaf, this.plugin, this.service, 'sidebar', VIEW_TYPE_CHAT_SIDEBAR));
		this.plugin.registerView(VIEW_TYPE_CHAT_TAB, (leaf) => new ChatView(leaf, this.plugin, this.service, 'tab', VIEW_TYPE_CHAT_TAB));
	}

	private registerCommands() {
		this.plugin.addCommand({
			id: 'form-chat-open-default',
			name: '打开 AI Chat',
			callback: () => {
				const openMode = this.plugin.settings.chat.openMode;
				this.activateChatView(openMode);
			}
		});
		this.plugin.addCommand({
			id: 'form-chat-open-sidebar',
			name: '在侧边栏打开 AI Chat',
			callback: () => this.activateChatView('sidebar')
		});
		this.plugin.addCommand({
			id: 'form-chat-open-left-sidebar',
			name: '在左侧边栏打开 AI Chat',
			callback: () => this.activateChatView('left-sidebar')
		});
		this.plugin.addCommand({
			id: 'form-chat-open-tab',
			name: '在新标签中打开 AI Chat',
			callback: () => this.activateChatView('tab')
		});
		this.plugin.addCommand({
			id: 'form-chat-open-window',
			name: '在新窗口打开 AI Chat',
			callback: () => this.activateChatView('window')
		});
		this.plugin.addCommand({
			id: 'form-chat-open-persistent-modal',
			name: '在持久化模态框中打开 AI Chat',
			callback: () => this.openChatInPersistentModal()
		});
		this.plugin.addCommand({
			id: 'form-chat-new-conversation',
			name: 'AI Chat 新建聊天',
			callback: () => this.service.createNewSession()
		});
		this.plugin.addCommand({
			id: 'form-chat-save-conversation',
			name: 'AI Chat 保存当前聊天',
			callback: () => this.service.saveActiveSession()
		});
		this.plugin.addCommand({
			id: 'form-chat-open-history',
			name: 'AI Chat 打开历史记录面板',
			callback: () => {
				const openMode = this.plugin.settings.chat.openMode;
				this.activateChatView(openMode).then(() => {
					// 历史面板在视图内部通过UI控制，此处只负责唤起视图
				});
			}
		});
	}

	private createRibbon() {
		// 检查设置中是否应该显示功能区图标
		const shouldShowRibbon = this.plugin.settings.chat.showRibbonIcon ?? true;
		
		if (shouldShowRibbon) {
			this.ribbonEl = this.plugin.addRibbonIcon('message-circle', 'AI Chat', () => {
				const openMode = this.plugin.settings.chat.openMode;
				this.activateChatView(openMode);
			});
			this.ribbonEl?.addClass('chat-ribbon-icon');
		} else {
			this.ribbonEl = null;
		}
	}
	
	private updateRibbonIcon(show: boolean) {
		// 如果当前状态与目标状态相同，则不需要更新
		const isCurrentlyShowing = this.ribbonEl !== null;
		if (isCurrentlyShowing === show) {
			return;
		}
		
		// 先移除现有图标
		if (this.ribbonEl) {
			this.ribbonEl.remove();
			this.ribbonEl = null;
		}
		
		// 根据新状态创建或隐藏图标
		if (show) {
			this.ribbonEl = this.plugin.addRibbonIcon('message-circle', 'AI Chat', () => {
				const openMode = this.plugin.settings.chat.openMode;
				this.activateChatView(openMode);
			});
			this.ribbonEl?.addClass('chat-ribbon-icon');
		}
	}

	private async waitForWorkspaceReady(): Promise<void> {
		const maxRetries = 10;
		const retryDelay = 100;

		for (let i = 0; i < maxRetries; i++) {
			// 检查工作区是否已经准备好
			if (this.plugin.app.workspace.layoutReady &&
				this.plugin.app.workspace.rightSplit) {
				return;
			}
			// 等待一段时间后重试
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}

		// 如果最大重试次数仍失败，记录警告但继续执行
		console.warn('FormFlow Chat: 工作区准备检查超时，将尝试继续执行');
	}

	private async openInWindow() {
		try {
			// 使用悬浮窗口模拟新窗口效果
			const leaf = this.plugin.app.workspace.getLeaf('window');
			await this.openLeaf(leaf, VIEW_TYPE_CHAT_TAB, true);
		} catch (error) {
			console.error('FormFlow Chat: 在新窗口中打开失败，回退到标签页模式:', error);
			// 如果新窗口失败，回退到标签页模式
			const leaf = this.plugin.app.workspace.getLeaf(true);
			await this.openLeaf(leaf, VIEW_TYPE_CHAT_TAB, true);
		}
	}

	private async openLeaf(leaf: WorkspaceLeaf, viewType: string, reveal: boolean) {
		try {
			await leaf.setViewState({
				type: viewType,
				active: true
			});
			if (reveal) {
				this.plugin.app.workspace.revealLeaf(leaf);
			}
		} catch (error) {
			console.error('FormFlow Chat: 设置叶子视图状态失败:', error);
			throw error;
		}
	}
}

