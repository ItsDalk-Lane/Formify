import { WorkspaceLeaf, Notice, TFile, MarkdownView } from 'obsidian';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import FormPlugin from 'src/main';
import { ChatService } from './services/ChatService';
import { ChatView, VIEW_TYPE_CHAT_SIDEBAR, VIEW_TYPE_CHAT_TAB } from './views/ChatView';
import { ChatModal } from './views/ChatModal';
import { createChatTriggerExtension, updateChatTriggerSettings } from './trigger/ChatTriggerExtension';
import {
	createSelectionToolbarExtension,
	updateSelectionToolbarSettings,
	SelectionInfo
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
import { DebugLogger } from 'src/utils/DebugLogger';

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

	// 技能结果模态框状态
	private resultModalContainer: HTMLElement | null = null;
	private resultModalRoot: Root | null = null;

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

	async activateChatView(mode: ChatOpenMode) {
		try {
			if (mode === 'window') {
				// 在新窗口中打开 - Obsidian 不直接支持新窗口，使用弹出窗口方式
				await this.openInWindow();
			} else if (mode === 'sidebar') {
				// 添加延迟确保工作区完全加载
				await this.waitForWorkspaceReady();

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
			} else if (mode === 'left-sidebar') {
				// 添加延迟确保工作区完全加载
				await this.waitForWorkspaceReady();

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
			} else {
				// tab mode
				const leaf = this.plugin.app.workspace.getLeaf(true);
				await this.openLeaf(leaf, VIEW_TYPE_CHAT_TAB, true);
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
				onTrigger: (activeFile) => {
					this.openChatInModal(activeFile);
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
	 * 渲染工具栏组件
	 */
	private renderToolbar() {
		if (!this.toolbarRoot || !this.currentSelectionInfo) {
			return;
		}

		const settings = this.plugin.settings.chat;
		// 使用缓存的技能列表，不从 settings 中获取
		const settingsWithCachedSkills = { ...settings, skills: this.cachedSkills };

		this.toolbarRoot.render(
			<StrictMode>
				<SelectionToolbar
					visible={this.isToolbarVisible}
					selectionInfo={this.currentSelectionInfo}
					settings={settingsWithCachedSkills}
					onOpenChat={(selection) => this.openChatWithSelection(selection)}
					onExecuteSkill={(skill, selection) => this.executeSkill(skill, selection)}
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
						onExecuteSkill={() => {}}
						onClose={() => {}}
					/>
				</StrictMode>
			);
		}
	}

	/**
	 * 携带选中文本打开 AI Chat
	 */
	private openChatWithSelection(selection: string) {
		this.hideSelectionToolbar();
		
		const settings = this.plugin.settings.chat;
		const activeFile = this.plugin.app.workspace.getActiveFile();

		// 创建并打开模态框，同时将选中文本添加到上下文
		const modal = new ChatModal(
			this.plugin.app,
			this.service,
			{
				width: settings.chatModalWidth ?? 700,
				height: settings.chatModalHeight ?? 500,
				activeFile: activeFile,
				initialSelection: selection
			}
		);
		modal.open();
	}

	/**
	 * 执行技能
	 */
	private async executeSkill(skill: Skill, selection: string) {
		this.hideSelectionToolbar();
		
		if (!this.skillExecutionService) {
			new Notice('技能执行服务未初始化');
			return;
		}

		// 显示结果模态框
		this.showResultModal(skill, selection);
	}

	/**
	 * 显示技能结果模态框
	 */
	private showResultModal(skill: Skill, selection: string) {
		// 创建结果模态框容器
		if (!this.resultModalContainer) {
			this.resultModalContainer = document.createElement('div');
			this.resultModalContainer.className = 'skill-result-modal-container';
			document.body.appendChild(this.resultModalContainer);
			this.resultModalRoot = createRoot(this.resultModalContainer);
		}

		let result = '';
		let isLoading = true;
		let error: string | undefined;

		const renderModal = () => {
			if (!this.resultModalRoot) return;
			
			this.resultModalRoot.render(
				<StrictMode>
					<SkillResultModal
						app={this.plugin.app}
						visible={true}
						skill={skill}
						selection={selection}
						result={result}
						isLoading={isLoading}
						error={error}
						onClose={() => this.hideResultModal()}
						onRegenerate={() => this.regenerateSkillResult(skill, selection)}
						onInsert={(mode) => this.insertSkillResult(result, mode)}
						onCopy={() => {}}
					/>
				</StrictMode>
			);
		};

		// 初始渲染（加载状态）
		renderModal();

		// 根据设置决定使用流式输出还是非流式输出
		const useStreamOutput = this.plugin.settings.chat.selectionToolbarStreamOutput ?? true;

		if (useStreamOutput) {
			// 执行技能并流式更新结果
			this.executeSkillAndStream(skill, selection, {
				onChunk: (chunk) => {
					result += chunk;
					renderModal();
				},
				onComplete: () => {
					isLoading = false;
					renderModal();
				},
				onError: (err) => {
					isLoading = false;
					error = err;
					renderModal();
				}
			});
		} else {
			// 非流式输出：等待完整响应
			this.executeSkillNonStream(skill, selection).then((response) => {
				result = response;
				isLoading = false;
				renderModal();
			}).catch((err) => {
				isLoading = false;
				error = err instanceof Error ? err.message : String(err);
				renderModal();
			});
		}
	}

	/**
	 * 非流式执行技能
	 */
	private async executeSkillNonStream(skill: Skill, selection: string): Promise<string> {
		if (!this.skillExecutionService) {
			throw new Error('技能执行服务未初始化');
		}

		const result = await this.skillExecutionService.executeSkill(skill, selection);
		
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
		}
	) {
		if (!this.skillExecutionService) {
			callbacks.onError('技能执行服务未初始化');
			return;
		}

		try {
			const generator = this.skillExecutionService.executeSkillStream(skill, selection);
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
	private regenerateSkillResult(skill: Skill, selection: string) {
		this.hideResultModal();
		this.showResultModal(skill, selection);
	}

	/**
	 * 插入技能结果到编辑器
	 */
	private insertSkillResult(result: string, mode: 'replace' | 'append' | 'insert') {
		this.hideResultModal();

		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.editor) {
			new Notice('请先打开一个 Markdown 文件');
			return;
		}

		const editor = activeView.editor;

		switch (mode) {
			case 'replace':
				// 替换当前选中文本
				editor.replaceSelection(result);
				new Notice('已替换选中文本');
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
	 * 隐藏结果模态框
	 */
	private hideResultModal() {
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

