import { History, MessageCirclePlus, Save, Zap, Paperclip, ImageUp } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import type { ChatHistoryEntry } from '../services/HistoryService';
import { ChatHistoryPanel } from '../components/ChatHistory';
import { FileMenuPopup } from '../components/FileMenuPopup';
import { App, TFile, TFolder } from 'obsidian';

interface ChatControlsProps {
	service: ChatService;
	state: ChatState;
	app: App;
}

export const ChatControls = ({ service, state, app }: ChatControlsProps) => {
	const [historyOpen, setHistoryOpen] = useState(false);
	const [historyItems, setHistoryItems] = useState<ChatHistoryEntry[]>([]);
	const [showFileMenu, setShowFileMenu] = useState(false);
	const fileMenuButtonRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (historyOpen) {
			service.listHistory().then(setHistoryItems);
		}
	}, [historyOpen, service]);

	const tokenCount = useMemo(() => {
		const messages = state.activeSession?.messages ?? [];
		return messages.reduce((acc, message) => acc + message.content.length, 0);
	}, [state.activeSession?.messages]);

	const handleNewChat = () => {
		service.createNewSession();
	};

	const handleSelectHistory = async (item: ChatHistoryEntry) => {
		await service.loadHistory(item.filePath);
		setHistoryOpen(false);
	};

	const handleTemplateButtonClick = () => {
		service.setTemplateSelectorVisibility(true);
	};

	const handleImageUpload = () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = true;
		input.onchange = async (e) => {
			const target = e.target as HTMLInputElement;
			const files = Array.from(target.files || []);
			if (files.length > 0) {
				// 将图片转换为base64格式
				const newImageBase64Array: string[] = [];
				for (const file of files) {
					try {
						const base64 = await fileToBase64(file);
						newImageBase64Array.push(base64);
					} catch (error) {
						console.error('Failed to convert image to base64:', error);
					}
				}
				const updatedImages = [...state.selectedImages, ...newImageBase64Array];
				service.setSelectedImages(updatedImages);
			}
		};
		input.click();
	};

	const handleFileUpload = () => {
		setShowFileMenu(true);
	};

	const handleFileSelect = (file: TFile) => {
		service.addSelectedFile(file);
	};

	const handleFolderSelect = (folder: TFolder) => {
		service.addSelectedFolder(folder);
	};

	// 辅助函数：将File转换为base64字符串
	const fileToBase64 = (file: File): Promise<string> =>
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});

	
	return (
		<div className="chat-controls tw-flex tw-items-center tw-justify-between tw-px-2 tw-py-1.5" style={{
			background: 'transparent',
			border: 'none'
		}}>
			<div className="tw-flex tw-items-center tw-gap-2">
				<span onClick={handleTemplateButtonClick} aria-label="选择模板" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs hover:tw-bg-purple-200 tw-border-none">
					<Zap className="tw-size-3" />
					<span>选择模板</span>
				</span>
				<span
					ref={fileMenuButtonRef}
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						handleFileUpload();
					}}
					className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
					aria-label="上传文件"
					title="上传文件"
				>
					<Paperclip className="tw-size-4" />
				</span>
				<span
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						handleImageUpload();
					}}
					className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
					aria-label="上传图片"
					title="上传图片"
				>
					<ImageUp className="tw-size-4" />
				</span>
			</div>
			<div className="tw-flex-1"></div>
			<div className="tw-flex tw-items-center tw-gap-2">
				<span className="tw-text-xs tw-text-muted-foreground">
					Tokens <span className="tw-font-semibold">{tokenCount}</span>
				</span>
				<span onClick={handleNewChat} aria-label="新建聊天" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
					<MessageCirclePlus className="tw-size-4" />
				</span>
				<span onClick={() => setHistoryOpen((prev) => !prev)} aria-label="历史记录" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
					<History className="tw-size-4" />
				</span>
			</div>
			{historyOpen && (
				<ChatHistoryPanel
					items={historyItems}
					onSelect={handleSelectHistory}
					onClose={() => setHistoryOpen(false)}
					onRefresh={async () => setHistoryItems(await service.listHistory())}
					onDelete={async (item) => {
						await service.deleteHistory(item.filePath);
						setHistoryItems(await service.listHistory());
					}}
				/>
			)}
			{/* 文件菜单弹出窗口 */}
			<FileMenuPopup
				isOpen={showFileMenu}
				onClose={() => setShowFileMenu(false)}
				onSelectFile={handleFileSelect}
				onSelectFolder={handleFolderSelect}
				app={app}
				buttonRef={fileMenuButtonRef}
			/>
		</div>
	);
};

