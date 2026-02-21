import { Hammer, Check, ChevronLeft } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { McpToolMode } from '../types/chat';
import type { ChatService } from '../services/ChatService';

interface McpModeSelectorProps {
	mode: McpToolMode;
	selectedServerIds: string[];
	service: ChatService;
}

const MODE_LABELS: Record<McpToolMode, string> = {
	disabled: '禁用',
	auto: '自动',
	manual: '手动',
};

export const McpModeSelector = ({ mode, selectedServerIds, service }: McpModeSelectorProps) => {
	const VIEWPORT_PADDING = 8;
	const MENU_WIDTH = 160;
	const MENU_ITEM_HEIGHT = 36;

	const [isOpen, setIsOpen] = useState(false);
	/** 当前展示的面板：'modes' 为三选项，'servers' 为服务器多选 */
	const [panel, setPanel] = useState<'modes' | 'servers'>('modes');
	const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
	const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('up');

	const buttonRef = useRef<HTMLSpanElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	/** 点击菜单外部时关闭 */
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as Node;
			if (buttonRef.current?.contains(target)) return;
			if (menuRef.current?.contains(target)) return;
			setIsOpen(false);
			setPanel('modes');
		};

		setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside);
		}, 50);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	/** 打开时重新加载服务器列表，并计算展开方向 */
	const handleToggle = useCallback(() => {
		if (isOpen) {
			setIsOpen(false);
			setPanel('modes');
			return;
		}

		// 加载已启用的 MCP 服务器
		setServers(service.getEnabledMcpServers());

		// 计算向上或向下展开
		if (buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			const menuEstimatedHeight = 3 * MENU_ITEM_HEIGHT + 16;
			const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
			const spaceAbove = rect.top - VIEWPORT_PADDING;
			setMenuDirection(spaceBelow >= menuEstimatedHeight || spaceBelow >= spaceAbove ? 'down' : 'up');
		}

		setPanel('modes');
		setIsOpen(true);
	}, [isOpen, service]);

	/** 计算菜单的 fixed 定位坐标 */
	const getMenuStyle = useCallback((): React.CSSProperties => {
		if (!buttonRef.current) return { position: 'fixed', top: 0, left: 0 };
		const rect = buttonRef.current.getBoundingClientRect();
		const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING);

		if (menuDirection === 'down') {
			return {
				position: 'fixed',
				top: rect.bottom + 4,
				left,
				width: MENU_WIDTH,
				zIndex: 1310,
				background: 'var(--background-primary)',
			};
		}
		// 向上展开：先估算高度
		const estimatedHeight = (panel === 'modes' ? 3 : Math.max(1, servers.length)) * MENU_ITEM_HEIGHT + 16;
		return {
			position: 'fixed',
			top: rect.top - estimatedHeight - 4,
			left,
			width: MENU_WIDTH,
			zIndex: 1310,
			background: 'var(--background-primary)',
		};
	}, [menuDirection, panel, servers.length]);

	/** 选择模式 */
	const handleSelectMode = useCallback((newMode: McpToolMode) => {
		if (newMode === 'manual') {
			setPanel('servers');
			return;
		}
		service.setMcpToolMode(newMode);
		setIsOpen(false);
		setPanel('modes');
	}, [service]);

	/** 切换服务器选中状态 */
	const handleToggleServer = useCallback((serverId: string) => {
		const next = selectedServerIds.includes(serverId)
			? selectedServerIds.filter((id) => id !== serverId)
			: [...selectedServerIds, serverId];
		service.setMcpSelectedServerIds(next);
		// 进入手动模式（如果还不是）
		if (mode !== 'manual') {
			service.setMcpToolMode('manual');
		}
	}, [selectedServerIds, service, mode]);

	/** 返回三选项视图 */
	const handleBack = useCallback(() => {
		setPanel('modes');
	}, []);

	// ── 按钮视觉状态 ──────────────────────────────────────────
	const isActive = mode !== 'disabled';
	const isManualWithSelection = mode === 'manual' && selectedServerIds.length > 0;

	let iconClass = 'tw-size-4';
	let spanClass = 'tw-cursor-pointer';

	if (!isActive) {
		// 禁用：降低透明度
		spanClass += ' tw-opacity-40 tw-text-muted';
	} else if (isManualWithSelection) {
		// 手动且有选中：强调色（橙色调区分于 auto）
		spanClass += ' tw-text-orange-500';
	} else if (mode === 'auto') {
		// 自动：主题强调色
		spanClass += ' tw-text-accent';
	} else {
		// 手动但无选中项
		spanClass += ' tw-text-muted';
	}

	const menuBaseClass = [
		'tw-rounded-md tw-shadow-lg tw-py-1',
		'tw-border tw-border-solid tw-border-[color:var(--background-modifier-border)]',
		'tw-overflow-hidden',
	].join(' ');

	return (
		<>
			<span
				ref={buttonRef}
				onClick={handleToggle}
				className={spanClass}
				aria-label={`MCP 工具 (${MODE_LABELS[mode]})`}
				title={`MCP 工具 (${MODE_LABELS[mode]})`}
			>
				<Hammer className={iconClass} />
			</span>

			{isOpen && createPortal(
				<div
					ref={menuRef}
					style={getMenuStyle()}
					className={menuBaseClass}
				>
					{panel === 'modes' ? (
						/* ── 三选项面板 ── */
						['disabled', 'auto', 'manual'].map((m) => {
							const modeKey = m as McpToolMode;
							const isSelected = mode === modeKey;
							return (
								<div
									key={m}
									className={[
										'tw-flex tw-items-center tw-justify-between tw-gap-2',
										'tw-px-3 tw-cursor-pointer tw-select-none',
										'tw-text-sm tw-text-[color:var(--text-normal)]',
										'hover:tw-bg-[color:var(--background-modifier-hover)]',
									].join(' ')}
									style={{ height: MENU_ITEM_HEIGHT }}
									onClick={() => handleSelectMode(modeKey)}
								>
									<span>{MODE_LABELS[modeKey]}</span>
									{isSelected && <Check className="tw-size-3.5 tw-text-accent tw-flex-shrink-0" />}
								</div>
							);
						})
					) : (
						/* ── 服务器多选面板 ── */
						<>
							{/* 返回按钮 */}
							<div
								className={[
									'tw-flex tw-items-center tw-gap-1 tw-px-3 tw-cursor-pointer tw-select-none',
									'tw-text-xs tw-text-[color:var(--text-muted)] tw-border-b tw-border-solid',
									'tw-border-[color:var(--background-modifier-border)]',
									'hover:tw-bg-[color:var(--background-modifier-hover)]',
								].join(' ')}
								style={{ height: MENU_ITEM_HEIGHT - 4 }}
								onClick={handleBack}
							>
								<ChevronLeft className="tw-size-3" />
								<span>手动选择服务器</span>
							</div>

							{/* 服务器列表 */}
							{servers.length === 0 ? (
								<div
									className="tw-px-3 tw-text-sm tw-text-[color:var(--text-muted)] tw-italic"
									style={{ height: MENU_ITEM_HEIGHT, display: 'flex', alignItems: 'center' }}
								>
									暂无已启用的 MCP 服务器
								</div>
							) : (
								servers.map((server) => {
									const isChecked = selectedServerIds.includes(server.id);
									return (
										<div
											key={server.id}
											className={[
												'tw-flex tw-items-center tw-gap-2 tw-px-3 tw-cursor-pointer tw-select-none',
												'tw-text-sm tw-text-[color:var(--text-normal)]',
												'hover:tw-bg-[color:var(--background-modifier-hover)]',
											].join(' ')}
											style={{ height: MENU_ITEM_HEIGHT }}
											onClick={() => handleToggleServer(server.id)}
										>
											{/* 复选框 */}
											<span
												className={[
													'tw-w-3.5 tw-h-3.5 tw-rounded tw-border tw-border-solid tw-flex-shrink-0',
													'tw-flex tw-items-center tw-justify-center',
													isChecked
														? 'tw-bg-accent tw-border-accent'
														: 'tw-border-[color:var(--background-modifier-border)] tw-bg-transparent',
												].join(' ')}
											>
												{isChecked && <Check className="tw-size-2.5 tw-text-white" />}
											</span>
											<span className="tw-truncate">{server.name}</span>
										</div>
									);
								})
							)}
						</>
					)}
				</div>,
				document.body
			)}
		</>
	);
};
