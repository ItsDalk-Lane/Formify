import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import type { ChatState, ChatMessage } from '../types/chat';
import { ChatService } from '../services/ChatService';
import { MessageItem } from '../components/MessageItem';
import { ParallelResponseViewer } from '../components/ParallelResponseViewer';
import { CompareTabBar } from '../components/CompareTabBar';
import { mergeMessagesWithParallelResponses } from '../utils/parallelMessages';

interface ChatMessagesProps {
	service: ChatService;
	state: ChatState;
}

type GroupedEntry = { type: 'single'; message: ChatMessage } | { type: 'parallel'; groupId: string; messages: ChatMessage[] };

function groupMessagesByParallelId(messages: ChatMessage[]): GroupedEntry[] {
	const result: GroupedEntry[] = [];
	let currentGroup: { groupId: string; messages: ChatMessage[] } | null = null;

	for (const msg of messages) {
		if (msg.parallelGroupId && msg.role === 'assistant') {
			if (currentGroup && currentGroup.groupId === msg.parallelGroupId) {
				currentGroup.messages.push(msg);
			} else {
				if (currentGroup) {
					result.push({ type: 'parallel', groupId: currentGroup.groupId, messages: currentGroup.messages });
				}
				currentGroup = { groupId: msg.parallelGroupId, messages: [msg] };
			}
		} else {
			if (currentGroup) {
				result.push({ type: 'parallel', groupId: currentGroup.groupId, messages: currentGroup.messages });
				currentGroup = null;
			}
			result.push({ type: 'single', message: msg });
		}
	}
	if (currentGroup) {
		result.push({ type: 'parallel', groupId: currentGroup.groupId, messages: currentGroup.messages });
	}

	return result;
}

/**
 * 过滤出指定模型的对话内容
 * 保留所有用户消息，但只保留指定模型的 assistant 消息
 */
function getConversationForModel(messages: ChatMessage[], modelTag: string): ChatMessage[] {
	return messages.filter(m => {
		if (m.role !== 'assistant') return true;
		if (m.parallelGroupId) return m.modelTag === modelTag;
		return true;
	});
}

