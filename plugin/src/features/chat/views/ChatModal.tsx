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
}

interface ChatModalAppProps {
	service: ChatService;
	app: App;
}

const ChatModalApp = ({ service, app }: ChatModalAppProps) => {
	const [state, setState] = useState<ChatState>(service.getState());

	useEffect(() => {
		const unsubscribe = service.subscribe((next) => {
			setState(next);
		});
		return () => unsubscribe();
	}, [service]);

	const session = state.activeSession;

	return (
		<div className="chat-modal-app tw-flex tw-h-full tw-flex-col tw-overflow-hidden tw-gap-2">
			{/* 聊天内容区域 */}
			<div className="chat-modal-body tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-gap-2">
				{session ? (
					<>
						<ChatMessages service={service} state={state} />
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
