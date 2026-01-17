import * as vm from 'vm';
import type { ToolDefinition } from '../types/tools';

interface ExecuteScriptArgs {
	script?: string;
	args?: Record<string, any>;
	code?: string;
	timeout?: number;
}

interface ExecuteScriptResult {
	success: boolean;
	result: any;
	output: string;
	executionTime: number;
	message: string;
}

export const createExecuteScriptTool = (): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'execute_script',
		name: 'execute_script',
		description: '执行预定义的脚本或代码片段，并返回执行结果。',
		enabled: true,
		executionMode: 'manual',
		category: 'system',
		icon: 'Code',
		parameters: {
			type: 'object',
			properties: {
				script: {
					type: 'string',
					description: '要执行的脚本代码或脚本名称'
				},
				args: {
					type: 'object',
					description: '传递给脚本的参数对象'
				},
				timeout: {
					type: 'number',
					description: '执行超时时间（毫秒），默认 5000'
				}
			},
			required: ['script']
		},
		handler: (rawArgs: Record<string, any>) => {
			const args = rawArgs as ExecuteScriptArgs;
			const code = String(args.script ?? args.code ?? '');
			const timeout = Number.isFinite(args.timeout) ? Number(args.timeout) : 5000;
			const scriptArgs = args.args ?? {};

			if (!code.trim()) {
				throw new Error('script 不能为空。请提供要执行的脚本代码或脚本名称');
			}

			const outputLines: string[] = [];
			const safeConsole = {
				log: (...items: unknown[]) => outputLines.push(items.map(String).join(' ')),
				info: (...items: unknown[]) => outputLines.push(items.map(String).join(' ')),
				warn: (...items: unknown[]) => outputLines.push(items.map(String).join(' ')),
				error: (...items: unknown[]) => outputLines.push(items.map(String).join(' '))
			};

			const sandbox = {
				console: safeConsole,
				args: scriptArgs
			};

			const start = Date.now();
			try {
				const context = vm.createContext(sandbox);
				const wrappedCode = `"use strict";\n(() => {\n${code}\n})()`;
				const script = new vm.Script(wrappedCode);
				const resultValue = script.runInContext(context, { timeout });
				const executionTime = Date.now() - start;
				const result: ExecuteScriptResult = {
					success: true,
					result: resultValue,
					output: outputLines.join('\n'),
					executionTime,
					message: 'Script executed successfully'
				};
				return result;
			} catch (error) {
				const executionTime = Date.now() - start;
				const message = error instanceof Error ? error.message : String(error);
				const result: ExecuteScriptResult = {
					success: false,
					result: null,
					output: outputLines.join('\n'),
					executionTime,
					message: `执行失败: ${message}`
				};
				return result;
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
