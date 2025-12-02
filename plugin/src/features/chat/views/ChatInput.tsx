import { CornerDownLeft, StopCircle, X, FileText, Folder, Palette, Zap } from 'lucide-react';
import { FormEvent, useEffect, useState, useRef, Fragment } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState, SelectedFile, SelectedFolder } from '../types/chat';
import { ModelSelector } from '../components/ModelSelector';
import { TemplateSelector } from '../components/TemplateSelector';
import { App } from 'obsidian';

interface ChatInputProps {
	service: ChatService;
	state: ChatState;
	app: App;
}

export const ChatInput = ({ service, state, app }: ChatInputProps) => {
	const [value, setValue] = useState(state.inputValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [maxHeight, setMaxHeight] = useState(80); // Default minimum height

	// 检测当前输入是否包含图片生成意图
	const [isImageGenerationIntent, setIsImageGenerationIntent] = useState(false);
	
	// 检测图片生成意图的函数
	const detectImageGenerationIntent = (text: string): boolean => {
		if (!text) return false;
		
		const lowerContent = text.toLowerCase();
		
		// 图片生成关键词列表
		const imageGenerationKeywords = [
			// 中文关键词
			'生成图片', '生成图像', '画一个', '画一张', '创建图片', '创建图像',
			'绘制', '画一幅', '画一幅画', '生成一幅画', '画个', '画张',
			'图片生成', '图像生成', '画图', '作画', '绘画',
			'设计一个', '设计一张', '创作一个', '创作一张',
			'制作图片', '制作图像', '制作一张图',
			// 英文关键词
			'generate image', 'generate an image', 'create image', 'create an image',
			'draw a', 'draw an', 'draw me a', 'draw me an',
			'paint a', 'paint an', 'paint me a', 'paint me an',
			'make a picture', 'make an image', 'create a picture',
			'generate a picture', 'generate picture', 'create picture',
			'design a', 'design an', 'design me a', 'design me an',
			'make a', 'make an', 'make me a', 'make me an',
			'visualize', 'visualize a', 'visualize an',
			'show me a', 'show me an', 'display a', 'display an'
		];
		
		// 检查是否包含任何图片生成关键词
		return imageGenerationKeywords.some(keyword => lowerContent.includes(keyword));
	};
	
	// 监听输入变化，检测图片生成意图
	useEffect(() => {
		setIsImageGenerationIntent(detectImageGenerationIntent(value));
	}, [value]);

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

	const handleRemoveImage = (image: string) => {
		service.removeSelectedImage(image);
	};

	const handleRemoveFile = (fileId: string) => {
		service.removeSelectedFile(fileId);
	};

	const handleRemoveFolder = (folderId: string) => {
		service.removeSelectedFolder(folderId);
	};

	// 模板选择相关处理函数
	const handleTemplateSelect = async (templatePath: string) => {
		await service.selectPromptTemplate(templatePath);
		// 选择模板后，将焦点返回到输入框
		textareaRef.current?.focus();
	};

	const handleTemplateSelectorClose = () => {
		service.setTemplateSelectorVisibility(false);
	};

	const handleClearTemplate = () => {
		service.clearSelectedPromptTemplate();
	};

	const handleTemplateButtonClick = () => {
		service.setTemplateSelectorVisibility(true);
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
				{/* 显示当前选中的模板标签 */}
				{state.selectedPromptTemplate && (
					<div className="selected-template tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs tw-mb-2">
						<Zap className="tw-size-3 tw-flex-shrink-0" />
						<span className="tw-max-w-40 tw-truncate" title={state.selectedPromptTemplate.name}>
							模板: {state.selectedPromptTemplate.name}
						</span>
						<button
							type="button"
							className="tw-ml-1 tw-p-0 tw-text-purple-700 hover:tw-text-purple-900 tw-cursor-pointer"
							onClick={(e) => {
								e.stopPropagation();
								handleClearTemplate();
							}}
							title="清除模板"
						>
							<X className="tw-size-4" />
						</button>
					</div>
				)}
				
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
						{/* 显示当前选中的模板标签 */}
						{state.selectedPromptTemplate && (
							<div className="selected-template tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs tw-mb-2">
								<Zap className="tw-size-3 tw-flex-shrink-0" />
								<span className="tw-max-w-40 tw-truncate" title={state.selectedPromptTemplate.name}>
									模板: {state.selectedPromptTemplate.name}
								</span>
								<button
									type="button"
									className="tw-ml-1 tw-p-0 tw-text-purple-700 hover:tw-text-purple-900 tw-cursor-pointer"
									onClick={(e) => {
										e.stopPropagation();
										handleClearTemplate();
									}}
									title="清除模板"
								>
									<X className="tw-size-4" />
								</button>
							</div>
						)}
						
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

								{/* 图片生成状态提示 */}
								{isImageGenerationIntent && (
									<div className="tw-flex tw-items-center tw-gap-1 tw-ml-2 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs">
										<Palette className="tw-size-3" />
										<span>图片生成模式</span>
									</div>
								)}
							</div>
						</div>
					</>
				)}
			</form>

		{/* 模板选择器 */}
		<TemplateSelector
			visible={state.showTemplateSelector}
			onSelect={handleTemplateSelect}
			onClose={handleTemplateSelectorClose}
			inputValue={value}
		/>
			</Fragment>
	);
};

