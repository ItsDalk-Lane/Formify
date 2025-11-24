import { CornerDownLeft, StopCircle } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import { ModelSelector } from '../components/ModelSelector';
import { ContextControl } from '../components/ContextControl';
import { ImageUpload } from '../components/ImageUpload';

interface ChatInputProps {
	service: ChatService;
	state: ChatState;
}

export const ChatInput = ({ service, state }: ChatInputProps) => {
	const [value, setValue] = useState(state.inputValue);

	useEffect(() => {
		setValue(state.inputValue);
	}, [state.inputValue]);

	const handleSubmit = async (event?: FormEvent) => {
		event?.preventDefault();
		await service.sendMessage(value);
	};

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				handleSubmit();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [value]);

	return (
		<form className="chat-input tw-flex tw-w-full tw-flex-col tw-gap-2 tw-border-t tw-border-border tw-bg-background tw-p-2" onSubmit={handleSubmit}>
			<ContextControl
				contextNotes={state.contextNotes}
				onAdd={(note) => service.addContextNote(note)}
				onRemove={(note) => service.removeContextNote(note)}
			/>
			<ImageUpload
				images={state.selectedImages}
				onChange={(images) => service.setSelectedImages(images)}
				onRemove={(image) => service.removeSelectedImage(image)}
			/>
			<div className="tw-flex tw-items-center tw-gap-2">
				<textarea
					className="chat-input__editor"
					rows={state.isGenerating ? 2 : 4}
					value={value}
					onChange={(event) => {
						setValue(event.target.value);
						service.setInputValue(event.target.value);
					}}
					placeholder="输入消息，按 Ctrl/Cmd + Enter 发送"
					disabled={state.isGenerating}
				/>
			</div>
			<div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
				{!state.isGenerating ? (
					<>
						<ModelSelector
							providers={service.getProviders()}
							value={state.selectedModelId ?? ''}
							onChange={(modelId) => service.setModel(modelId)}
						/>
						<div className="tw-flex tw-items-center tw-gap-2">
							<button type="submit" className="chat-btn chat-btn--primary">
								<CornerDownLeft className="tw-size-4" />
								{state.activeSession?.messages.some((msg) => msg.role !== 'system') ? 'Chat' : 'Save'}
							</button>
						</div>
					</>
				) : (
					<div className="tw-flex tw-w-full tw-items-center tw-justify-between">
						<div className="tw-text-sm tw-text-muted">Generating...</div>
						<button type="button" className="chat-btn chat-btn--danger" onClick={() => service.stopGeneration()}>
							<StopCircle className="tw-size-4" />
							Stop
						</button>
					</div>
				)}
			</div>
		</form>
	);
};

