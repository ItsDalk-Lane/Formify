import { useState, useCallback, useEffect, useMemo } from 'react';
import { localInstance } from 'src/i18n/locals';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import { FileOperationService } from 'src/service/FileOperationService';
import { DebugLogger } from 'src/utils/DebugLogger';
import { FolderPickerModal } from 'src/features/file-expiry-monitor/ui/FolderPickerModal';
import { recordFormifyTestEvent } from 'src/testing/FormifyTestHooks';
import './ExpiryNoticePopup.css';

/**
 * 单个过期文件信息
 */
export interface ExpiredFileInfo {
	/** 文件路径 */
	path: string;
	/** 过期天数（距最后访问） */
	daysExpired: number;
}

interface ExpiryNoticePopupProps {
	/** 过期文件列表 */
	files: ExpiredFileInfo[];
	/** 关闭弹窗 */
	onClose: () => void;
	/** 最小化弹窗 */
	onMinimize: () => void;
	/** 操作完成后刷新列表回调 */
	onRefresh?: () => void;
}

/**
 * 过期文件通知弹窗
 * 展示过期文件列表，支持全选、批量删除、批量移动
 */
export function ExpiryNoticePopup(props: ExpiryNoticePopupProps) {
	const { files, onClose, onMinimize, onRefresh } = props;
	const app = useObsidianApp();

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [processing, setProcessing] = useState(false);

	const allSelected = useMemo(
		() => files.length > 0 && selectedPaths.size === files.length,
		[files.length, selectedPaths.size]
	);

	useEffect(() => {
		recordFormifyTestEvent('expiry-popup-opened', {
			fileCount: files.length,
		});
		return () => {
			recordFormifyTestEvent('expiry-popup-closed');
		};
	}, [files.length]);

	// 全选/取消全选
	const handleToggleAll = useCallback(() => {
		recordFormifyTestEvent('expiry-popup-toggle-all', {
			allSelected,
			fileCount: files.length,
		});
		if (allSelected) {
			setSelectedPaths(new Set());
		} else {
			setSelectedPaths(new Set(files.map(f => f.path)));
		}
	}, [allSelected, files]);

	// 切换单个文件选中
	const handleToggleFile = useCallback((path: string) => {
		recordFormifyTestEvent('expiry-popup-toggle-file', { path });
		setSelectedPaths(prev => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	// 批量删除
	const handleDeleteSelected = useCallback(async () => {
		if (selectedPaths.size === 0 || !app) return;
		recordFormifyTestEvent('expiry-popup-delete-requested', {
			paths: Array.from(selectedPaths),
		});

		setProcessing(true);
		try {
			const service = new FileOperationService(app);
			const result = await service.deleteFile({
				paths: Array.from(selectedPaths),
				silent: true,
			});
			if (result.success) {
				// 移除已删除的文件
				setSelectedPaths(new Set());
				onRefresh?.();
			}
			DebugLogger.info(
				`[ExpiryNoticePopup] 删除完成: ${result.deletedFiles.length} 成功, ${result.errors.length} 失败`
			);
		} catch (error) {
			DebugLogger.error('[ExpiryNoticePopup] 批量删除失败', error);
		} finally {
			setProcessing(false);
		}
	}, [selectedPaths, app, onRefresh]);

	// 批量移动（打开文件夹选择后执行）
	const handleMoveSelected = useCallback(async () => {
		if (selectedPaths.size === 0 || !app) return;
		recordFormifyTestEvent('expiry-popup-move-requested', {
			paths: Array.from(selectedPaths),
		});

		// 使用 Obsidian 的 FolderSuggest 模态框选择目标文件夹
		const modal = new FolderPickerModal(app, async (targetFolder: string) => {
			setProcessing(true);
			try {
				const service = new FileOperationService(app);
				const result = await service.moveFile({
					paths: Array.from(selectedPaths),
					targetFolder,
					silent: true,
				});
				if (result.success) {
					setSelectedPaths(new Set());
					onRefresh?.();
				}
				DebugLogger.info(
					`[ExpiryNoticePopup] 移动完成: ${result.moved.length} 成功, ${result.errors.length} 失败`
				);
			} catch (error) {
				DebugLogger.error('[ExpiryNoticePopup] 批量移动失败', error);
			} finally {
				setProcessing(false);
			}
		});
		modal.open();
	}, [selectedPaths, app, onRefresh]);

	// 打开文件
	const handleOpenFile = useCallback((path: string) => {
		if (!app) return;
		recordFormifyTestEvent('expiry-popup-open-file-requested', { path });
		const file = app.vault.getAbstractFileByPath(path);
		if (file) {
			void app.workspace.openLinkText(path, '', false);
		}
	}, [app]);

	if (files.length === 0) {
		return (
			<div className="fem-popup" data-testid="formify-expiry-popup">
				<div className="fem-popup__header">
					<span className="fem-popup__title">{localInstance.expired_files_title}</span>
					<div className="fem-popup__header-actions">
						<button className="fem-popup__header-btn" data-testid="formify-expiry-close" onClick={onClose}>✕</button>
					</div>
				</div>
				<div className="fem-popup__empty">{localInstance.no_expired_files}</div>
			</div>
		);
	}

	return (
		<div className="fem-popup" data-testid="formify-expiry-popup">
			{/* 标题栏 */}
			<div className="fem-popup__header">
				<span className="fem-popup__title">
					{localInstance.expired_files_title} ({files.length})
				</span>
				<div className="fem-popup__header-actions">
					<button className="fem-popup__header-btn" data-testid="formify-expiry-minimize" onClick={onMinimize} title="Minimize">
						—
					</button>
					<button className="fem-popup__header-btn" data-testid="formify-expiry-close" onClick={onClose}>✕</button>
				</div>
			</div>

			{/* 工具栏 */}
			<div className="fem-popup__toolbar">
				<button className="fem-popup__toolbar-btn" data-testid="formify-expiry-toggle-all" onClick={handleToggleAll}>
					{allSelected ? localInstance.deselect_all : localInstance.select_all}
				</button>
				<div className="fem-popup__toolbar-spacer" />
				<button
					className="fem-popup__toolbar-btn fem-popup__toolbar-btn--danger"
					data-testid="formify-expiry-delete-selected"
					onClick={handleDeleteSelected}
					disabled={selectedPaths.size === 0 || processing}
				>
					{localInstance.delete_selected} ({selectedPaths.size})
				</button>
				<button
					className="fem-popup__toolbar-btn"
					data-testid="formify-expiry-move-selected"
					onClick={handleMoveSelected}
					disabled={selectedPaths.size === 0 || processing}
				>
					{localInstance.move_selected}
				</button>
			</div>

			{/* 文件列表 */}
			<div className="fem-popup__list">
				{files.map(file => (
					<div
						key={file.path}
						className={`fem-popup__list-item ${
							selectedPaths.has(file.path) ? 'fem-popup__list-item--selected' : ''
						}`}
					>
						<input
							type="checkbox"
							checked={selectedPaths.has(file.path)}
							data-testid={`formify-expiry-checkbox-${file.path}`}
							onChange={() => handleToggleFile(file.path)}
							className="fem-popup__list-checkbox"
						/>
						<button
							className="fem-popup__list-path"
							data-testid={`formify-expiry-open-${file.path}`}
							onClick={() => handleOpenFile(file.path)}
							title={file.path}
						>
							{file.path}
						</button>
						<span className="fem-popup__list-days">
							{(localInstance.expired_days_ago ?? '{0} days ago').replace('{0}', String(file.daysExpired))}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
