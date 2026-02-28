import { StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ObsidianAppContext } from 'src/context/obsidianAppContext';
import { DebugLogger } from 'src/utils/DebugLogger';
import { getServiceContainer } from 'src/service/ServiceContainer';
import type { ExpiredFileInfo as CheckExpiredFileInfo } from './ExpiryCheckService';
import type { ExpiredFileInfo as PopupExpiredFileInfo } from '../ui/ExpiryNoticePopup';
import { ExpiryNoticePopup } from '../ui/ExpiryNoticePopup';
import { MiniFloatingIcon } from '../ui/MiniFloatingIcon';
import type { App } from 'obsidian';

/** 弹窗显示状态 */
type PopupState = 'hidden' | 'expanded' | 'minimized';

/**
 * 过期通知管理器
 * 管理浮动弹窗和迷你图标的生命周期
 */
export class ExpiryNoticeManager {
	private app: App;
	private state: PopupState = 'hidden';
	private expiredFiles: PopupExpiredFileInfo[] = [];

	/** 主弹窗容器 */
	private popupContainer: HTMLElement | null = null;
	private popupRoot: Root | null = null;

	/** 迷你图标容器 */
	private miniContainer: HTMLElement | null = null;
	private miniRoot: Root | null = null;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 显示过期文件通知
	 * 如果已有弹窗则更新列表，否则创建新弹窗
	 */
	show(files: CheckExpiredFileInfo[]): void {
		this.expiredFiles = files.map(f => ({
			path: f.filePath,
			daysExpired: f.daysSinceAccess,
		}));

		if (this.expiredFiles.length === 0) {
			this.hide();
			return;
		}

		this.state = 'expanded';
		this.renderPopup();
		this.destroyMiniIcon();
	}

	/**
	 * 手动刷新列表（操作完成后重新检查）
	 */
	updateFiles(files: PopupExpiredFileInfo[]): void {
		this.expiredFiles = files;
		if (this.state === 'expanded') {
			this.renderPopup();
		} else if (this.state === 'minimized') {
			this.renderMiniIcon();
		}
	}

	/**
	 * 隐藏所有弹窗
	 */
	hide(): void {
		this.state = 'hidden';
		this.destroyPopup();
		this.destroyMiniIcon();
	}

	/**
	 * 清理所有 DOM 资源
	 */
	cleanup(): void {
		this.hide();
	}

	// ============================
	// 内部渲染方法
	// ============================

	private renderPopup(): void {
		if (!this.popupContainer) {
			this.popupContainer = document.createElement('div');
			this.popupContainer.className = 'fem-notice-popup-wrapper';
			this.popupContainer.style.cssText =
				'position:fixed;bottom:20px;right:20px;z-index:1000;';
			document.body.appendChild(this.popupContainer);
		}

		if (!this.popupRoot) {
			this.popupRoot = createRoot(this.popupContainer);
		}

		this.popupRoot.render(
			<StrictMode>
				<ObsidianAppContext.Provider value={this.app}>
					<ExpiryNoticePopup
						files={this.expiredFiles}
						onClose={() => this.hide()}
						onMinimize={() => this.minimize()}
						onRefresh={() => this.handleRefresh()}
					/>
				</ObsidianAppContext.Provider>
			</StrictMode>
		);
	}

	private destroyPopup(): void {
		if (this.popupRoot) {
			this.popupRoot.unmount();
			this.popupRoot = null;
		}
		if (this.popupContainer) {
			this.popupContainer.remove();
			this.popupContainer = null;
		}
	}

	private renderMiniIcon(): void {
		if (!this.miniContainer) {
			this.miniContainer = document.createElement('div');
			this.miniContainer.className = 'fem-mini-icon-wrapper';
			document.body.appendChild(this.miniContainer);
		}

		if (!this.miniRoot) {
			this.miniRoot = createRoot(this.miniContainer);
		}

		this.miniRoot.render(
			<StrictMode>
				<MiniFloatingIcon
					count={this.expiredFiles.length}
					onClick={() => this.expand()}
				/>
			</StrictMode>
		);
	}

	private destroyMiniIcon(): void {
		if (this.miniRoot) {
			this.miniRoot.unmount();
			this.miniRoot = null;
		}
		if (this.miniContainer) {
			this.miniContainer.remove();
			this.miniContainer = null;
		}
	}

	/**
	 * 最小化弹窗，显示迷你图标
	 */
	private minimize(): void {
		this.state = 'minimized';
		this.destroyPopup();
		this.renderMiniIcon();
	}

	/**
	 * 从迷你图标恢复弹窗
	 */
	private expand(): void {
		this.state = 'expanded';
		this.destroyMiniIcon();
		this.renderPopup();
	}

	/**
	 * 刷新回调：重新检查过期文件并更新列表
	 */
	private handleRefresh(): void {
		try {
			const container = getServiceContainer();
			const expiredFiles = container.expiryCheckService.checkExpiredFiles();
			this.expiredFiles = expiredFiles.map((f: CheckExpiredFileInfo) => ({
				path: f.filePath,
				daysExpired: f.daysSinceAccess,
			}));

			if (this.expiredFiles.length === 0) {
				this.hide();
			} else if (this.state === 'expanded') {
				this.renderPopup();
			}
		} catch (error) {
			DebugLogger.error('[ExpiryNoticeManager] 刷新过期文件列表失败', error);
		}
	}
}
