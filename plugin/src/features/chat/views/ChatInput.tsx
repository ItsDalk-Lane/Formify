import { CornerDownLeft, StopCircle, ImageUp } from 'lucide-react';
import { FormEvent, useEffect, useState, useRef } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import { ModelSelector } from '../components/ModelSelector';

interface ChatInputProps {
	service: ChatService;
	state: ChatState;
}

export const ChatInput = ({ service, state }: ChatInputProps) => {
	const [value, setValue] = useState(state.inputValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [maxHeight, setMaxHeight] = useState(80); // Default minimum height

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
					<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
						<ModelSelector
							providers={service.getProviders()}
							value={state.selectedModelId ?? ''}
							onChange={(modelId) => service.setModel(modelId)}
						/>
						<div className="tw-flex tw-items-center tw-gap-2">
							<span
								onClick={() => {
									// 触发图片上传
									const input = document.createElement('input');
									input.type = 'file';
									input.accept = 'image/*';
									input.multiple = true;
									input.onchange = (e) => {
										const files = Array.from(e.target.files || []);
										if (files.length > 0) {
											service.addSelectedImages(files);
										}
									};
									input.click();
								}}
								className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
								aria-label="Add image"
							>
								<ImageUp className="tw-size-4" />
							</span>
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
					<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
						<ModelSelector
							providers={service.getProviders()}
							value={state.selectedModelId ?? ''}
							onChange={(modelId) => service.setModel(modelId)}
						/>
						<div className="tw-flex tw-items-center tw-gap-2">
							<span
								onClick={() => {
									const input = document.createElement('input');
									input.type = 'file';
									input.accept = 'image/*';
									input.multiple = true;
									input.onchange = (e) => {
										const files = Array.from(e.target.files || []);
										if (files.length > 0) {
											service.addSelectedImages(files);
										}
									};
									input.click();
								}}
								className="tw-cursor-pointer tw-text-muted hover:tw-text-accent"
								aria-label="Add image"
							>
								<ImageUp className="tw-size-4" />
							</span>
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
	);
};

