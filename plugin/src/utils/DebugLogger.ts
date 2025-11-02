/**
 * 调试日志管理器
 * 提供统一的日志输出控制
 */
export class DebugLogger {
	private static debugMode: boolean = false;
	private static debugLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';

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
}
