/**
 * AI自动补全功能管理器
 * 负责功能的生命周期管理、事件注册和资源清理
 */

import { Plugin, Notice, App } from 'obsidian';
import type { AutoCompletionSettings } from './settings';
import type { TarsSettings } from 'src/features/tars';
import { DebugLogger } from 'src/utils/DebugLogger';
import { EditorEventHandler } from './services/EditorEventHandler';

/**
 * 自动补全状态枚举
 */
export type AutoCompletionStatus = 
	| 'idle'          // 空闲状态
	| 'extracting'    // 正在提取上下文
	| 'requesting'    // 正在向AI发送请求
	| 'streaming'     // 正在接收流式响应
	| 'previewing'    // 补全内容已渲染,等待用户决策
	| 'accepting'     // 正在接受补全内容
	| 'rejecting'     // 正在拒绝补全内容
	| 'error';        // 发生错误

/**
 * 自动补全状态数据
 */
export interface AutoCompletionState {
	/** 当前状态 */
	status: AutoCompletionStatus;
	/** 当前上下文 */
	context: string | null;
	/** 补全内容 */
	completionText: string | null;
	/** 预览装饰引用 */
	previewDecoration: any | null;
	/** 当前请求控制器 */
	currentRequest: AbortController | null;
	/** 错误信息 */
	errorMessage: string | null;
	/** 最后更新时间 */
	timestamp: number;
}

/**
 * AI自动补全功能管理器
 */
export class AutoCompletionFeatureManager {
	private plugin: Plugin;
	private settings: AutoCompletionSettings;
	private tarsSettings: TarsSettings;
	private state: AutoCompletionState;
	private commandId: string;
	private eventHandler: EditorEventHandler | null = null;

	constructor(plugin: Plugin, settings: AutoCompletionSettings, tarsSettings: TarsSettings) {
		this.plugin = plugin;
		this.settings = settings;
		this.tarsSettings = tarsSettings;
		this.commandId = 'trigger-auto-completion';
		
		// 初始化状态
		this.state = {
			status: 'idle',
			context: null,
			completionText: null,
			previewDecoration: null,
			currentRequest: null,
			errorMessage: null,
			timestamp: Date.now()
		};

		DebugLogger.debug('[AutoCompletion] 功能管理器已创建');
	}

	/**
	 * 初始化功能
	 */
	initialize(): void {
		if (!this.settings.enabled) {
			DebugLogger.info('[AutoCompletion] 功能未启用,跳过初始化');
			return;
		}

		DebugLogger.info('[AutoCompletion] 开始初始化自动补全功能');

		// 注册手动触发命令
		this.registerCommand();

		// 创建并注册编辑器事件处理器
		this.eventHandler = new EditorEventHandler(
			this.plugin.app,
			this.settings,
			this.tarsSettings,
			this.state
		);
		this.eventHandler.register();

		DebugLogger.info('[AutoCompletion] 功能初始化完成');
	}

	/**
	 * 注册手动触发命令
	 */
	private registerCommand(): void {
		this.plugin.addCommand({
			id: this.commandId,
			name: '触发AI自动补全',
			editorCallback: (editor, view) => {
				DebugLogger.debug('[AutoCompletion] 手动触发命令执行');
				
				// 检查配置
				if (!this.settings.defaultModel) {
					new Notice('请先在设置中配置默认补全模型');
					return;
				}

				// 检查是否有进行中的补全
				if (this.state.status !== 'idle' && this.state.status !== 'error') {
					DebugLogger.info('[AutoCompletion] 已有进行中的补全,先取消');
					this.cancelCompletion();
				}

				// 触发补全流程
				if (this.eventHandler) {
					this.eventHandler.triggerCompletion(editor);
				}
			}
		});

		DebugLogger.debug('[AutoCompletion] 手动触发命令已注册');
	}

	/**
	 * 取消当前补全
	 */
	private cancelCompletion(): void {
		if (this.state.currentRequest) {
			this.state.currentRequest.abort();
			this.state.currentRequest = null;
		}

		// 清除预览装饰
		if (this.state.previewDecoration) {
			// 后续实现清除逻辑
			this.state.previewDecoration = null;
		}

		this.updateState({
			status: 'idle',
			context: null,
			completionText: null,
			previewDecoration: null,
			currentRequest: null,
			errorMessage: null,
			timestamp: Date.now()
		});

		DebugLogger.debug('[AutoCompletion] 补全已取消');
	}

	/**
	 * 更新状态
	 */
	private updateState(newState: Partial<AutoCompletionState>): void {
		this.state = {
			...this.state,
			...newState,
			timestamp: Date.now()
		};

		DebugLogger.debug('[AutoCompletion] 状态已更新', this.state.status);
	}

	/**
	 * 获取当前状态
	 */
	getState(): Readonly<AutoCompletionState> {
		return this.state;
	}

	/**
	 * 更新设置
	 */
	updateSettings(settings: AutoCompletionSettings, tarsSettings: TarsSettings): void {
		const wasEnabled = this.settings.enabled;
		this.settings = settings;
		this.tarsSettings = tarsSettings;

		DebugLogger.debug('[AutoCompletion] 设置已更新', { enabled: settings.enabled });

		// 如果启用状态发生变化,重新初始化或清理
		if (wasEnabled !== settings.enabled) {
			if (settings.enabled) {
				this.initialize();
			} else {
				this.dispose();
			}
		} else if (settings.enabled && this.eventHandler) {
			// 如果功能已启用,更新事件处理器的设置
			this.eventHandler.updateSettings(settings, tarsSettings);
		}
	}

	/**
	 * 销毁功能
	 */
	dispose(): void {
		DebugLogger.info('[AutoCompletion] 开始销毁自动补全功能');

		// 取消进行中的补全
		this.cancelCompletion();

		// 注销事件处理器
		if (this.eventHandler) {
			this.eventHandler.dispose();
			this.eventHandler = null;
		}

		// 移除命令
		// Obsidian插件API会在plugin.unload时自动移除命令,无需手动移除

		DebugLogger.info('[AutoCompletion] 功能已销毁');
	}
}
