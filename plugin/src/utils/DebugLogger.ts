/**
 * 调试日志管理器
 * 提供统一的日志输出控制
 */
export class DebugLogger {
	private static debugMode: boolean = false;
	private static debugLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';
	private static llmConsoleLogEnabled: boolean = false;
	private static llmResponsePreviewChars: number = 100;

	/**
	 * 设置调试模式
	 */
	static setDebugMode(enabled: boolean): void {
		this.debugMode = enabled;
	}

	/**
	 * 设置调试级别
	 */
	static setDebugLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
		this.debugLevel = level;
	}

	/**
	 * 设置 LLM 调用日志开关（独立于 debugMode/debugLevel）。
	 */
	static setLlmConsoleLogEnabled(enabled: boolean): void {
		this.llmConsoleLogEnabled = enabled;
	}

	/**
	 * 设置 LLM 返回预览长度（默认 100）。
	 */
	static setLlmResponsePreviewChars(chars: number): void {
		const safe = Number.isFinite(chars) ? Math.floor(chars) : 100;
		this.llmResponsePreviewChars = Math.max(0, Math.min(5000, safe));
	}

	/**
	 * 获取当前调试模式状态
	 */
	static isDebugMode(): boolean {
		return this.debugMode;
	}

	/**
	 * 检查是否应该输出该级别的日志
	 */
	private static shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
		if (!this.debugMode) return false;

		const levels = ['debug', 'info', 'warn', 'error'];
		return levels.indexOf(level) >= levels.indexOf(this.debugLevel);
	}

	/**
	 * 输出 debug 级别日志
	 */
	static debug(message: string, ...args: any[]): void {
		// intentionally noop: non-warning/error logs are disabled
	}

	/**
	 * 输出 info 级别日志
	 */
	static info(message: string, ...args: any[]): void {
		// intentionally noop: non-warning/error logs are disabled
	}

	/**
	 * 输出 warn 级别日志
	 */
	static warn(message: string, ...args: any[]): void {
		if (this.shouldLog('warn')) {
			console.warn(message, ...args);
		}
	}

	/**
	 * 输出 error 级别日志
	 */
	static error(message: string, ...args: any[]): void {
		if (this.shouldLog('error')) {
			console.error(message, ...args);
		}
	}

	/**
	 * 输出普通日志（不受调试模式控制，始终输出）
	 */
	static log(message: string, ...args: any[]): void {
		// intentionally noop: non-warning/error logs are disabled
	}

	/**
	 * 统一打印大模型请求 messages 数组（受 LLM 日志独立开关控制）。
	 * - 默认会对单条 content 做截断，避免控制台卡顿。
	 * - 会输出 embeds 数量摘要（如有）。
	 */
	static logLlmMessages(
		tag: string,
		messages: Array<{ role?: string; content?: string; embeds?: unknown }>,
		options?: {
			level?: 'debug' | 'info' | 'warn' | 'error';
			maxContentChars?: number;
			maxTotalChars?: number;
			printRaw?: boolean;
		}
	): void {
		// intentionally noop: non-warning/error logs are disabled
	}

	/**
	 * 统一打印大模型返回内容的预览（默认前 100 字符）。
	 */
	static logLlmResponsePreview(
		tag: string,
		responseText: string,
		options?: {
			level?: 'debug' | 'info' | 'warn' | 'error';
			previewChars?: number;
			printLength?: boolean;
		}
	): void {
		// intentionally noop: non-warning/error logs are disabled
	}
}
