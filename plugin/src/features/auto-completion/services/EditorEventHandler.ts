/**
 * 编辑器事件处理器
 * 负责监听编辑器事件并协调整个补全流程
 */

import { App, Editor, MarkdownView, Notice } from 'obsidian';
import type { AutoCompletionSettings } from '../settings';
import type { TarsSettings } from 'src/features/tars';
import { ContextAnalyzer } from './ContextAnalyzer';
import { CompletionRequestManager } from './CompletionRequestManager';
import { PreviewRenderer } from './PreviewRenderer';
import { UserDecisionHandler } from './UserDecisionHandler';
import type { AutoCompletionState } from '../AutoCompletionFeatureManager';
import { DebugLogger } from 'src/utils/DebugLogger';

/**
 * 编辑器事件处理器类
 */
export class EditorEventHandler {
	private app: App;
	private settings: AutoCompletionSettings;
	private tarsSettings: TarsSettings;
	private state: AutoCompletionState;
	
	private contextAnalyzer: ContextAnalyzer;
	private requestManager: CompletionRequestManager;
	private previewRenderer: PreviewRenderer;
	private decisionHandler: UserDecisionHandler;
	
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private spaceCount: number = 0;
	private lastSpaceTime: number = 0;
	private debounceTimer: NodeJS.Timeout | null = null;

	constructor(
		app: App,
		settings: AutoCompletionSettings,
		tarsSettings: TarsSettings,
		state: AutoCompletionState
	) {
		this.app = app;
		this.settings = settings;
		this.tarsSettings = tarsSettings;
		this.state = state;
		
		// 初始化各个服务
		this.contextAnalyzer = new ContextAnalyzer(settings);
		this.requestManager = new CompletionRequestManager(settings, tarsSettings);
		this.previewRenderer = new PreviewRenderer(settings);
		this.decisionHandler = new UserDecisionHandler(this.previewRenderer);
	}

	/**
	 * 注册编辑器事件
	 */
	register(): void {
		// 创建键盘事件处理器
		this.keydownHandler = (event: KeyboardEvent) => {
			// 只在编辑模式下处理
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || view.getMode() !== 'source') {
				return;
			}

			// 检查是否按下空格
			if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
				this.handleSpaceKey(view.editor);
			} else {
				// 重置空格计数
				this.spaceCount = 0;
			}
		};

		// 注册到文档
		document.addEventListener('keydown', this.keydownHandler, true);
		DebugLogger.debug('[EditorEventHandler] 已注册编辑器事件监听');
	}

	/**
	 * 注销编辑器事件
	 */
	unregister(): void {
		if (this.keydownHandler) {
			document.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}

		// 清除防抖定时器
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		DebugLogger.debug('[EditorEventHandler] 已注销编辑器事件监听');
	}

	/**
	 * 处理空格键
	 */
	private handleSpaceKey(editor: Editor): void {
		const now = Date.now();
		
		// 检查两次空格的时间间隔(500ms内)
		if (now - this.lastSpaceTime < 500) {
			this.spaceCount++;
		} else {
			this.spaceCount = 1;
		}
		
		this.lastSpaceTime = now;

		// 连续两次空格触发补全
		if (this.spaceCount >= 2) {
			this.spaceCount = 0;
			this.triggerCompletionWithDebounce(editor);
		}
	}

	/**
	 * 带防抖的触发补全
	 */
	private triggerCompletionWithDebounce(editor: Editor): void {
		// 清除之前的定时器
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// 设置新的定时器
		this.debounceTimer = setTimeout(() => {
			this.triggerCompletion(editor);
		}, this.settings.debounceDelay);
	}

	/**
	 * 触发补全(手动或自动)
	 */
	async triggerCompletion(editor: Editor): Promise<void> {
		// 检查是否已经有进行中的补全
		if (this.state.status !== 'idle' && this.state.status !== 'error') {
			DebugLogger.debug('[EditorEventHandler] 已有进行中的补全');
			return;
		}

		// 检查是否配置了模型
		if (!this.settings.defaultModel) {
			new Notice('请先在设置中配置默认补全模型');
			return;
		}

		try {
			// 更新状态为提取中
			this.updateState({ status: 'extracting' });

			// 提取上下文
			const file = this.app.workspace.getActiveFile();
			const contextResult = this.contextAnalyzer.extract(editor, file);
			
			if (!contextResult) {
				DebugLogger.debug('[EditorEventHandler] 上下文提取失败或被排除');
				this.updateState({ status: 'idle' });
				return;
			}

			this.updateState({ 
				status: 'requesting',
				context: contextResult.text
			});

			DebugLogger.info('[EditorEventHandler] 开始请求AI补全');

			// 发送请求
			const result = await this.requestManager.request(contextResult.text);

			if (!result.success) {
				DebugLogger.error('[EditorEventHandler] 请求失败', result.error);
				new Notice(`补全失败: ${result.error || '未知错误'}`);
				this.updateState({ 
					status: 'error',
					errorMessage: result.error || '未知错误'
				});
				return;
			}

			if (!result.text || result.text.trim().length === 0) {
				DebugLogger.warn('[EditorEventHandler] 返回的补全内容为空');
				new Notice('未能生成补全内容');
				this.updateState({ status: 'idle' });
				return;
			}

			this.updateState({ 
				status: 'previewing',
				completionText: result.text
			});

			// 渲染预览
			const decoration = this.previewRenderer.render(
				editor, 
				result.text, 
				contextResult.cursorPosition
			);

			this.updateState({ previewDecoration: decoration });

			// 检查是否自动接受短补全
			if (this.settings.autoAcceptShort && result.text.length < 5) {
				DebugLogger.info('[EditorEventHandler] 自动接受短补全');
				this.previewRenderer.accept(editor);
				this.updateState({ status: 'idle' });
				return;
			}

			// 激活决策处理
			this.decisionHandler.activate(editor, (decision) => {
				DebugLogger.info('[EditorEventHandler] 用户决策', decision.type);
				
				if (decision.inserted) {
					DebugLogger.info('[EditorEventHandler] 补全已插入');
				}

				this.updateState({ 
					status: 'idle',
					context: null,
					completionText: null,
					previewDecoration: null
				});
			});

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			DebugLogger.error('[EditorEventHandler] 补全流程异常', errorMessage);
			new Notice(`补全失败: ${errorMessage}`);
			
			this.updateState({ 
				status: 'error',
				errorMessage,
				context: null,
				completionText: null
			});
		}
	}

	/**
	 * 更新状态
	 */
	private updateState(newState: Partial<AutoCompletionState>): void {
		Object.assign(this.state, newState, { timestamp: Date.now() });
	}

	/**
	 * 更新设置
	 */
	updateSettings(settings: AutoCompletionSettings, tarsSettings: TarsSettings): void {
		this.settings = settings;
		this.tarsSettings = tarsSettings;
		
		this.contextAnalyzer.updateSettings(settings);
		this.requestManager.updateSettings(settings, tarsSettings);
		this.previewRenderer.updateSettings(settings);
		
		DebugLogger.debug('[EditorEventHandler] 设置已更新');
	}

	/**
	 * 销毁
	 */
	dispose(): void {
		this.unregister();
		this.requestManager.dispose();
		this.decisionHandler.dispose();
		
		DebugLogger.debug('[EditorEventHandler] 已销毁');
	}
}
