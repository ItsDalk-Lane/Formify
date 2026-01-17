import { X, RotateCcw, ExternalLink, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
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

type TimeGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';

interface GroupedHistory {
	group: TimeGroup;
	label: string;
	items: ChatHistoryEntry[];
}

/**
 * 根据时间戳判断所属时间分组
 */
function getTimeGroup(timestamp: number): TimeGroup {
	const now = new Date();
	const date = new Date(timestamp);
	
	// 获取今天的开始时间（0:00:00）
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
	const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
	const monthStart = todayStart - 30 * 24 * 60 * 60 * 1000;
	
	const itemTime = date.getTime();
	
	if (itemTime >= todayStart) {
		return 'today';
	} else if (itemTime >= yesterdayStart) {
		return 'yesterday';
	} else if (itemTime >= weekStart) {
		return 'week';
	} else if (itemTime >= monthStart) {
		return 'month';
	} else {
		return 'older';
	}
}

/**
 * 获取时间分组的显示标签
 */
function getGroupLabel(group: TimeGroup): string {
	switch (group) {
		case 'today': return '今天';
		case 'yesterday': return '昨天';
		case 'week': return '7天内';
		case 'month': return '30天内';
		case 'older': return '更早';
	}
}

/**
 * 将历史记录按时间分组
 */
function groupHistoryByTime(items: ChatHistoryEntry[]): GroupedHistory[] {
	const groups: Record<TimeGroup, ChatHistoryEntry[]> = {
		today: [],
		yesterday: [],
		week: [],
		month: [],
		older: []
	};
	
	// 按 updatedAt 分组（如果没有 updatedAt 则使用 createdAt）
	for (const item of items) {
		const timestamp = item.updatedAt || item.createdAt;
		const group = getTimeGroup(timestamp);
		groups[group].push(item);
	}
	
	// 按时间分组顺序返回非空分组
	const orderedGroups: TimeGroup[] = ['today', 'yesterday', 'week', 'month', 'older'];
	return orderedGroups
		.filter(group => groups[group].length > 0)
		.map(group => ({
			group,
			label: getGroupLabel(group),
			items: groups[group]
		}));
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

	// 按时间分组历史记录
	const groupedItems = useMemo(() => groupHistoryByTime(items), [items]);

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
					<div className="chat-history-groups">
						{groupedItems.map((group) => (
							<div key={group.group} className="chat-history-group">
								<div className="chat-history-group__label">{group.label}</div>
								<ul className="chat-history-list">
									{group.items.map((item) => (
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
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);

	// 使用 Portal 将历史面板渲染到 document.body，避免被父容器截断
	return createPortal(panelContent, document.body);
};

