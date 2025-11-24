import { History, MessageCirclePlus, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import type { ChatHistoryEntry } from '../services/HistoryService';
import { ChatHistoryPanel } from '../components/ChatHistory';

interface ChatControlsProps {
	service: ChatService;
	state: ChatState;
}

export const ChatControls = ({ service, state }: ChatControlsProps) => {
	const [historyOpen, setHistoryOpen] = useState(false);
	const [historyItems, setHistoryItems] = useState<ChatHistoryEntry[]>([]);

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

	return (
		<div className="chat-controls tw-flex tw-items-center tw-justify-between tw-border-t tw-border-border tw-px-2 tw-py-1.5">
			<div className="tw-text-xs tw-text-muted-foreground">
				Tokens <span className="tw-font-semibold">{tokenCount}</span>
			</div>
			<div className="tw-flex tw-items-center tw-gap-1.5">
				<button className="chat-icon-btn" onClick={handleNewChat} aria-label="新建聊天">
					<MessageCirclePlus className="tw-size-4" />
				</button>
				<button
					className="chat-icon-btn"
					onClick={() => service.saveActiveSession()}
					aria-label="保存聊天"
					disabled={!state.activeSession}
				>
					<Save className="tw-size-4" />
				</button>
				<button className="chat-icon-btn" onClick={() => setHistoryOpen((prev) => !prev)} aria-label="历史记录">
					<History className="tw-size-4" />
				</button>
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
		</div>
	);
};

