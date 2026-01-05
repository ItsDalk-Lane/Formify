import { ItemView, WorkspaceLeaf, App, TFile, MarkdownView } from 'obsidian';
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

		// 重新打开AI Chat界面时，清除当前文件的手动移除标记
		// 这样在同一文件中重新打开界面时，文件可以重新被自动添加
		const currentFile = this.app.workspace.getActiveFile();
		this.service.onChatViewReopened(currentFile);
		
		// 获取当前所有打开的Markdown文件路径
		const getOpenMarkdownFiles = (): Set<string> => {
			const openFiles = new Set<string>();
			this.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView && leaf.view.file) {
					openFiles.add(leaf.view.file.path);
				}
			});
			return openFiles;
		};

		// 检查自动添加的文件是否仍然打开，如果未打开则清除
		const checkAndCleanAutoAddedFiles = () => {
			const openFiles = getOpenMarkdownFiles();
			const autoAddedFiles = this.service.getAutoAddedFiles();
			
			for (const file of autoAddedFiles) {
				if (!openFiles.has(file.path)) {
					// 自动添加的文件已关闭，从上下文中移除
					this.service.removeSelectedFile(file.id, false);
				}
			}
		};

		// 监听布局变化事件，检测标签页关闭
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				// 延迟执行检查，确保布局已更新
				setTimeout(() => {
					checkAndCleanAutoAddedFiles();
				}, 50);
			})
		);

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
					// 同时检查并清理已关闭的文件
					checkAndCleanAutoAddedFiles();
				}
			})
		);
		
		// 监听文件打开事件
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file) {
					// 文件被关闭，检查自动添加的文件是否仍打开
					checkAndCleanAutoAddedFiles();
					// 如果没有任何打开的Markdown文件，重置标记
					const openFiles = getOpenMarkdownFiles();
					if (openFiles.size === 0) {
						this.service.onNoActiveFile();
					}
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

