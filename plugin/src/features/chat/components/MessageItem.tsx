import { Check, Copy, PenSquare, RotateCw, TextCursorInput, Trash2, X, Maximize2, Download, Highlighter } from 'lucide-react';
import { Component, Platform } from 'obsidian';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import type { ChatMessage } from '../types/chat';
import { ChatService } from '../services/ChatService';
import { MessageService } from '../services/MessageService';
import { renderMarkdownContent } from '../utils/markdown';
import { Notice } from 'obsidian';

interface MessageItemProps {
	message: ChatMessage;
	service?: ChatService;
	isGenerating?: boolean;
}

export const MessageItem = ({ message, service, isGenerating }: MessageItemProps) => {
	const app = useObsidianApp();
	const helper = useMemo(() => new MessageService(), []);
	const containerRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef(new Component());
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);
	const [previewImage, setPreviewImage] = useState<string | null>(null);

	const timestamp = useMemo(() => helper.formatTimestamp(message.timestamp), [helper, message.timestamp]);

	useEffect(() => {
		if (!containerRef.current || editing) return;
		void renderMarkdownContent(app, message.content, containerRef.current, componentRef.current);
		return () => {
			componentRef.current.unload();
		};
	}, [app, message.content, editing]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error('[Chat] 复制失败', error);
		}
	};

	const handleDelete = () => {
		service?.deleteMessage(message.id);
	};

	const handleSaveEdit = async () => {
		// 立即退出编辑模式
		setEditing(false);

		if (service) {
			await service.editAndRegenerate(message.id, draft);
		}
	};

	const handleCancelEdit = () => {
		setDraft(message.content); // 恢复原始内容
		setEditing(false);
	};

	const handleInsert = () => service?.insertMessageToEditor(message.id);

	const handleRegenerate = () => service?.regenerateFromMessage(message.id);

	// 处理图片点击，打开预览
	const handleImageClick = (imageSrc: string) => {
		setPreviewImage(imageSrc);
	};

	// 关闭图片预览
	const closeImagePreview = () => {
		setPreviewImage(null);
	};

	// 下载图片
	const handleDownloadImage = async (imageSrc: string, index: number) => {
		try {
			// 如果是Obsidian附件格式，提取文件名
			const attachmentMatch = imageSrc.match(/\!\[\[(.*?)\|/);
			let fileName = `generated-image-${index + 1}.png`;
			
			if (attachmentMatch) {
				fileName = attachmentMatch[1];
			} else if (imageSrc.startsWith('data:')) {
				// 如果是base64格式，使用默认文件名
				fileName = `generated-image-${index + 1}.png`;
			} else if (imageSrc.startsWith('http')) {
				// 如果是URL，使用URL中的文件名或默认文件名
				const urlParts = imageSrc.split('/');
				const urlFileName = urlParts[urlParts.length - 1];
				fileName = urlFileName.includes('.') ? urlFileName : `generated-image-${index + 1}.png`;
			}

			// 创建下载链接
			let downloadUrl = imageSrc;
			
			if (imageSrc.startsWith('data:')) {
				// Base64图片直接下载
				const link = document.createElement('a');
				link.href = imageSrc;
				link.download = fileName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			} else if (imageSrc.startsWith('http')) {
				// URL图片需要先获取
				const response = await fetch(imageSrc);
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download = fileName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			} else if (imageSrc.includes('[[') && imageSrc.includes(']]')) {
				// Obsidian附件，尝试获取文件
				const attachmentPath = imageSrc.match(/\!\[\[(.*?)\|/)?.[1] || imageSrc.match(/\!\[\[(.*?)\]\]/)?.[1];
				if (attachmentPath) {
					const file = app.vault.getAbstractFileByPath(attachmentPath);
					if (file instanceof app.vault.adapter.constructor.file) {
						const arrayBuffer = await app.vault.readBinary(file);
						const blob = new Blob([arrayBuffer]);
						const url = URL.createObjectURL(blob);
						const link = document.createElement('a');
						link.href = url;
						link.download = file.name;
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						URL.revokeObjectURL(url);
					}
				}
			}
		} catch (error) {
			console.error('[Chat] 下载图片失败', error);
			new Notice('下载图片失败，请稍后再试');
		}
	};

	const roleClass =
		message.role === 'user'
			? 'chat-message--user'
			: message.role === 'assistant'
				? 'chat-message--assistant'
				: 'chat-message--system';

	return (
		<>
			<div className={`group tw-mx-2 tw-my-1 tw-rounded-md tw-p-2 ${roleClass} ${message.isError ? 'chat-message--error' : ''}`}>
				{/* 显示图片 */}
				{message.images && message.images.length > 0 && (
					<div className="message-images tw-mb-2 tw-flex tw-flex-wrap tw-gap-2">
						{message.images.map((image, index) => (
							<div key={index} className="tw-relative tw-group/image">
								<img 
									src={image} 
									alt={`message-image-${index}`} 
									className="message-image tw-max-w-xs tw-rounded-md tw-border tw-border-gray-300 tw-cursor-pointer hover:tw-opacity-80 tw-transition-opacity" 
									style={{ maxHeight: '200px' }}
									onClick={() => handleImageClick(image)}
								/>
								{/* 图片操作按钮 */}
								<div className="tw-absolute tw-top-2 tw-right-2 tw-opacity-0 group-hover/image:tw-opacity-100 tw-transition-opacity tw-flex tw-gap-1">
									<button
										onClick={() => handleImageClick(image)}
										className="tw-bg-black tw-bg-opacity-50 tw-text-white tw-rounded tw-p-1 tw-cursor-pointer hover:tw-bg-opacity-70"
										title="查看大图"
									>
										<Maximize2 className="tw-size-3" />
									</button>
									<button
										onClick={() => handleDownloadImage(image, index)}
										className="tw-bg-black tw-bg-opacity-50 tw-text-white tw-rounded tw-p-1 tw-cursor-pointer hover:tw-bg-opacity-70"
										title="下载图片"
									>
										<Download className="tw-size-3" />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
				
				{/* 处理消息内容中的图片（Obsidian附件格式）*/}
				{!message.images || message.images.length === 0 && (
					// 这里可以添加对消息内容中图片的处理逻辑
					<div></div>
				)}

				{/* 显示选中文本标签 */}
				{message.metadata?.selectedText && typeof message.metadata.selectedText === 'string' && (
					<div className="message-selected-text tw-mb-2">
						<div className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-orange-100 tw-text-orange-700 tw-rounded tw-text-xs">
							<Highlighter className="tw-size-3 tw-flex-shrink-0" />
							<span className="tw-max-w-60 tw-truncate" title={message.metadata.selectedText}>
								{message.metadata.selectedText.length > 50
									? message.metadata.selectedText.substring(0, 50) + '...'
									: message.metadata.selectedText}
							</span>
						</div>
					</div>
				)}

				<div className="chat-message__content tw-break-words">
					{editing ? (
						<textarea
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							className="chat-message__editor"
							rows={4}
						/>
					) : (
						<div ref={containerRef}></div>
					)}
				</div>
				{/* 只在AI消息非生成状态或非AI消息时显示元数据 */}
				{(message.role !== 'assistant' || !isGenerating) && (
					<div className="chat-message__meta tw-flex tw-items-center tw-justify-between">
						<span className="tw-text-xs tw-text-faint">{timestamp}</span>
						<div className="chat-message__actions tw-flex tw-items-center tw-gap-2 tw-opacity-100 hover:tw-opacity-100 tw-transition-opacity">
							{/* User message buttons */}
							{message.role === 'user' && (
								<>
									<span onClick={handleCopy} aria-label="复制消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										{copied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
									</span>
									{!editing && (
										<span onClick={() => setEditing(true)} aria-label="编辑消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
											<PenSquare className="tw-size-4" />
										</span>
									)}
									{editing && (
										<>
											<span onClick={handleCancelEdit} aria-label="取消编辑" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
												<X className="tw-size-4" />
											</span>
											<span onClick={handleSaveEdit} aria-label="保存编辑" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
												<Check className="tw-size-4" />
											</span>
										</>
									)}
									<span onClick={handleDelete} aria-label="删除消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<Trash2 className="tw-size-4" />
									</span>
								</>
							)}
							{/* AI message buttons */}
							{message.role === 'assistant' && (
								<>
									<span onClick={handleInsert} aria-label="插入到编辑器" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<TextCursorInput className="tw-size-4" />
									</span>
									<span onClick={handleCopy} aria-label="复制消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										{copied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
									</span>
									<span onClick={handleRegenerate} aria-label="重新生成" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<RotateCw className="tw-size-4" />
									</span>
									<span onClick={handleDelete} aria-label="删除消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<Trash2 className="tw-size-4" />
									</span>
								</>
							)}
						</div>
					</div>
				)}
			</div>
			
			{/* 图片预览模态框 */}
			{previewImage && (
				<div 
					className="tw-fixed tw-inset-0 tw-bg-black tw-bg-opacity-75 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4"
					onClick={closeImagePreview}
				>
					<div className="tw-relative tw-max-w-full tw-max-h-full">
						<img 
							src={previewImage} 
							alt="预览图片" 
							className="tw-max-w-full tw-max-h-full tw-object-contain tw-rounded-md"
						/>
						<button
							onClick={closeImagePreview}
							className="tw-absolute tw-top-2 tw-right-2 tw-bg-white tw-rounded-full tw-p-2 tw-shadow-lg tw-cursor-pointer hover:tw-bg-gray-100"
						>
							<X className="tw-size-4 tw-text-black" />
						</button>
					</div>
				</div>
			)}
		</>
	);
};