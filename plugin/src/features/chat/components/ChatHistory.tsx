import { X, RotateCcw, ExternalLink, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { ChatHistoryEntry } from '../services/HistoryService';

interface ChatHistoryPanelProps {
	items: ChatHistoryEntry[];
	onSelect: (item: ChatHistoryEntry) => void;
	onOpenFile: (item: ChatHistoryEntry) => void;
	onClose: () => void;
	onRefresh: () => Promise<void> | void;
	onDelete?: (item: ChatHistoryEntry) => void;
	anchorRef?: React.RefObject<HTMLElement>;
	panelRef?: React.RefObject<HTMLDivElement>;
}

export const ChatHistoryPanel = ({ items, onSelect, onOpenFile, onClose, onRefresh, onDelete, anchorRef, panelRef }: ChatHistoryPanelProps) => {
	const getPanelPosition = () => {
		if (anchorRef?.current) {
			const buttonRect = anchorRef.current.getBoundingClientRect();
			const gap = 8;

			// 计算水平位置：尽量靠右对齐按钮右侧
			const right = Math.max(12, window.innerWidth - buttonRect.right);

			// 计算垂直位置：显示在按钮上方
			const bottom = Math.max(12, window.innerHeight - buttonRect.top + gap);

			return { right, bottom };
		}
		return { right: 24, bottom: 80 };
	};

	const [position, setPosition] = useState(getPanelPosition);
	const internalPanelRef = useRef<HTMLDivElement>(null);

	// 将内部 ref 同步到外部 ref
	useEffect(() => {
		if (panelRef && internalPanelRef.current) {
			(panelRef as React.MutableRefObject<HTMLDivElement | null>).current = internalPanelRef.current;
		}
	}, [panelRef]);

	// 根据按钮位置动态计算面板位置
	useLayoutEffect(() => {
		setPosition(getPanelPosition());
	}, [anchorRef]);

	const panelContent = (
		<div ref={internalPanelRef} className="chat-history-panel" style={{ right: `${position.right}px`, bottom: `${position.bottom}px` }}>
			<header className="chat-history-panel__header">
				<h3>聊天历史</h3>
				<div className="chat-history-panel__header-actions">
					<span onClick={onRefresh} aria-label="刷新历史记录" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
						<RotateCcw className="tw-size-4" />
					</span>
					<span onClick={onClose} aria-label="关闭历史记录" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
						<X className="tw-size-4" />
					</span>
				</div>
			</header>
			<div className="chat-history-panel__content">
				{items.length === 0 ? (
					<p className="tw-text-muted">暂无历史会话</p>
				) : (
					<ul className="chat-history-list">
						{items.map((item) => (
							<li key={item.id} className="chat-history-item">
								<div 
									className="chat-history-item__info" 
									onClick={() => onSelect(item)}
								>
									<div className="chat-history-item__title">{item.title}</div>
									<div className="chat-history-item__meta">
										{new Date(item.createdAt).toLocaleString()}
									</div>
								</div>
								<div className="chat-history-item__actions">
									<button 
										className="chat-history-icon-btn" 
										onClick={(e) => {
											e.stopPropagation();
											onOpenFile(item);
										}}
										aria-label="打开文件"
									>
										<ExternalLink className="tw-size-3.5" />
									</button>
									{onDelete && (
										<button 
											className="chat-history-icon-btn chat-history-icon-btn--danger" 
											onClick={(e) => {
												e.stopPropagation();
												onDelete(item);
											}}
											aria-label="删除记录"
										>
											<Trash2 className="tw-size-3.5" />
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

	// 使用 Portal 将历史面板渲染到 document.body，避免被父容器截断
	return createPortal(panelContent, document.body);
};

