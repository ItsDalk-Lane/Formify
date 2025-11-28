import { App, Modal } from "obsidian";
import { localInstance } from "src/i18n/locals";

/**
 * AI流式输出模态框配置选项
 */
export interface AIStreamingModalOptions {
    modelInfo: string;              // 模型型号信息
    promptDisplayText: string;      // 提示词显示文本
    fullPromptContent: string;      // 完整提示词内容(用于悬浮提示)
    onConfirm: (editedContent: string) => void; // 确认回调
    onCancel: () => void;          // 取消回调
    onRefresh: () => void;         // 刷新回调
}

/**
 * 模态框内部状态
 */
interface ModalState {
    phase: 'generating' | 'completed' | 'error'; // 当前阶段
    content: string;              // 累积内容
    characterCount: number;       // 字符计数
    errorMessage?: string;        // 错误信息
}

/**
 * AI流式输出模态框
 * 用于实时显示AI生成内容,支持编辑和确认操作
 */
export class AIStreamingModal extends Modal {
    private options: AIStreamingModalOptions;
    private state: ModalState;
    
    // DOM元素引用
    private headerTitleEl: HTMLElement;
    private headerCountEl: HTMLElement;
    private modelInfoEl: HTMLElement;
    private promptInfoEl: HTMLElement;
    private charCountEl: HTMLElement;
    private contentDisplayEl: HTMLDivElement | HTMLTextAreaElement;  // 改名以避免与Modal的contentEl冲突
    private contentContainer: HTMLElement;
    private refreshBtn: HTMLButtonElement;
    private confirmBtn: HTMLButtonElement;
    private cancelBtn: HTMLButtonElement;
    
    // 更新控制
    private updateBuffer: string = "";
    private lastUpdateTime: number = 0;
    private readonly UPDATE_INTERVAL = 100; // 毫秒

    constructor(app: App, options: AIStreamingModalOptions) {
        super(app);
        this.options = options;
        this.state = {
            phase: 'generating',
            content: '',
            characterCount: 0
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-streaming-modal');

        // 创建标题栏
        this.createHeader();

        // 创建信息栏
        this.createInfoBar();

        // 创建内容显示区域
        this.createContentArea();

        // 创建控制按钮区域
        this.createControls();

        // 初始化状态
        this.updateUIState();
    }

    /**
     * 创建标题栏
     */
    private createHeader() {
        const header = this.contentEl.createDiv({ cls: 'ai-streaming-modal__header' });
        
        this.headerTitleEl = header.createEl('h2', {
            text: localInstance.ai_streaming_modal_title,
            cls: 'ai-streaming-modal__header-title'
        });

        this.headerCountEl = header.createEl('span', {
            text: `${localInstance.ai_streaming_char_count}: 0`,
            cls: 'ai-streaming-modal__header-count'
        });
    }

    /**
     * 创建信息栏
     */
    private createInfoBar() {
        const infoBar = this.contentEl.createDiv({ cls: 'ai-streaming-modal__info-bar' });

        // 模型信息
        const modelSection = infoBar.createDiv({ cls: 'ai-streaming-modal__info-section' });
        modelSection.createEl('span', {
            text: `${localInstance.ai_streaming_model_label}: `,
            cls: 'ai-streaming-modal__info-label'
        });
        this.modelInfoEl = modelSection.createEl('span', {
            text: this.options.modelInfo,
            cls: 'ai-streaming-modal__info-value'
        });

        // 提示词信息(带悬浮提示)
        const promptSection = infoBar.createDiv({ cls: 'ai-streaming-modal__info-section' });
        promptSection.createEl('span', {
            text: `${localInstance.ai_streaming_prompt_label}: `,
            cls: 'ai-streaming-modal__info-label'
        });
        this.promptInfoEl = promptSection.createEl('span', {
            text: this.options.promptDisplayText,
            cls: 'ai-streaming-modal__info-value ai-streaming-modal__info-prompt'
        });
        
        // 添加悬浮提示
        this.promptInfoEl.setAttribute('aria-label', this.options.fullPromptContent);

        // 字符统计
        const countSection = infoBar.createDiv({ cls: 'ai-streaming-modal__info-section' });
        this.charCountEl = countSection.createEl('span', {
            text: `0 ${localInstance.ai_streaming_char_count}`,
            cls: 'ai-streaming-modal__info-value'
        });
        this.charCountEl.setAttribute('aria-live', 'polite');
    }

    /**
     * 创建内容显示区域
     */
    private createContentArea() {
        this.contentContainer = this.contentEl.createDiv({
            cls: 'ai-streaming-modal__content-container'
        });

        // 初始创建只读div
        this.contentDisplayEl = this.contentContainer.createDiv({
            cls: 'ai-streaming-modal__content ai-streaming-modal__content--generating'
        }) as HTMLDivElement;

        this.contentDisplayEl.setAttribute('role', 'textbox');
        this.contentDisplayEl.setAttribute('aria-multiline', 'true');
        this.contentDisplayEl.setAttribute('aria-readonly', 'true');
    }

    /**
     * 创建控制按钮区域
     */
    private createControls() {
        const controls = this.contentEl.createDiv({ cls: 'ai-streaming-modal__controls' });

        // 刷新按钮
        this.refreshBtn = controls.createEl('button', {
            text: localInstance.ai_streaming_btn_refresh,
            cls: 'ai-streaming-modal__btn-refresh'
        });
        this.refreshBtn.setAttribute('aria-label', localInstance.ai_streaming_btn_refresh);
        this.refreshBtn.addEventListener('click', () => this.handleRefresh());

        // 确认按钮
        this.confirmBtn = controls.createEl('button', {
            text: localInstance.ai_streaming_btn_confirm,
            cls: 'ai-streaming-modal__btn-confirm mod-cta'
        });
        this.confirmBtn.setAttribute('aria-label', localInstance.ai_streaming_btn_confirm);
        this.confirmBtn.addEventListener('click', () => this.handleConfirm());

        // 取消按钮
        this.cancelBtn = controls.createEl('button', {
            text: localInstance.ai_streaming_btn_cancel,
            cls: 'ai-streaming-modal__btn-cancel'
        });
        this.cancelBtn.setAttribute('aria-label', localInstance.ai_streaming_btn_cancel);
        this.cancelBtn.addEventListener('click', () => this.handleCancel());

        // 添加键盘快捷键支持
        this.scope.register(['Ctrl'], 'Enter', () => {
            if (this.state.phase === 'completed') {
                this.handleConfirm();
            }
            return false;
        });

        this.scope.register(['Mod'], 'Enter', () => {
            if (this.state.phase === 'completed') {
                this.handleConfirm();
            }
            return false;
        });
    }

    /**
     * 更新UI状态
     */
    private updateUIState() {
        const { phase } = this.state;

        // 更新按钮状态
        if (phase === 'generating') {
            this.refreshBtn.disabled = true;
            this.confirmBtn.disabled = true;
            this.confirmBtn.textContent = localInstance.ai_streaming_generating;
            this.cancelBtn.disabled = false;
        } else if (phase === 'completed') {
            this.refreshBtn.disabled = false;
            this.confirmBtn.disabled = false;
            this.confirmBtn.textContent = localInstance.ai_streaming_btn_confirm;
            this.cancelBtn.disabled = false;
        } else if (phase === 'error') {
            this.refreshBtn.disabled = false;
            this.confirmBtn.disabled = true;
            this.cancelBtn.disabled = false;
        }

        // 更新标题
        if (phase === 'completed') {
            this.headerTitleEl.textContent = localInstance.ai_streaming_modal_title_completed;
        } else if (phase === 'error') {
            this.headerTitleEl.textContent = localInstance.ai_streaming_error_title;
        }
    }

    /**
     * 更新内容(批量更新策略)
     */
    public updateContent(chunk: string) {
        this.updateBuffer += chunk;
        const now = Date.now();

        if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
            this.flushUpdate();
        }
    }

