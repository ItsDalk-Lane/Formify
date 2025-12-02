import { ItemView, WorkspaceLeaf, App, TFile } from 'obsidian';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import FormPlugin from 'src/main';
import { ObsidianAppContext } from 'src/context/obsidianAppContext';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import { ChatMessages } from './ChatMessages';
import { ChatControls } from './ChatControls';
import { ChatInput } from './ChatInput';

export const VIEW_TYPE_CHAT_SIDEBAR = 'form-chat-sidebar';
export const VIEW_TYPE_CHAT_TAB = 'form-chat-tab';

export type ChatViewMode = 'sidebar' | 'tab';

export class ChatView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: FormPlugin,
		private readonly service: ChatService,
		private readonly mode: ChatViewMode,
		private readonly viewType: string
	) {
		super(leaf);
	}

	getViewType(): string {
		return this.viewType;
	}

	getDisplayText(): string {
		return this.mode === 'sidebar' ? 'AI Chat 面板' : 'AI Chat';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen() {
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.renderReact();
		
		// 监听文件切换事件（包括文件关闭）
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const file = this.app.workspace.getActiveFile();
				// 如果文件为null，说明没有活动文件，移除所有自动添加的文件并重置标记
				if (!file) {
					this.service.removeAllAutoAddedFiles();
					this.service.onNoActiveFile();
				} else {
					// 添加新的活动文件（会自动移除之前的自动添加文件）
					this.service.addActiveFile(file);
				}
			})
		);
		
		// 监听文件打开事件
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file) {
					// 文件被关闭，移除自动添加的文件并重置标记
					this.service.removeAllAutoAddedFiles();
					this.service.onNoActiveFile();
				} else {
					this.service.addActiveFile(file);
				}
			})
		);
		
		// 初始化时添加当前活跃文件
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.service.addActiveFile(activeFile);
		}
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
	}

	private renderReact() {
		if (!this.root) return;
		this.root.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<ChatApp service={this.service} mode={this.mode} app={this.app} />
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}
}

interface ChatAppProps {
	service: ChatService;
	mode: ChatViewMode;
	app: App;
}

const ChatApp = ({ service, mode, app }: ChatAppProps) => {
	const [state, setState] = useState<ChatState>(service.getState());

	useEffect(() => {
		const unsubscribe = service.subscribe((next) => {
			setState(next);
		});
		return () => unsubscribe();
	}, [service]);

	const session = state.activeSession;

	const layoutClasses = useMemo(
		() =>
			[
				'tw-flex',
				'tw-h-full',
				'tw-flex-col',
				'tw-overflow-hidden',
				mode === 'sidebar' ? 'tw-gap-2' : 'tw-gap-3',
				'chat-view-root'
			].join(' '),
		[mode]
	);

	return (
		<div className={layoutClasses}>
			{session ? (
				<>
					<ChatMessages service={service} state={state} />
					<ChatControls service={service} state={state} app={app} />
					<ChatInput service={service} state={state} app={app} />
				</>
			) : (
				<div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-text-muted">
					暂无聊天会话，点击"New Chat"开始新的对话。
				</div>
			)}
		</div>
	);
};

