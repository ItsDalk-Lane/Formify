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
	onClose?: () => void;
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
	private readonly onCloseCallback?: () => void;

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

	// 缩小功能相关
	private isMinimized = false;
	private originalPosition = { left: 0, top: 0, width: 0, height: 0 };
	private floatingButton: HTMLElement | null = null;
	private customModalBg: HTMLElement | null = null;
	private originalStyleSnapshot: {
		display: string;
		position: string;
		left: string;
		top: string;
		right: string;
		bottom: string;
		transform: string;
		margin: string;
	} | null = null;
	private focusCaptureHandler: ((event: FocusEvent) => void) | null = null;

	constructor(
		app: App,
		service: ChatService,
		options: ChatPersistentModalOptions
	) {
		super(app);
		this.service = service;
		this.options = options;
		this.onCloseCallback = options.onClose;
	}

	onOpen() {
		const { contentEl, modalEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('chat-persistent-modal-content');
		modalEl.addClass('chat-persistent-modal');

		// 打开时确保缩小状态被重置
		this.isMinimized = false;
		if (this.floatingButton) {
			this.floatingButton.remove();
			this.floatingButton = null;
		}

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

		// 新增：阻止点击外部关闭
		this.preventCloseOnOutsideClick();

		// 新增：设置非模态行为
		this.setupNonModalBehavior();
	}

	onClose() {
		// 调用关闭回调
		this.onCloseCallback?.();

		// 清理自定义遮罩层
		if (this.customModalBg) {
			this.customModalBg.remove();
			this.customModalBg = null;
		}

		// 清理悬浮按钮
		if (this.floatingButton) {
			this.floatingButton.remove();
			this.floatingButton = null;
		}

		// 不恢复会话状态(与ChatModal不同)
		// 不清理文件(与ChatModal不同)
		// 保持当前会话和文件选择状态

		// 清理事件监听器
		this.unregisterEventListeners();

		// 清理拖动事件监听器
		this.cleanupDragListeners();

		// 清理焦点捕获监听器
		if (this.focusCaptureHandler) {
			document.removeEventListener('focusin', this.focusCaptureHandler, true);
			this.focusCaptureHandler = null;
		}

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
		titleEl.style.position = 'relative'; // 确保按钮容器正确定位

		// 创建关闭按钮容器
		const closeBtnContainer = titleEl.createDiv('modal-close-button-container');

		// 创建缩小按钮
		const minimizeBtn = closeBtnContainer.createEl('button', {
			cls: 'chat-persistent-modal-minimize-btn',
			attr: { 'aria-label': '缩小' }
		});
		minimizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
		minimizeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.handleMinimize();
		});

		// 创建关闭按钮
		const closeBtn = closeBtnContainer.createEl('button', {
			cls: 'chat-persistent-modal-close-btn',
			attr: { 'aria-label': '关闭' }
		});
		closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.close();
		});

		// 鼠标按下开始拖动
		titleEl.addEventListener('mousedown', (e: MouseEvent) => {
			if (e.button !== 0) return; // 只响应左键

			// 检查点击是否在按钮容器内
			if ((e.target as HTMLElement).closest('.modal-close-button-container')) {
				return; // 不启动拖动
			}

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

	/**
	 * 阻止点击外部区域关闭模态框并隐藏默认关闭按钮
	 */
	private preventCloseOnOutsideClick() {
		setTimeout(() => {
			// 隐藏 Obsidian 默认创建的关闭按钮
			const defaultCloseBtn = this.modalEl.querySelector('.modal-close-button') as HTMLElement;
			if (defaultCloseBtn) {
				defaultCloseBtn.style.display = 'none';
			}

			// 处理遮罩层
			const modalContainer = this.modalEl?.closest('.modal-container') as HTMLElement | null;
			const modalBg = modalContainer?.querySelector('.modal-bg') as HTMLElement | null;
			if (modalBg) {
				// 阻止点击遮罩层事件
				modalBg.addEventListener('click', (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
				}, true);

				// 完全移除遮罩层的交互
				modalBg.style.pointerEvents = 'none';
				modalBg.style.backgroundColor = 'transparent';
				modalBg.style.opacity = '0';
				modalBg.style.display = 'none';
			}
		}, 0);
	}

	/**
	 * 设置非模态行为（允许与其他UI元素交互）
	 */
	private setupNonModalBehavior() {
		setTimeout(() => {
			// 处理遮罩层，确保不阻止其他操作
			const modalContainer = this.modalEl?.closest('.modal-container') as HTMLElement | null;
			const modalBg = modalContainer?.querySelector('.modal-bg') as HTMLElement | null;
			if (modalBg) {
				modalBg.style.pointerEvents = 'none';
				modalBg.style.backgroundColor = 'transparent';
				modalBg.style.opacity = '0';
				modalBg.style.display = 'none';
			}

			// 确保模态框本身可以交互
			const modalEl = this.modalEl;
			if (modalEl) {
				modalEl.style.pointerEvents = 'auto';
			}

			// 移除模态容器的模态行为限制
			if (modalContainer) {
				modalContainer.style.pointerEvents = 'none';
			}

			// 防止模态框抢回编辑器焦点
			if (!this.focusCaptureHandler) {
				this.focusCaptureHandler = (event: FocusEvent) => {
					const target = event.target as Node | null;
					if (target && this.modalEl?.contains(target)) {
						return;
					}
					event.stopImmediatePropagation();
				};
				document.addEventListener('focusin', this.focusCaptureHandler, true);
			}
		}, 0);
	}

	/**
	 * 处理缩小操作
	 */
	private handleMinimize() {
		if (this.isMinimized) {
			this.restoreFromMinimize();
		} else {
			this.minimizeToFloatingButton();
		}
	}

	/**
	 * 缩小到悬浮按钮
	 */
	private minimizeToFloatingButton() {
		const modalEl = this.modalEl;
		if (!modalEl) return;

		// 保存当前状态
		const rect = modalEl.getBoundingClientRect();
		this.originalPosition = {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height
		};
		this.originalStyleSnapshot = {
			display: modalEl.style.display,
			position: modalEl.style.position,
			left: modalEl.style.left,
			top: modalEl.style.top,
			right: modalEl.style.right,
			bottom: modalEl.style.bottom,
			transform: modalEl.style.transform,
			margin: modalEl.style.margin
		};

		// 隐藏模态框
		modalEl.style.display = 'none';

		// 创建悬浮按钮
		this.createFloatingButton();

		this.isMinimized = true;
	}

	/**
	 * 创建悬浮按钮
	 */
	private createFloatingButton() {
		if (this.floatingButton) return;

		const floatBtn = document.createElement('div');
		floatBtn.className = 'chat-persistent-modal-floating-btn';
		floatBtn.innerHTML = `
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
			</svg>
		`;

		// 点击恢复
		floatBtn.addEventListener('click', () => this.restoreFromMinimize());

		// 添加到文档
		document.body.appendChild(floatBtn);
		this.floatingButton = floatBtn;
	}

	/**
	 * 从悬浮按钮恢复
	 */
	private restoreFromMinimize() {
		const modalEl = this.modalEl;
		if (!modalEl || !this.floatingButton) return;

		// 移除悬浮按钮
		this.floatingButton.remove();
		this.floatingButton = null;

		// 恢复模态框
		if (this.originalStyleSnapshot) {
			modalEl.style.display = this.originalStyleSnapshot.display;
			modalEl.style.position = this.originalStyleSnapshot.position;
			modalEl.style.left = this.originalStyleSnapshot.left;
			modalEl.style.top = this.originalStyleSnapshot.top;
			modalEl.style.right = this.originalStyleSnapshot.right;
			modalEl.style.bottom = this.originalStyleSnapshot.bottom;
			modalEl.style.transform = this.originalStyleSnapshot.transform;
			modalEl.style.margin = this.originalStyleSnapshot.margin;
		} else {
			modalEl.style.display = 'flex';
			modalEl.style.left = `${this.originalPosition.left}px`;
			modalEl.style.top = `${this.originalPosition.top}px`;
		}

		this.isMinimized = false;
	}

	/**
	 * 聚焦模态框
	 * 用于单例模式下恢复已有模态框的显示
	 */
	public focus() {
		// 如果处于最小化状态，先恢复
		if (this.isMinimized) {
			this.restoreFromMinimize();
		}

		// 确保模态框可见
		const modalEl = this.modalEl;
		if (modalEl) {
			modalEl.style.display = 'flex';
			modalEl.style.zIndex = '1000';

			// 聚焦到输入框
			const inputElement = modalEl.querySelector('textarea, input') as HTMLElement;
			inputElement?.focus();
		}
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
