import { App, Modal, TFile } from 'obsidian';
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
 * Chat 模态框配置选项
 */
export interface ChatModalOptions {
	width: number;
	height: number;
	activeFile?: TFile | null;
	initialSelection?: string; // 初始选中文本，用于快捷技能
}

/**
 * AI Chat 模态框
 * 用于在编辑器中快速唤起聊天界面
 */
export class ChatModal extends Modal {
	private root: Root | null = null;
	private autoAddedFileId: string | null = null;
	private previousShouldSaveHistory: boolean | null = null; // 保存之前的历史保存状态
	private previousSession: any = null; // 保存之前的会话状态

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
		private readonly service: ChatService,
		private readonly options: ChatModalOptions
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('chat-modal-content');
		modalEl.addClass('chat-modal');

		// 设置模态框标题
		titleEl.textContent = localInstance.chat_modal_title;

		// 设置模态框为可拖动
		this.setupDraggable(modalEl, titleEl);

		// 设置模态框尺寸
		modalEl.style.setProperty('--chat-modal-width', `${this.options.width}px`);
		modalEl.style.setProperty('--chat-modal-height', `${this.options.height}px`);

		// 保存之前的历史保存状态和会话状态
		const currentState = this.service.getState();
		this.previousShouldSaveHistory = currentState.shouldSaveHistory;
		this.previousSession = this.service.saveSessionState();
		this.service.setShouldSaveHistory(false);

		// 创建全新的会话，确保每次打开模态框都是干净的界面
		this.service.createNewSession();

		// 重新打开模态框时，清除当前文件的手动移除标记
		// 这样在同一文件中重新打开模态框时，文件可以重新被自动添加
		if (this.options.activeFile) {
			this.service.onChatViewReopened(this.options.activeFile);
		}

		// 自动添加当前活动文件到上下文
		// 注意：通过快捷技能打开时（有 initialSelection）不自动添加文件
		if (this.options.activeFile && !this.options.initialSelection) {
			const file = this.options.activeFile;
			// 使用 addActiveFile 方法，它会正确处理自动添加标记
			this.service.addActiveFile(file);
			// 保存自动添加的文件ID，以便关闭时清理
			const updatedState = this.service.getState();
			const addedFile = updatedState.selectedFiles.find(
				f => f.path === file.path && f.isAutoAdded
			);
			if (addedFile) {
				this.autoAddedFileId = addedFile.id;
			}
		}

		// 如果有初始选中文本，设置为选中文本标签（不直接显示在输入框中）
		if (this.options.initialSelection) {
			this.service.setSelectedText(this.options.initialSelection);
		}

		// 创建 React 根节点并渲染
		this.root = createRoot(contentEl);
		this.renderReact();
	}

	onClose() {
		// 清理拖动事件监听器
		this.cleanupDragListeners();

		// 恢复之前的历史保存状态
		if (this.previousShouldSaveHistory !== null) {
			this.service.setShouldSaveHistory(this.previousShouldSaveHistory);
			this.previousShouldSaveHistory = null;
		}

		// 恢复之前的会话状态
		if (this.previousSession) {
			this.service.restoreSessionState(this.previousSession);
			this.previousSession = null;
		}

		// 清理自动添加的文件
		if (this.autoAddedFileId) {
			this.service.removeSelectedFile(this.autoAddedFileId, false);
			this.autoAddedFileId = null;
		}

		// 清理选中文本
		this.service.clearSelectedText();

		// 卸载 React 组件
		this.root?.unmount();
		this.root = null;
	}

	private renderReact() {
		if (!this.root) return;

		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<ChatModalApp
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

interface ChatModalAppProps {
	service: ChatService;
	app: App;
}

const ChatModalApp = ({ service, app }: ChatModalAppProps) => {
	const [state, setState] = useState<ChatState>(service.getState());
	const MODAL_VIEWPORT_PADDING = 8;

	const keepModalInViewport = () => {
		const modalEl = document.querySelector<HTMLElement>('.chat-modal');
		if (!modalEl) {
			return;
		}

		const computedStyle = window.getComputedStyle(modalEl);
		const hasFixedPosition = computedStyle.position === 'fixed';
		if (!hasFixedPosition) {
			return;
		}

		const currentTop = Number.parseFloat(modalEl.style.top || computedStyle.top || '0');
		if (!Number.isFinite(currentTop)) {
			return;
		}

		const rect = modalEl.getBoundingClientRect();
		let adjustedTop = currentTop;

		if (rect.bottom > window.innerHeight - MODAL_VIEWPORT_PADDING) {
			adjustedTop -= rect.bottom - (window.innerHeight - MODAL_VIEWPORT_PADDING);
		}
		if (rect.top < MODAL_VIEWPORT_PADDING) {
			adjustedTop += MODAL_VIEWPORT_PADDING - rect.top;
		}

		if (adjustedTop !== currentTop) {
			modalEl.style.top = `${Math.max(MODAL_VIEWPORT_PADDING, adjustedTop)}px`;
		}
	};

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
		const modalEl = document.querySelector('.chat-modal');
		if (modalEl) {
			if (!hasMessages) {
				modalEl.classList.add('auto-height');
			} else {
				modalEl.classList.remove('auto-height');
			}
			window.requestAnimationFrame(() => {
				keepModalInViewport();
			});
		}
	}, [hasMessages]);

	return (
		<div className="chat-modal-app tw-flex tw-h-full tw-flex-col tw-overflow-hidden tw-gap-2">
			{/* 聊天内容区域 */}
			<div className={`chat-modal-body tw-flex tw-flex-col tw-overflow-hidden tw-gap-2 ${hasMessages ? 'tw-flex-1' : ''}`}>
				{session ? (
					<>
						{hasMessages && <ChatMessages service={service} state={state} />}
						<ChatControls service={service} state={state} app={app} />
						<ChatInput service={service} state={state} app={app} />
					</>
				) : (
					<div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-text-muted">
						暂无聊天会话，开始输入以创建新对话。
					</div>
				)}
			</div>
		</div>
	);
};
