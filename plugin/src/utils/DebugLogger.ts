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
		if (this.shouldLog('debug')) {
			console.debug(message, ...args);
		}
	}

	/**
	 * 输出 info 级别日志
	 */
	static info(message: string, ...args: any[]): void {
		if (this.shouldLog('info')) {
			console.info(message, ...args);
		}
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
		if (this.debugMode) {
			console.log(message, ...args);
		}
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
		if (!this.llmConsoleLogEnabled) {
			return;
		}

		const level = options?.level ?? 'debug';

		const maxContentChars = options?.maxContentChars ?? (level === 'debug' ? 12000 : 4000);
		const maxTotalChars = options?.maxTotalChars ?? (level === 'debug' ? 80000 : 20000);
		const printRaw = options?.printRaw ?? false;

		let used = 0;
		const normalized = (messages ?? []).map((m, index) => {
			const role = String(m?.role ?? 'unknown');
			const rawContent = typeof m?.content === 'string' ? m.content : '';
			let content = rawContent;
			const remaining = Math.max(0, maxTotalChars - used);
			const perItemCap = Math.min(maxContentChars, remaining);
			if (content.length > perItemCap) {
				content = content.slice(0, perItemCap) + `\n…(已截断, 原长度=${rawContent.length})`;
			}
			used += Math.min(rawContent.length, perItemCap);

			const embeds = (m as any)?.embeds as unknown;
			let embedsCount: number | undefined;
			if (Array.isArray(embeds)) {
				embedsCount = embeds.length;
			}

			return {
				index,
				role,
				content,
				contentLength: rawContent.length,
				embedsCount
			};
		});

		const header = `[LLM] ${tag} | messages=${normalized.length}`;
		try {
			console.groupCollapsed(header);
			console.table(normalized.map(({ index, role, contentLength, embedsCount }) => ({ index, role, contentLength, embedsCount })));
			for (const item of normalized) {
				console.log(`#${item.index} (${item.role})\n${item.content}`);
			}
			if (printRaw) {
				console.log('rawMessages:', messages);
			}
			console.groupEnd();
		} catch {
			// 兼容性兜底：不支持 group/table 时退化
			console.log(header, normalized);
		}
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
		if (!this.llmConsoleLogEnabled) {
			return;
		}

		const level = options?.level ?? 'debug';

		const previewChars = options?.previewChars ?? this.llmResponsePreviewChars;
		const text = typeof responseText === 'string' ? responseText : String(responseText ?? '');
		const preview = text.slice(0, previewChars);
		const suffix = text.length > previewChars ? `…(已截断, 总长度=${text.length})` : (options?.printLength ?? true) ? `(长度=${text.length})` : '';
		const header = `[LLM] ${tag} | responsePreview`;
		try {
			console.log(header + `\n${preview}${suffix ? '\n' + suffix : ''}`);
		} catch {
			// ignore
		}
	}
}
