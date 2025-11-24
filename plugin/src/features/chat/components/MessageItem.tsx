import { Check, Copy, PenSquare, RotateCw, TextCursorInput, Trash2 } from 'lucide-react';
import { Component } from 'obsidian';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import type { ChatMessage } from '../types/chat';
import { ChatService } from '../services/ChatService';
import { MessageService } from '../services/MessageService';
import { renderMarkdownContent } from '../utils/markdown';

interface MessageItemProps {
	message: ChatMessage;
	service?: ChatService;
}

export const MessageItem = ({ message, service }: MessageItemProps) => {
	const app = useObsidianApp();
	const helper = useMemo(() => new MessageService(), []);
	const containerRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef(new Component());
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);

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

	const handleSaveEdit = () => {
		service?.editMessage(message.id, draft);
		setEditing(false);
	};

	const handleInsert = () => service?.insertMessageToEditor(message.id);

	const handleRegenerate = () => service?.regenerateFromMessage(message.id);

	const roleClass =
		message.role === 'user'
			? 'chat-message--user'
			: message.role === 'assistant'
				? 'chat-message--assistant'
				: 'chat-message--system';

	return (
		<div className={`chat-message tw-mx-2 tw-my-1 tw-rounded-md tw-p-2 ${roleClass} ${message.isError ? 'chat-message--error' : ''}`}>
			<div className="chat-message__content tw-whitespace-pre-wrap tw-break-words">
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
			<div className="chat-message__meta tw-flex tw-items-center tw-justify-between">
				<span className="tw-text-xs tw-text-faint">{timestamp}</span>
				<div className="chat-message__actions tw-flex tw-items-center tw-gap-1">
					<button className="chat-icon-btn" onClick={handleCopy} aria-label="复制消息">
						{copied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
					</button>
					{message.role === 'user' && !editing && (
						<button className="chat-icon-btn" onClick={() => setEditing(true)} aria-label="编辑消息">
							<PenSquare className="tw-size-4" />
						</button>
					)}
					{message.role === 'user' && editing && (
						<button className="chat-icon-btn" onClick={handleSaveEdit} aria-label="保存编辑">
							<Check className="tw-size-4" />
						</button>
					)}
					<button className="chat-icon-btn" onClick={handleDelete} aria-label="删除消息">
						<Trash2 className="tw-size-4" />
					</button>
					{message.role === 'assistant' && (
						<>
							<button className="chat-icon-btn" onClick={handleInsert} aria-label="插入到编辑器">
								<TextCursorInput className="tw-size-4" />
							</button>
							<button className="chat-icon-btn" onClick={handleRegenerate} aria-label="重新生成">
								<RotateCw className="tw-size-4" />
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
};

