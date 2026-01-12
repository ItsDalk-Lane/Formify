import { App, EventRef, MarkdownView, Modal, TFile } from 'obsidian';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ObsidianAppContext } from 'src/context/obsidianAppContext';
import { localInstance } from 'src/i18n/locals';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import { ChatMessages } from './ChatMessages';
import { ChatControls } from './ChatControls';
import { ChatInput } from './ChatInput';

/**
 * Chat 持久化模态框配置选项
 */
export interface ChatPersistentModalOptions {
	width: number;
	height: number;
	activeFile?: TFile | null;
}

/**
 * AI Chat 持久化模态框
 * 与临时模态框(ChatModal)的区别:
 * 1. 保存聊天历史(shouldSaveHistory=true)
 * 2. 不创建新会话,继续使用当前会话
 * 3. 关闭时不恢复会话状态
 * 4. 注册事件监听器,实现文件自动管理
 */
export class ChatPersistentModal extends Modal {
	private root: Root | null = null;
	private readonly service: ChatService;
	private readonly options: ChatPersistentModalOptions;

	// 事件监听器引用(用于清理)
	private eventRefs: EventRef[] = [];

	// 拖动相关
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private modalStartLeft = 0;
	private modalStartTop = 0;
	private dragMouseUpHandler: ((e: MouseEvent) => void) | null = null;
	private dragMouseMoveHandler: ((e: MouseEvent) => void) | null = null;

	constructor(
		app: App,
		service: ChatService,
		options: ChatPersistentModalOptions
	) {
		super(app);
		this.service = service;
		this.options = options;
	}

	onOpen() {
		const { contentEl, modalEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('chat-persistent-modal-content');
		modalEl.addClass('chat-persistent-modal');

		// 设置模态框标题
		titleEl.textContent = localInstance.chat_modal_title;

		// 设置模态框为可拖动
		this.setupDraggable(modalEl, titleEl);

		// 设置模态框尺寸
		modalEl.style.setProperty('--chat-modal-width', `${this.options.width}px`);
		modalEl.style.setProperty('--chat-modal-height', `${this.options.height}px`);

		// 确保历史记录保存开启(与ChatModal不同)
		this.service.setShouldSaveHistory(true);

		// 不创建新会话,继续使用当前会话(与ChatModal不同)
		// 不保存会话状态(与ChatModal不同)

		// 重新打开模态框时,清除当前文件的手动移除标记
		// 这样在同一文件中重新打开模态框时,文件可以重新被自动添加
		if (this.options.activeFile) {
			this.service.onChatViewReopened(this.options.activeFile);
		}

		// 注册事件监听器(核心功能,从ChatView复制)
		this.registerEventListeners();

		// 自动添加当前活动文件到上下文
		if (this.options.activeFile) {
			this.service.addActiveFile(this.options.activeFile);
		}

		// 创建 React 根节点并渲染
		this.root = createRoot(contentEl);
		this.renderReact();
	}

	onClose() {
		// 不恢复会话状态(与ChatModal不同)
		// 不清理文件(与ChatModal不同)
		// 保持当前会话和文件选择状态

		// 清理事件监听器
		this.unregisterEventListeners();

		// 清理拖动事件监听器
		this.cleanupDragListeners();

		// 卸载 React 组件
		this.root?.unmount();
		this.root = null;
	}

	/**
	 * 注册事件监听器
	 * 从ChatView复制并修改,实现文件自动管理功能
	 */
	private registerEventListeners() {
		// 1. active-leaf-change事件:监听文件切换
		const activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				// 如果文件为null,说明没有活动文件,移除所有自动添加的文件并重置标记
				this.service.removeAllAutoAddedFiles();
				this.service.onNoActiveFile();
			} else {
				// 添加新的活动文件(会自动移除之前的自动添加文件)
				this.service.addActiveFile(file);
				// 同时检查并清理已关闭的文件
				this.checkAndCleanAutoAddedFiles();
			}
		});
		this.eventRefs.push(activeLeafRef);

		// 2. file-open事件:监听文件打开/关闭
		const fileOpenRef = this.app.workspace.on('file-open', (file) => {
			if (!file) {
				// 文件被关闭,检查自动添加的文件是否仍打开
				this.checkAndCleanAutoAddedFiles();
				// 如果没有任何打开的Markdown文件,重置标记
				const openFiles = this.getOpenMarkdownFiles();
				if (openFiles.size === 0) {
					this.service.onNoActiveFile();
				}
			} else {
				this.service.addActiveFile(file);
			}
		});
		this.eventRefs.push(fileOpenRef);

		// 3. layout-change事件:监听布局变化(检测标签页关闭)
		const layoutChangeRef = this.app.workspace.on('layout-change', () => {
			// 延迟执行检查,确保布局已更新
			setTimeout(() => {
				this.checkAndCleanAutoAddedFiles();
			}, 50);
		});
		this.eventRefs.push(layoutChangeRef);
	}

	/**
	 * 清理事件监听器
	 */
	private unregisterEventListeners() {
		this.eventRefs.forEach(ref => {
			this.app.workspace.offref(ref);
		});
		this.eventRefs = [];
	}

	/**
	 * 获取当前所有打开的Markdown文件路径
	 * 从ChatView复制
	 */
	private getOpenMarkdownFiles(): Set<string> {
		const openFiles = new Set<string>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				openFiles.add(leaf.view.file.path);
			}
		});
		return openFiles;
	}

	/**
	 * 检查自动添加的文件是否仍然打开,如果未打开则清除
	 * 从ChatView复制
	 */
	private checkAndCleanAutoAddedFiles() {
		const openFiles = this.getOpenMarkdownFiles();
		const autoAddedFiles = this.service.getAutoAddedFiles();

		for (const file of autoAddedFiles) {
			if (!openFiles.has(file.path)) {
				// 自动添加的文件已关闭,从上下文中移除
				this.service.removeSelectedFile(file.id, false);
			}
		}
	}

	private renderReact() {
		if (!this.root) return;

		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<ChatPersistentModalApp
						service={this.service}
						app={this.app}
					/>
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}

	/**
	 * 设置模态框拖动功能
	 */
	private setupDraggable(modalEl: HTMLElement, titleEl: HTMLElement) {
		// 设置标题栏光标样式
		titleEl.style.cursor = 'move';
		titleEl.style.userSelect = 'none';

		// 鼠标按下开始拖动
		titleEl.addEventListener('mousedown', (e: MouseEvent) => {
			if (e.button !== 0) return; // 只响应左键

			this.isDragging = true;
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;

			// 获取当前模态框位置
			const rect = modalEl.getBoundingClientRect();
			this.modalStartLeft = rect.left;
			this.modalStartTop = rect.top;

			// 创建鼠标移动和释放事件处理函数
			this.dragMouseMoveHandler = (moveEvent: MouseEvent) => {
				if (!this.isDragging) return;

				const deltaX = moveEvent.clientX - this.dragStartX;
				const deltaY = moveEvent.clientY - this.dragStartY;

				// 计算新位置
				const newLeft = this.modalStartLeft + deltaX;
				const newTop = this.modalStartTop + deltaY;

				// 应用新位置
				modalEl.style.position = 'fixed';
				modalEl.style.left = `${newLeft}px`;
				modalEl.style.top = `${newTop}px`;
				modalEl.style.transform = 'none';
				modalEl.style.margin = '0';
			};

			this.dragMouseUpHandler = () => {
				this.isDragging = false;
				if (this.dragMouseMoveHandler) {
					document.removeEventListener('mousemove', this.dragMouseMoveHandler);
					this.dragMouseMoveHandler = null;
				}
				if (this.dragMouseUpHandler) {
					document.removeEventListener('mouseup', this.dragMouseUpHandler);
					this.dragMouseUpHandler = null;
				}
			};

			// 添加全局事件监听器
			document.addEventListener('mousemove', this.dragMouseMoveHandler);
			document.addEventListener('mouseup', this.dragMouseUpHandler);

			// 阻止默认行为
			e.preventDefault();
		});
	}

	/**
	 * 清理拖动事件监听器
	 */
	private cleanupDragListeners() {
		if (this.dragMouseMoveHandler) {
			document.removeEventListener('mousemove', this.dragMouseMoveHandler);
			this.dragMouseMoveHandler = null;
		}
		if (this.dragMouseUpHandler) {
			document.removeEventListener('mouseup', this.dragMouseUpHandler);
			this.dragMouseUpHandler = null;
		}
		this.isDragging = false;
	}
}

