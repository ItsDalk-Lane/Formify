import { App, setIcon } from "obsidian";
import { localInstance } from "src/i18n/locals";
import { ToastManager } from "src/component/toast/ToastManager";

/**
 * 全局表单执行管理器
 * 负责管理表单执行状态、超时监控和停止按钮显示
 */
export class FormExecutionManager {
    private static instance: FormExecutionManager | null = null;
    
    private app: App;
    private executionStartTime: number | null = null;
    private abortController: AbortController | null = null;
    private timeoutTimer: NodeJS.Timeout | null = null;
    private monitorTimer: NodeJS.Timeout | null = null;
    private stopButtonEl: HTMLElement | null = null;
    private isExecuting = false;
    private timeoutThreshold = 30; // 默认30秒
    
    private constructor(app: App) {
        this.app = app;
    }
    
    static getInstance(app: App): FormExecutionManager {
        if (!FormExecutionManager.instance) {
            FormExecutionManager.instance = new FormExecutionManager(app);
        }
        return FormExecutionManager.instance;
    }
    
    /**
     * 开始执行并启动超时监控
     */
    startExecution(enableTimeout: boolean, thresholdSeconds: number = 30): AbortController {
        // 清理之前的执行
        this.stopExecution(false);
        
        // 创建新的 AbortController
        this.abortController = new AbortController();
        this.isExecuting = true;
        this.executionStartTime = Date.now();
        this.timeoutThreshold = thresholdSeconds;
        
        if (enableTimeout) {
            this.startTimeoutMonitor();
        }
        
        return this.abortController;
    }
    
    /**
     * 启动超时监控
     */
    private startTimeoutMonitor() {
        if (!this.executionStartTime) return;
        
        const startTime = this.executionStartTime;
        const threshold = this.timeoutThreshold * 1000;
        
        // 延迟启动，确保状态稳定
        this.timeoutTimer = setTimeout(() => {
            this.monitorTimer = setInterval(() => {
                if (!this.isExecuting) {
                    this.clearTimers();
                    return;
                }
                
                const elapsed = Date.now() - startTime;
                
                if (elapsed >= threshold) {
                    this.showStopButton();
                    this.clearTimers();
                }
            }, 100);
        }, 50);
    }
    
    /**
     * 清理定时器
     */
    private clearTimers() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }
    }
    
    /**
     * 在编辑器左上角显示停止按钮
     */
    private showStopButton() {
        if (this.stopButtonEl) return; // 已经显示
        
        // 查找编辑器视图容器
        const workspace = this.app.workspace;
        const activeLeaf = workspace.getActiveViewOfType(require('obsidian').MarkdownView);
        
        if (!activeLeaf) {
            console.warn('[ExecutionManager] 未找到活动编辑器视图');
            return;
        }
        
        // 创建停止按钮
        const buttonEl = document.createElement('button');
        buttonEl.className = 'clickable-icon form--ExecutionStopButton';
        buttonEl.setAttribute('aria-label', localInstance.stop_execution);
        buttonEl.style.cssText = `
            position: absolute;
            left: 8px;
            top: 8px;
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border: none;
            border-radius: var(--radius-s);
            cursor: pointer;
            font-size: var(--font-ui-small);
            box-shadow: var(--shadow-s);
        `;
        
        // 添加图标
        const iconEl = document.createElement('span');
        iconEl.style.cssText = 'display: flex; align-items: center;';
        setIcon(iconEl, 'stop-circle');
        buttonEl.appendChild(iconEl);
        
        // 添加文本
        const textEl = document.createElement('span');
        textEl.textContent = localInstance.stop_execution;
        buttonEl.appendChild(textEl);
        
        // 点击事件
        buttonEl.addEventListener('click', () => {
            this.stopExecution(true);
        });
        
        // 添加到视图容器
        const viewContent = activeLeaf.containerEl.querySelector('.view-content');
        if (viewContent) {
            viewContent.appendChild(buttonEl);
            this.stopButtonEl = buttonEl;
        }
    }
    
    /**
     * 隐藏停止按钮
     */
    private hideStopButton() {
        if (this.stopButtonEl) {
            this.stopButtonEl.remove();
            this.stopButtonEl = null;
        }
    }
    
    /**
     * 停止执行
     */
    stopExecution(showNotification: boolean = false) {
        if (this.abortController && this.isExecuting) {
            this.abortController.abort();
            if (showNotification) {
                ToastManager.info(localInstance.execution_stopped);
            }
        }
        
        this.clearTimers();
        this.hideStopButton();
        this.isExecuting = false;
        this.executionStartTime = null;
        this.abortController = null;
    }
    
    /**
     * 完成执行（成功或失败）
     */
    finishExecution() {
        this.stopExecution(false);
    }
    
    /**
     * 获取当前的 AbortSignal
     */
    getAbortSignal(): AbortSignal | undefined {
        return this.abortController?.signal;
    }
    
    /**
     * 检查是否正在执行
     */
    isRunning(): boolean {
        return this.isExecuting;
    }
    
    /**
     * 清理资源
     */
    dispose() {
        this.stopExecution(false);
        FormExecutionManager.instance = null;
    }
}
