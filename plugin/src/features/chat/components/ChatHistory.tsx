import { X } from 'lucide-react';
import { ChatHistoryEntry } from '../services/HistoryService';

interface ChatHistoryPanelProps {
	items: ChatHistoryEntry[];
	onSelect: (item: ChatHistoryEntry) => void;
	onClose: () => void;
	onRefresh: () => Promise<void> | void;
	onDelete?: (item: ChatHistoryEntry) => void;
}

export const ChatHistoryPanel = ({ items, onSelect, onClose, onRefresh, onDelete }: ChatHistoryPanelProps) => {
	return (
		<div className="chat-history-panel">
			<header className="chat-history-panel__header">
				<h3>聊天历史</h3>
				<div className="chat-history-panel__header-actions">
					<button className="chat-btn" onClick={onRefresh}>
						刷新
					</button>
					<button className="chat-icon-btn" onClick={onClose}>
						<X className="tw-size-4" />
					</button>
				</div>
			</header>
			<div className="chat-history-panel__content">
				{items.length === 0 ? (
					<p className="tw-text-muted">暂无历史会话</p>
				) : (
					<ul className="chat-history-list">
						{items.map((item) => (
							<li key={item.id} className="chat-history-item">
								<div>
									<div className="chat-history-item__title">{item.title}</div>
									<div className="chat-history-item__meta">
										{new Date(item.updatedAt).toLocaleString()}
										{item.modelId ? ` · ${item.modelId}` : ''}
									</div>
								</div>
								<div className="chat-history-item__actions">
									<button className="chat-btn" onClick={() => onSelect(item)}>
										打开
									</button>
									{onDelete && (
										<button className="chat-btn chat-btn--danger" onClick={() => onDelete(item)}>
											删除
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};