export const ChatMessages = ({ state, service }: ChatMessagesProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const activeGeneratingMessageIdRef = useRef<string | null>(null);
	const latestMessageId = state.activeSession?.messages.last()?.id;
	const latestMessageContent = state.activeSession?.messages.last()?.content;
	const isGenerating = state.isGenerating;
	const parallelResponsesContent = state.parallelResponses?.responses?.map((r) => r.content).join('');
	const messages = state.activeSession?.messages ?? [];
	const isMultiModel = state.multiModelMode !== 'single';
	const isCompareMode = state.multiModelMode === 'compare';
	const layoutMode = state.layoutMode;

	// 对比模式：标签页布局的当前激活标签
	const [activeTabModel, setActiveTabModel] = useState<string | null>(null);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = scrollRef.current;
		if (!container) return;
		container.scrollTo({ top: container.scrollHeight, behavior });
	}, []);

	const findMessageElement = useCallback((messageId: string): HTMLElement | null => {
		const container = scrollRef.current;
		if (!container) return null;
		const elements = container.querySelectorAll<HTMLElement>('[data-chat-message-id]');
		for (const element of elements) {
			if (element.dataset.chatMessageId === messageId) {
				return element;
			}
		}
		return null;
	}, []);

	const focusMessageIntoView = useCallback((messageId: string, behavior: ScrollBehavior = 'smooth') => {
		const container = scrollRef.current;
		const element = findMessageElement(messageId);
		if (!container || !element) return;

		const padding = 16;
		const containerRect = container.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();
		const targetTop = container.scrollTop + (elementRect.top - containerRect.top) - padding;

		container.scrollTo({
			top: Math.max(0, targetTop),
			behavior
		});
	}, [findMessageElement]);

	const followMessageStream = useCallback((messageId: string, behavior: ScrollBehavior = 'auto') => {
		const container = scrollRef.current;
		const element = findMessageElement(messageId);
		if (!container || !element) return;

		const padding = 24;
		const containerRect = container.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();
		const overflowTop = elementRect.top - (containerRect.top + padding);
		const overflowBottom = elementRect.bottom - (containerRect.bottom - padding);

		if (overflowTop < 0) {
			container.scrollBy({ top: overflowTop, behavior });
			return;
		}

		if (overflowBottom > 0) {
			container.scrollBy({ top: overflowBottom, behavior });
		}
	}, [findMessageElement]);

	useEffect(() => {
		if (latestMessageId && !isCompareMode) scrollToBottom('smooth');
	}, [latestMessageId, isCompareMode, scrollToBottom]);

	useEffect(() => {
		if (!isCompareMode && isGenerating && (latestMessageContent || parallelResponsesContent)) {
			scrollToBottom('smooth');
		}
	}, [latestMessageContent, parallelResponsesContent, isGenerating, isCompareMode, scrollToBottom]);

	useEffect(() => {
		if (!isCompareMode && !isGenerating && latestMessageId) {
			setTimeout(() => scrollToBottom('smooth'), 100);
		}
	}, [isGenerating, latestMessageId, isCompareMode, scrollToBottom]);

	const filteredMessages = useMemo(
		() => messages.filter((m) => !m.metadata?.hidden),
		[messages]
	);
	const displayMessages = useMemo(
		() =>
			mergeMessagesWithParallelResponses(
				filteredMessages,
				isCompareMode ? state.parallelResponses : undefined
			),
		[filteredMessages, isCompareMode, state.parallelResponses]
	);

	// 对比模式共享逻辑：可用模型列表
	const availableModels = useMemo(() => {
		const fromState = state.selectedModels ?? [];
		const fromMessages = [...new Set(
			displayMessages.filter(m => m.role === 'assistant' && m.modelTag).map(m => m.modelTag!)
		)];
		return [...new Set([...fromState, ...fromMessages])];
	}, [state.selectedModels, displayMessages]);

	// 对比模式共享逻辑：流式生成状态派生
	const streamingTags = useMemo(() => {
		if (!state.parallelResponses || !state.isGenerating) return new Set<string>();
		return new Set(state.parallelResponses.responses
			.filter(r => !r.isComplete && !r.isError).map(r => r.modelTag));
	}, [state.parallelResponses, state.isGenerating]);

	// 对比模式共享逻辑：错误状态派生
	const errorTags = useMemo(() => {
		if (!state.parallelResponses) return new Set<string>();
		return new Set(state.parallelResponses.responses
			.filter(r => r.isError).map(r => r.modelTag));
	}, [state.parallelResponses]);

	// 初始化 activeTabModel
	useEffect(() => {
		if (isCompareMode && layoutMode === 'tabs' && availableModels.length > 0 && !activeTabModel) {
			setActiveTabModel(availableModels[0]);
		}
	}, [isCompareMode, layoutMode, availableModels, activeTabModel]);

	// 自动校正 activeTabModel（若当前模型不在列表中则切到首个）
	useEffect(() => {
		if (isCompareMode && layoutMode === 'tabs' && activeTabModel && !availableModels.includes(activeTabModel)) {
			setActiveTabModel(availableModels[0] ?? null);
		}
	}, [isCompareMode, layoutMode, activeTabModel, availableModels]);

	// 标签页切换时滚动到底部
	const handleTabChange = useCallback((modelTag: string) => {
		setActiveTabModel(modelTag);
		scrollToBottom('auto');
	}, [scrollToBottom]);

	// 判断消息是否正在生成
	const isMessageGenerating = useCallback((msg: ChatMessage): boolean => {
		if (msg.role !== 'assistant') return false;
		if (!isGenerating) return false;
		if (!msg.parallelGroupId) return false;
		if (state.parallelResponses?.groupId !== msg.parallelGroupId) return false;
		return streamingTags.has(msg.modelTag ?? '');
	}, [isGenerating, state.parallelResponses, streamingTags]);

	const generatingMessageId = useMemo(() => {
		const generatingMessages = displayMessages.filter((message) => isMessageGenerating(message));
		if (generatingMessages.length === 0) {
			return null;
		}

		if (layoutMode === 'tabs' && activeTabModel) {
			return generatingMessages.find((message) => message.modelTag === activeTabModel)?.id
				?? generatingMessages[0]?.id
				?? null;
		}

		return generatingMessages.length === 1
			? generatingMessages[0]?.id ?? null
			: generatingMessages[generatingMessages.length - 1]?.id ?? null;
	}, [displayMessages, isMessageGenerating, layoutMode, activeTabModel]);

	useEffect(() => {
		if (!isCompareMode || !isGenerating || !generatingMessageId) {
			activeGeneratingMessageIdRef.current = null;
			return;
		}

		if (activeGeneratingMessageIdRef.current !== generatingMessageId) {
			activeGeneratingMessageIdRef.current = generatingMessageId;
			focusMessageIntoView(generatingMessageId, 'smooth');
			return;
		}

		followMessageStream(generatingMessageId, 'auto');
	}, [
		isCompareMode,
		isGenerating,
		generatingMessageId,
		parallelResponsesContent,
		focusMessageIntoView,
		followMessageStream
	]);

	const grouped = useMemo(
		() => (isMultiModel ? groupMessagesByParallelId(displayMessages) : null),
		[displayMessages, isMultiModel]
	);

	const containerClasses = useMemo(
		() => [
			'tw-flex', 'tw-h-full', 'tw-flex-1', 'tw-flex-col',
			'tw-overflow-hidden', 'tw-text-[calc(var(--font-text-size)_-_2px)]'
		].join(' '),
		[]
	);

	// ==================== 标签页布局 ====================
	if (isCompareMode && layoutMode === 'tabs') {
		const tabMessages = activeTabModel ? getConversationForModel(displayMessages, activeTabModel) : [];

		return (
			<div className={containerClasses}>
				<CompareTabBar
					models={availableModels}
					activeModel={activeTabModel}
					onSelect={handleTabChange}
					streamingTags={streamingTags}
					errorTags={errorTags}
					service={service}
				/>
				<div
					ref={scrollRef}
					className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-scroll-smooth tw-select-text tw-break-words tw-gap-2"
				>
					{tabMessages.map((message) => (
						<MessageItem
							key={message.id}
							message={message}
							service={service}
							isGenerating={isMessageGenerating(message)}
							hideModelTag={true}
						/>
					))}
				</div>
			</div>
		);
	}

	// ==================== 并排/垂直布局 ====================
	if (isCompareMode && (layoutMode === 'horizontal' || layoutMode === 'vertical')) {
		return (
			<div className={containerClasses}>
				<div
					ref={scrollRef}
					className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-scroll-smooth tw-select-text tw-break-words tw-gap-2"
				>
					{grouped?.map((entry) => {
						// 用户消息或非并行消息：全宽显示
						if (entry.type === 'single') {
							return (
								<MessageItem
									key={entry.message.id}
									message={entry.message}
									service={service}
									isGenerating={isMessageGenerating(entry.message)}
								/>
							);
						}

						// 并行 AI 回复组：根据布局模式渲染
						const messages = entry.messages;
						if (layoutMode === 'horizontal') {
							// 并排模式：CSS Grid
							const gridStyle: React.CSSProperties = {
								display: 'grid',
								gridTemplateColumns: messages.length > 4
									? `repeat(${messages.length}, minmax(280px, 1fr))`
									: `repeat(${messages.length}, 1fr)`,
								gap: '8px',
								margin: '0 0.5rem',
								overflowX: messages.length > 4 ? 'auto' : 'visible',
							};
							return (
								<div key={entry.groupId} style={gridStyle}>
									{messages.map((msg) => (
										<div
											key={msg.id}
											style={{
												border: '1px solid var(--background-modifier-border)',
												borderRadius: 'var(--radius-m)',
												minWidth: '280px',
											}}
										>
											<MessageItem
												message={msg}
												service={service}
												isGenerating={isMessageGenerating(msg)}
											/>
										</div>
									))}
								</div>
							);
						} else {
							// 垂直模式：flex column
							return (
								<div key={entry.groupId} style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '0 0.5rem' }}>
									{messages.map((msg) => (
										<div
											key={msg.id}
											style={{
												border: '1px solid var(--background-modifier-border)',
												borderRadius: 'var(--radius-m)',
											}}
										>
											<MessageItem
												message={msg}
												service={service}
												isGenerating={isMessageGenerating(msg)}
											/>
										</div>
									))}
								</div>
							);
						}
					})}
				</div>
			</div>
		);
	}

	// ==================== 单模型模式（保持原有逻辑） ====================
	return (
		<div className={containerClasses}>
			<div
				ref={scrollRef}
				className="tw-flex tw-flex-1 tw-flex-col tw-overflow-y-auto tw-scroll-smooth tw-select-text tw-break-words tw-gap-2"
			>
				{isMultiModel && grouped ? (
					grouped.map((entry) => {
						if (entry.type === 'single') {
							return (
								<MessageItem
									key={entry.message.id}
									message={entry.message}
									service={service}
									isGenerating={
										entry.message.role === 'assistant' &&
										entry.message.id === displayMessages[displayMessages.length - 1]?.id &&
										isGenerating
									}
								/>
							);
						}
						return (
							<ParallelResponseViewer
								key={entry.groupId}
								messages={entry.messages}
								layoutMode={state.layoutMode}
								service={service}
								parallelResponses={
									state.parallelResponses?.groupId === entry.groupId
										? state.parallelResponses
										: undefined
								}
								isGenerating={isGenerating}
							/>
						);
					})
				) : (
					displayMessages.map((message, index) => (
						<MessageItem
							key={message.id}
							message={message}
							service={service}
							isGenerating={
								message.role === 'assistant' &&
								index === displayMessages.length - 1 &&
								isGenerating
							}
						/>
					))
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
