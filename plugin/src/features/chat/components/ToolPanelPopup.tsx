import { X, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolDefinition } from '../types/tools';
import './ToolPanelPopup.css';

interface ToolPanelPopupProps {
	isOpen: boolean;
	onClose: () => void;
	anchorRef: RefObject<HTMLElement>;
	enabled: boolean;
	executionMode: 'manual' | 'auto';
	tools: ToolDefinition[];
	isBuiltin: (id: string) => boolean;
	onToggleEnabled: (enabled: boolean) => void;
	onChangeExecutionMode: (mode: 'manual' | 'auto') => void;
	onToggleToolEnabled: (id: string, enabled: boolean) => void;
	onDeleteTool: (id: string) => void;
	onCreateTool: () => void;
}

export const ToolPanelPopup = ({
	isOpen,
	onClose,
	anchorRef,
	enabled,
	executionMode,
	tools,
	isBuiltin,
	onToggleEnabled,
	onChangeExecutionMode,
	onToggleToolEnabled,
	onDeleteTool,
	onCreateTool
}: ToolPanelPopupProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

	const popupStyle = useMemo((): CSSProperties => {
		const anchor = anchorRef.current;
		if (!anchor) {
			return { left: 0, top: 0 };
		}
		const rect = anchor.getBoundingClientRect();
		const left = Math.min(rect.left, window.innerWidth - 460);
		const top = rect.bottom + 8;
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
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose, anchorRef]);

	useEffect(() => {
		if (!isOpen) {
			setPortalContainer(null);
			return;
		}

		const anchorEl = anchorRef.current;
		const modalContainer = anchorEl?.closest('.modal-container') as HTMLElement | null;
		const modalEl = anchorEl?.closest('.modal') as HTMLElement | null;
		setPortalContainer(modalContainer ?? modalEl ?? document.body);
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
				<div className="ff-tool-panel__row">
					<div className="ff-tool-panel__label">工具总开关</div>
					<button
						type="button"
						className="ff-tool-panel__btn ff-tool-panel__btn--primary"
						onClick={() => onToggleEnabled(!enabled)}
					>
						{enabled ? '已启用' : '已关闭'}
					</button>
				</div>
				<div className="ff-tool-panel__row">
					<div className="ff-tool-panel__label">执行模式</div>
					<select
						className="ff-tool-panel__select"
						value={executionMode}
						onChange={(e) => onChangeExecutionMode(e.target.value as 'manual' | 'auto')}
					>
						<option value="manual">手动审批</option>
						<option value="auto">自动执行</option>
					</select>
				</div>
				<div className="ff-tool-panel__row">
					<div className="ff-tool-panel__label">工具列表</div>
					<button type="button" className="ff-tool-panel__btn" onClick={onCreateTool}>
						<Plus className="tw-size-4" />
					</button>
				</div>

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
									<button
										type="button"
										className={`ff-tool-panel__btn ff-tool-panel__btn--danger ${builtin ? 'tw-opacity-40 tw-cursor-not-allowed' : ''}`}
										disabled={builtin}
										onClick={() => onDeleteTool(tool.id)}
										title={builtin ? '内置工具不可删除' : '删除工具'}
									>
										<Trash2 className="tw-size-4" />
									</button>
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
