/**
 * 补全请求管理器
 * 负责构造AI请求、管理请求生命周期、处理超时等
 */

import { Notice } from 'obsidian';
import type { AutoCompletionSettings } from '../settings';
import type { TarsSettings } from 'src/features/tars';
import { DebugLogger } from 'src/utils/DebugLogger';
import { availableVendors } from 'src/features/tars';
import type { Message } from 'src/features/tars/providers';

/**
 * 请求结果
 */
export interface CompletionResult {
	/** 补全文本 */
	text: string;
	/** 是否成功 */
	success: boolean;
	/** 错误信息(如果有) */
	error?: string;
}

/**
 * 补全请求管理器类
 */
export class CompletionRequestManager {
	private settings: AutoCompletionSettings;
	private tarsSettings: TarsSettings;
	private currentRequest: AbortController | null = null;
	private timeoutId: NodeJS.Timeout | null = null;

	constructor(settings: AutoCompletionSettings, tarsSettings: TarsSettings) {
		this.settings = settings;
		this.tarsSettings = tarsSettings;
	}

	/**
	 * 发送补全请求
	 * @param context 上下文文本
	 * @returns 补全结果
	 */
	async request(context: string): Promise<CompletionResult> {
		// 取消之前的请求
		this.cancelCurrentRequest();

		// 检查是否配置了模型
		if (!this.settings.defaultModel) {
			DebugLogger.warn('[CompletionRequestManager] 未配置默认模型');
			return {
				text: '',
				success: false,
				error: '请先在设置中配置默认补全模型'
			};
		}

		// 查找对应的provider
		const provider = this.tarsSettings.providers.find(
			p => p.tag === this.settings.defaultModel
		);

		if (!provider) {
			DebugLogger.warn('[CompletionRequestManager] 未找到对应的provider', this.settings.defaultModel);
			return {
				text: '',
				success: false,
				error: `未找到模型配置: ${this.settings.defaultModel}`
			};
		}

		// 获取vendor
		const vendor = availableVendors.find(v => v.name === provider.vendor);
		if (!vendor) {
			DebugLogger.error('[CompletionRequestManager] 未找到对应的vendor', provider.vendor);
			return {
				text: '',
				success: false,
				error: `不支持的AI服务商: ${provider.vendor}`
			};
		}

		// 创建AbortController
		this.currentRequest = new AbortController();
		const controller = this.currentRequest;

		// 构造提示词
		const prompt = this.buildPrompt(context);

		// 构造消息数组
		const messages: Message[] = [
			{
				role: 'user',
				content: prompt
			}
		];

		DebugLogger.debug('[CompletionRequestManager] 开始请求', {
			model: this.settings.defaultModel,
			contextLength: context.length,
			promptLength: prompt.length
		});

		try {
			// 设置超时
			this.setupTimeout(controller);

			// 获取sendRequestFunc
			const sendRequest = vendor.sendRequestFunc({
				...provider.options,
				temperature: this.settings.temperature,
				max_tokens: this.settings.maxTokens
			} as any);

			// 调用AI服务
			let completionText = '';
			
			// 处理流式或非流式响应
			const generator = sendRequest(messages, controller, async () => new ArrayBuffer(0));
			
			for await (const chunk of generator) {
				if (controller.signal.aborted) {
					DebugLogger.debug('[CompletionRequestManager] 请求已取消');
					return {
						text: '',
						success: false,
						error: '请求已取消'
					};
				}
				completionText += chunk;
			}

			// 清除超时
			this.clearTimeout();

			DebugLogger.debug('[CompletionRequestManager] 请求成功', {
				completionLength: completionText.length
			});

			return {
				text: completionText.trim(),
				success: true
			};

		} catch (error) {
			this.clearTimeout();
			
			if (controller.signal.aborted) {
				DebugLogger.debug('[CompletionRequestManager] 请求被取消');
				return {
					text: '',
					success: false,
					error: '请求已取消'
				};
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			DebugLogger.error('[CompletionRequestManager] 请求失败', errorMessage);

			return {
				text: '',
				success: false,
				error: `请求失败: ${errorMessage}`
			};
		} finally {
			this.currentRequest = null;
		}
	}

	/**
	 * 构造提示词
	 */
	private buildPrompt(context: string): string {
		const template = this.settings.promptTemplate;
		return template.replace(/\{\{context\}\}/g, context);
	}

	/**
	 * 设置请求超时
	 */
	private setupTimeout(controller: AbortController): void {
		this.timeoutId = setTimeout(() => {
			DebugLogger.warn('[CompletionRequestManager] 请求超时');
			controller.abort();
		}, this.settings.requestTimeout);
	}

	/**
	 * 清除超时定时器
	 */
	private clearTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}

	/**
	 * 取消当前请求
	 */
	cancelCurrentRequest(): void {
		if (this.currentRequest) {
			this.currentRequest.abort();
			this.currentRequest = null;
		}
		this.clearTimeout();
	}

	/**
	 * 检查是否有进行中的请求
	 */
	hasActiveRequest(): boolean {
		return this.currentRequest !== null;
	}

	/**
	 * 更新设置
	 */
	updateSettings(settings: AutoCompletionSettings, tarsSettings: TarsSettings): void {
		this.settings = settings;
		this.tarsSettings = tarsSettings;
		DebugLogger.debug('[CompletionRequestManager] 设置已更新');
	}

	/**
	 * 销毁
	 */
	dispose(): void {
		this.cancelCurrentRequest();
		DebugLogger.debug('[CompletionRequestManager] 已销毁');
	}
}
