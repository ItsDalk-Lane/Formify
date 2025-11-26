import { CornerDownLeft, StopCircle, ImageUp, X, Paperclip, FileText, Folder } from 'lucide-react';
import { FormEvent, useEffect, useState, useRef, Fragment } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState, SelectedFile, SelectedFolder } from '../types/chat';
import { ModelSelector } from '../components/ModelSelector';
import { FileMenuPopup } from '../components/FileMenuPopup';
import { App, TFile, TFolder } from 'obsidian';

interface ChatInputProps {
	service: ChatService;
	state: ChatState;
	app: App;
}

export const ChatInput = ({ service, state, app }: ChatInputProps) => {
	const [value, setValue] = useState(state.inputValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [maxHeight, setMaxHeight] = useState(80); // Default minimum height
	const [showFileMenu, setShowFileMenu] = useState(false);
	const fileMenuButtonRef = useRef<HTMLSpanElement>(null);

	// Calculate maximum height (1/4 of viewport height)
	useEffect(() => {
		const calculateMaxHeight = () => {
			const viewportHeight = window.innerHeight;
			const calculatedMaxHeight = Math.floor(viewportHeight / 4); // 1/4 of viewport height
			setMaxHeight(calculatedMaxHeight);
		};

		calculateMaxHeight();
		window.addEventListener('resize', calculateMaxHeight);
		return () => window.removeEventListener('resize', calculateMaxHeight);
	}, []);

	// Auto-resize textarea based on content
	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			// Reset height to auto to get the natural scrollHeight
			textarea.style.height = 'auto';

			// Calculate new height based on content
			const newHeight = Math.min(textarea.scrollHeight, maxHeight);
			textarea.style.height = `${newHeight}px`;
		}
	}, [value, maxHeight]);

	useEffect(() => {
		setValue(state.inputValue);
	}, [state.inputValue]);

	const handleSubmit = async (event?: FormEvent) => {
		event?.preventDefault();
		await service.sendMessage(value);
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
				// 将图片转换为base64格式，而不是Blob URL
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

	const handleRemoveImage = (image: string) => {
		service.removeSelectedImage(image);
	};

	const handleRemoveFile = (fileId: string) => {
		service.removeSelectedFile(fileId);
	};

	const handleRemoveFolder = (folderId: string) => {
		service.removeSelectedFolder(folderId);
	};

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				handleSubmit();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [value]);

	return (
		<Fragment>
			<form className="chat-input tw-flex tw-w-full tw-flex-col tw-gap-2 tw-p-2" style={{
				border: '1px solid var(--background-modifier-border)',
				borderRadius: 'var(--radius-m)'
			}} onSubmit={handleSubmit}>
				{!state.isGenerating ? (
					<>
								<textarea
							ref={textareaRef}
							className="tw-w-full tw-resize-none tw-p-3 tw-text-sm"
							style={{
								border: 'none',
								outline: 'none',
								background: 'transparent',
								resize: 'none',
								minHeight: '80px',
								maxHeight: `${maxHeight}px`,
								borderRadius: '0',
								boxShadow: 'none',
								marginBottom: '0',
								overflowY: 'auto'
							}}
							value={value}
							onChange={(event) => {
								setValue(event.target.value);
								service.setInputValue(event.target.value);
							}}
							placeholder="输入消息，按 Enter 发送，Shift+Enter 换行"
						/>
						{/* 图片预览区域 */}
						{state.selectedImages.length > 0 && (
							<div className="selected-images tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
								{state.selectedImages.map((image, index) => (
									<div key={image} className="image-preview-container tw-relative">
										<img
											src={image}
											alt={`selected-${index}`}
											className="selected-image-preview tw-w-16 tw-h-16 tw-object-cover tw-rounded tw-border tw-border-gray-300"
										/>
										<button
											type="button"
											className="remove-image-button tw-absolute tw-top-0 tw-right-0 tw-bg-red-500 tw-text-white tw-rounded-full tw-w-4 tw-h-4 tw-flex tw-items-center tw-justify-center tw-text-xs tw-cursor-pointer hover:tw-bg-red-600"
											onClick={() => handleRemoveImage(image)}
										>
											<X className="tw-size-3" />
										</button>
									</div>
								))}
							</div>
						)}

						{/* 文件标签区域 */}
						{(state.selectedFiles.length > 0 || state.selectedFolders.length > 0) && (
							<div className="selected-files tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
								{state.selectedFiles.map((file) => (
									<div key={file.id} className="file-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-gray-100 tw-text-gray-700 tw-rounded tw-text-xs tw-relative group">
										<FileText className="tw-size-3 tw-flex-shrink-0" />
										<span className="tw-max-w-40 tw-truncate" title={file.path}>
											{file.name}
											{file.extension === 'pdf' && (
												<span className="ml-1 tw-px-1 tw-bg-blue-500 tw-text-white tw-rounded tw-text-[10px]">pdf</span>
											)}
											{file.extension === 'canvas' && (
												<span className="ml-1 tw-px-1 tw-bg-green-500 tw-text-white tw-rounded tw-text-[10px]">canvas</span>
											)}
										</span>
										<button
											type="button"
											className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
											onClick={(e) => {
												e.stopPropagation();
												handleRemoveFile(file.id);
											}}
											title="删除文件"
										>
											<X className="tw-size-4" />
										</button>
									</div>
								))}
								{state.selectedFolders.map((folder) => (
									<div key={folder.id} className="folder-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-blue-100 tw-text-blue-700 tw-rounded tw-text-xs tw-relative group">
										<Folder className="tw-size-3 tw-flex-shrink-0" />
										<span className="tw-max-w-40 tw-truncate" title={folder.path}>
											{folder.name || folder.path}
										</span>
										<button
											type="button"
											className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
											onClick={(e) => {
												e.stopPropagation();
												handleRemoveFolder(folder.id);
											}}
											title="删除文件夹"
										>
											<X className="tw-size-4" />
										</button>
									</div>
								))}
							</div>
						)}
						<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
							<div className="tw-flex tw-items-center tw-gap-2">
								<ModelSelector
									providers={service.getProviders()}
									value={state.selectedModelId ?? ''}
									onChange={(modelId) => service.setModel(modelId)}
								/>
								<span
									ref={fileMenuButtonRef}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										handleFileUpload();
									}}
									className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
									aria-label="上传文件"
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
									aria-label="Add image"
								>
									<ImageUp className="tw-size-4" />
								</span>
							</div>
							<div className="tw-flex tw-items-center tw-gap-2">
								<span
									onClick={(e) => {
										e.preventDefault();
										handleSubmit();
									}}
									className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center"
									aria-label={state.activeSession?.messages.some((msg) => msg.role !== 'system') ? 'Chat' : 'Save'}
								>
									<CornerDownLeft className="tw-size-4" />
									<span className="tw-ml-1 tw-text-xs">{state.activeSession?.messages.some((msg) => msg.role !== 'system') ? 'Chat' : 'Save'}</span>
								</span>
							</div>
						</div>
					</>
				) : (
					<>
								<textarea
							ref={textareaRef}
							className="tw-w-full tw-resize-none tw-p-3 tw-text-sm"
							style={{
								border: 'none',
								outline: 'none',
								background: 'transparent',
								resize: 'none',
								minHeight: '80px',
								maxHeight: `${maxHeight}px`,
								borderRadius: '0',
								boxShadow: 'none',
								marginBottom: '0',
								overflowY: 'auto'
							}}
							value={value}
							onChange={(event) => {
								setValue(event.target.value);
								service.setInputValue(event.target.value);
							}}
							placeholder="输入消息，按 Enter 发送，Shift+Enter 换行"
							disabled={state.isGenerating}
						/>
						{/* 图片预览区域 */}
						{state.selectedImages.length > 0 && (
							<div className="selected-images tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
								{state.selectedImages.map((image, index) => (
									<div key={image} className="image-preview-container tw-relative">
										<img
											src={image}
											alt={`selected-${index}`}
											className="selected-image-preview tw-w-16 tw-h-16 tw-object-cover tw-rounded tw-border tw-border-gray-300"
										/>
										<button
											type="button"
											className="remove-image-button tw-absolute tw-top-0 tw-right-0 tw-bg-red-500 tw-text-white tw-rounded-full tw-w-4 tw-h-4 tw-flex tw-items-center tw-justify-center tw-text-xs tw-cursor-pointer hover:tw-bg-red-600"
											onClick={() => handleRemoveImage(image)}
										>
											<X className="tw-size-3" />
										</button>
									</div>
								))}
							</div>
						)}

						{/* 文件标签区域 */}
						{(state.selectedFiles.length > 0 || state.selectedFolders.length > 0) && (
							<div className="selected-files tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
								{state.selectedFiles.map((file) => (
									<div key={file.id} className="file-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-gray-100 tw-text-gray-700 tw-rounded tw-text-xs tw-relative group">
										<FileText className="tw-size-3 tw-flex-shrink-0" />
										<span className="tw-max-w-40 tw-truncate" title={file.path}>
											{file.name}
											{file.extension === 'pdf' && (
												<span className="ml-1 tw-px-1 tw-bg-blue-500 tw-text-white tw-rounded tw-text-[10px]">pdf</span>
											)}
											{file.extension === 'canvas' && (
												<span className="ml-1 tw-px-1 tw-bg-green-500 tw-text-white tw-rounded tw-text-[10px]">canvas</span>
											)}
										</span>
										<button
											type="button"
											className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
											onClick={(e) => {
												e.stopPropagation();
												handleRemoveFile(file.id);
											}}
											title="删除文件"
										>
											<X className="tw-size-4" />
										</button>
									</div>
								))}
								{state.selectedFolders.map((folder) => (
									<div key={folder.id} className="folder-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-blue-100 tw-text-blue-700 tw-rounded tw-text-xs tw-relative group">
										<Folder className="tw-size-3 tw-flex-shrink-0" />
										<span className="tw-max-w-40 tw-truncate" title={folder.path}>
											{folder.name || folder.path}
										</span>
										<button
											type="button"
											className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
											onClick={(e) => {
												e.stopPropagation();
												handleRemoveFolder(folder.id);
											}}
											title="删除文件夹"
										>
											<X className="tw-size-4" />
										</button>
									</div>
								))}
							</div>
						)}
						<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
							<div className="tw-flex tw-items-center tw-gap-2">
								<ModelSelector
									providers={service.getProviders()}
									value={state.selectedModelId ?? ''}
									onChange={(modelId) => service.setModel(modelId)}
								/>
								<span
									ref={fileMenuButtonRef}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										handleFileUpload();
									}}
									className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
									aria-label="上传文件"
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
									aria-label="Add image"
								>
									<ImageUp className="tw-size-4" />
								</span>
							</div>
							<div className="tw-flex tw-items-center tw-gap-2">
								<span
									onClick={() => service.stopGeneration()}
									className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center"
									aria-label="Stop"
								>
									<StopCircle className="tw-size-4" />
									<span className="tw-ml-1 tw-text-xs">Stop</span>
								</span>
							</div>
						</div>
					</>
				)}
			</form>

			{/* 文件菜单弹出窗口 */}
			<FileMenuPopup
				isOpen={showFileMenu}
				onClose={() => setShowFileMenu(false)}
				onSelectFile={handleFileSelect}
				onSelectFolder={handleFolderSelect}
				app={app}
				buttonRef={fileMenuButtonRef}
			/>
					</Fragment>
	);
};

