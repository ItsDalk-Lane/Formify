import { X } from 'lucide-react';
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolDefinition } from '../types/tools';
import './ToolPanelPopup.css';

interface ToolPanelPopupProps {
	isOpen: boolean;
	onClose: () => void;
	anchorRef: RefObject<HTMLElement>;
	tools: ToolDefinition[];
	isBuiltin: (id: string) => boolean;
	onToggleToolEnabled: (id: string, enabled: boolean) => void;
	onChangeToolExecutionMode: (id: string, mode: 'manual' | 'auto') => void;
}

export const ToolPanelPopup = ({
	isOpen,
	onClose,
	anchorRef,
	tools,
	isBuiltin,
	onToggleToolEnabled,
	onChangeToolExecutionMode
}: ToolPanelPopupProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

	const popupStyle = useMemo((): CSSProperties => {
		const anchor = anchorRef.current;
		if (!anchor) {
			return { left: 0, top: 0 };
		}
		const rect = anchor.getBoundingClientRect();
		const estimatedWidth = 420;
		const estimatedHeight = 400;
		const gap = 8;
		const padding = 12;

		// 计算水平位置
		const left = Math.max(
			padding,
			Math.min(rect.left, window.innerWidth - estimatedWidth - padding)
		);

		// 计算垂直方向可用空间
		const spaceAbove = rect.top;
		const spaceBelow = window.innerHeight - rect.bottom;
		const canPlaceBelow = spaceBelow >= estimatedHeight + gap;

		// 根据可用空间决定弹出方向
		let top: number;
		if (canPlaceBelow) {
			// 向下弹出
			top = rect.bottom + gap;
		} else {
			// 向上弹出
			top = Math.max(padding, rect.top - estimatedHeight - gap);
		}

		return { left, top };
	}, [anchorRef, isOpen]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				popupRef.current &&
				!popupRef.current.contains(event.target as Node) &&
				anchorRef.current &&
				!anchorRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
		}

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	}, [isOpen, onClose, anchorRef]);

	useEffect(() => {
		if (!isOpen) {
			setPortalContainer(null);
			return;
		}
		setPortalContainer(document.body);
	}, [isOpen, anchorRef]);

	if (!isOpen || !portalContainer) return null;

	return createPortal(
		<div ref={popupRef} className="ff-tool-panel" style={popupStyle}>
			<div className="ff-tool-panel__header">
				<div className="ff-tool-panel__title">工具管理</div>
				<button type="button" className="ff-tool-panel__btn" onClick={onClose} aria-label="关闭">
					<X className="tw-size-4" />
				</button>
			</div>
			<div className="ff-tool-panel__body">
				<div className="ff-tool-panel__list">
					{tools.map((tool) => {
						const builtin = isBuiltin(tool.id);
						return (
							<div key={tool.id} className="ff-tool-panel__item">
								<div className="ff-tool-panel__item-main">
									<p className="ff-tool-panel__item-name">
										{tool.name}{builtin ? '（内置）' : ''}
									</p>
									<p className="ff-tool-panel__item-desc">{tool.description}</p>
								</div>
								<div className="ff-tool-panel__actions">
									<button
										type="button"
										className="ff-tool-panel__btn"
										onClick={() => onToggleToolEnabled(tool.id, !tool.enabled)}
										title={tool.enabled ? '点击禁用' : '点击启用'}
									>
										{tool.enabled ? '开' : '关'}
									</button>
									<select
										className="ff-tool-panel__select"
										value={tool.executionMode}
										onChange={(e) => onChangeToolExecutionMode(tool.id, e.target.value as 'manual' | 'auto')}
									>
										<option value="manual">手动审批</option>
										<option value="auto">自动执行</option>
									</select>
								</div>
							</div>
						);
					})}
					{tools.length === 0 && <div className="tw-text-xs tw-text-muted">暂无工具</div>}
				</div>
			</div>
		</div>,
		portalContainer
	);
};