interface ChatPersistentModalAppProps {
	service: ChatService;
	app: App;
}

/**
 * Chat 持久化模态框 React 应用组件
 * UI结构与ChatView保持一致
 */
const ChatPersistentModalApp = ({ service, app }: ChatPersistentModalAppProps) => {
	const [state, setState] = useState<ChatState>(service.getState());

	useEffect(() => {
		const unsubscribe = service.subscribe((next) => {
			setState(next);
		});
		return () => unsubscribe();
	}, [service]);

	const session = state.activeSession;

	// 判断是否有消息
	const hasMessages = session && session.messages.length > 0;

	// 动态控制模态框高度
	useEffect(() => {
		const modalEl = document.querySelector('.chat-persistent-modal');
		if (modalEl) {
			if (!hasMessages) {
				modalEl.classList.add('auto-height');
			} else {
				modalEl.classList.remove('auto-height');
			}
		}
	}, [hasMessages]);

	return (
		<div className="chat-persistent-modal-app tw-flex tw-h-full tw-flex-col tw-overflow-hidden tw-gap-2">
			<div className={`chat-persistent-modal-body tw-flex tw-flex-col tw-overflow-hidden tw-gap-2 ${hasMessages ? 'tw-flex-1' : ''}`}>
				{session ? (
					<>
						{hasMessages && <ChatMessages service={service} state={state} />}
						<ChatControls service={service} state={state} app={app} />
						<ChatInput service={service} state={state} app={app} />
					</>
				) : (
					<div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-text-muted">
						暂无聊天会话,点击"New Chat"开始新的对话。
					</div>
				)}
			</div>
		</div>
	);
};
