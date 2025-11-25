import { useEffect, useMemo, useRef, useCallback } from 'react';
import type { ChatState } from '../types/chat';
import { ChatService } from '../services/ChatService';
import { MessageItem } from '../components/MessageItem';

interface ChatMessagesProps {
	service: ChatService;
	state: ChatState;
}

export const ChatMessages = ({ state, service }: ChatMessagesProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const latestMessageId = state.activeSession?.messages.last()?.id;
	const latestMessageContent = state.activeSession?.messages.last()?.content;
	const isGenerating = state.isGenerating;

	// 自动滚动到底部的函数
	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = scrollRef.current;
		if (!container) return;
		container.scrollTo({
			top: container.scrollHeight,
			behavior
		});
	}, []);

	// 当新消息创建时滚动
	useEffect(() => {
		if (latestMessageId) {
			// 使用即时滚动确保新消息立即可见
			scrollToBottom('smooth');
		}
	}, [latestMessageId, scrollToBottom]);

	// 当消息内容增长时滚动（用于流式生成）
	useEffect(() => {
		if (isGenerating && latestMessageContent) {
			// 在生成过程中使用即时滚动，确保用户始终看到最新内容
			scrollToBottom('smooth');
		}
	}, [latestMessageContent, isGenerating, scrollToBottom]);

	// 当生成状态从true变为false时，确保最终滚动到底部
	useEffect(() => {
		if (!isGenerating && latestMessageId) {
			// 生成结束时滚动一次，确保看到完整内容
			setTimeout(() => {
				scrollToBottom('smooth');
			}, 100);
		}
	}, [isGenerating, latestMessageId, scrollToBottom]);

	const messages = state.activeSession?.messages ?? [];
	const contextNotes = useMemo(() => {
		const sessionNotes = state.activeSession?.contextNotes ?? [];
		return Array.from(new Set([...sessionNotes, ...state.contextNotes]));
	}, [state.activeSession?.contextNotes, state.contextNotes]);

	const containerClasses = useMemo(
		() =>
			[
				'tw-flex',
				'tw-h-full',
				'tw-flex-1',
				'tw-flex-col',
				'tw-overflow-hidden',
				'tw-text-[calc(var(--font-text-size)_-_2px)]'
			].join(' '),
		[]
	);

	return (
		<div className={containerClasses}>
			<RelevantNotes notes={contextNotes} />
				<div
				ref={scrollRef}
				className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-scroll-smooth tw-select-text tw-break-words tw-gap-2"
			>
				{messages.map((message, index) => (
					<MessageItem
						key={message.id}
						message={message}
						service={service}
						isGenerating={message.role === 'assistant' && index === messages.length - 1 && state.isGenerating}
					/>
				))}
			</div>
		</div>
	);
};

const RelevantNotes = ({ notes }: { notes: string[] }) => {
	if (!notes.length) return null;
	return (
		<section className="chat-panel tw-mx-2 tw-mb-2 tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-2">
			<header className="tw-mb-1 tw-text-xs tw-text-muted-foreground">Relevant Notes</header>
			<ul className="tw-list-disc tw-pl-5 tw-text-[calc(var(--font-text-size)_-_2px)]">
				{notes.map((note) => (
					<li key={note}>{note}</li>
				))}
			</ul>
		</section>
	);
};