    /**
     * 刷新缓冲区的更新
     */
    private flushUpdate() {
        if (this.updateBuffer.length === 0) return;

        this.state.content += this.updateBuffer;
        this.state.characterCount = this.state.content.length;
        this.updateBuffer = "";
        this.lastUpdateTime = Date.now();

        // 更新DOM
        if (this.contentDisplayEl instanceof HTMLDivElement) {
            this.contentDisplayEl.textContent = this.state.content;
            // 自动滚动到底部
            this.contentDisplayEl.scrollTop = this.contentDisplayEl.scrollHeight;
        }

        // 更新字符计数
        this.updateCharacterCount();
    }

    /**
     * 更新字符计数显示
     */
    private updateCharacterCount() {
        const count = this.state.characterCount;
        this.headerCountEl.textContent = `${localInstance.ai_streaming_char_count}: ${count}`;
        this.charCountEl.textContent = `${count} ${localInstance.ai_streaming_char_count}`;
    }

    /**
     * 标记生成完成
     */
    public markAsCompleted() {
        // 确保最后的更新刷新
        this.flushUpdate();
        
        this.state.phase = 'completed';
        this.updateUIState();
        this.enableEditing();
    }

    /**
     * 标记为错误状态
     */
    public markAsError(errorMessage: string) {
        this.flushUpdate();
        
        this.state.phase = 'error';
        this.state.errorMessage = errorMessage;
        
        // 在内容区域显示错误信息
        if (this.contentDisplayEl instanceof HTMLDivElement) {
            this.contentDisplayEl.addClass('ai-streaming-modal__content--error');
            this.contentDisplayEl.textContent = this.state.content + '\n\n' + errorMessage;
        }
        
        this.updateUIState();
    }

    /**
     * 切换为可编辑状态
     */
    private enableEditing() {
        // 移除旧的内容元素
        this.contentDisplayEl.remove();

        // 创建可编辑的textarea
        const textarea = this.contentContainer.createEl('textarea', {
            cls: 'ai-streaming-modal__content ai-streaming-modal__content--editable',
            text: this.state.content
        });
        
        textarea.setAttribute('role', 'textbox');
        textarea.setAttribute('aria-multiline', 'true');
        textarea.setAttribute('aria-readonly', 'false');
        
        this.contentDisplayEl = textarea;

        // 聚焦到编辑区域
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 50);
    }

    /**
     * 处理刷新按钮点击
     */
    private handleRefresh() {
        this.options.onRefresh();
    }

    /**
     * 处理确认按钮点击
     */
    private handleConfirm() {
        const finalContent = this.contentDisplayEl instanceof HTMLTextAreaElement
            ? this.contentDisplayEl.value
            : this.state.content;
        
        this.options.onConfirm(finalContent);
        this.close();
    }

    /**
     * 处理取消按钮点击
     */
    private handleCancel() {
        this.options.onCancel();
        this.close();
    }

    /**
     * 获取当前内容
     */
    public getContent(): string {
        return this.state.content;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
