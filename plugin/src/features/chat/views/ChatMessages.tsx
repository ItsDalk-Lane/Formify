import { useEffect, useMemo, useRef } from 'react';
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

	useEffect(() => {
		const container = scrollRef.current;
		if (!container) return;
		container.scrollTo({
			top: container.scrollHeight,
			behavior: 'smooth'
		});
	}, [latestMessageId]);

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
				{messages.map((message) => (
					<MessageItem key={message.id} message={message} service={service} />
				))}
				{state.isGenerating && (
					<div className="tw-mx-2 tw-my-1 tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-2 tw-text-muted">
						AI 正在思考中...
					</div>
				)}
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


