import { WorkspaceLeaf } from 'obsidian';
import FormPlugin from 'src/main';
import { ChatService } from './services/ChatService';
import { ChatView, VIEW_TYPE_CHAT_SIDEBAR, VIEW_TYPE_CHAT_TAB } from './views/ChatView';
import type { ChatSettings, ChatOpenMode } from './types/chat';
import type { TarsSettings } from '../tars/settings';

export class ChatFeatureManager {
	private readonly service: ChatService;
	private ribbonEl: HTMLElement | null = null;

	constructor(private readonly plugin: FormPlugin) {
		this.service = new ChatService(plugin);
	}

	initialize(initialSettings?: Partial<ChatSettings>) {
		this.service.initialize(initialSettings);
		this.registerViews();
		this.registerCommands();
		this.createRibbon();

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
	}

	updateProviderSettings(settings: TarsSettings) {
		void this.service.refreshProviderSettings(settings);
	}

	getService(): ChatService {
		return this.service;
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
		this.ribbonEl = this.plugin.addRibbonIcon('message-circle', 'AI Chat', () => {
			const openMode = this.plugin.settings.chat.openMode;
			this.activateChatView(openMode);
		});
		this.ribbonEl?.addClass('chat-ribbon-icon');
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

