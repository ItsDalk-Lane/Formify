import type { App } from 'obsidian';
import type { ToolDefinition } from '../types/tools';
import { ScriptExecutionService } from 'src/service/ScriptExecutionService';

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

export const createExecuteScriptTool = (app?: App): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'execute_script',
		name: 'execute_script',
		description: `执行 JavaScript 代码片段并返回结果。当用户需要「运行代码」「执行脚本」「计算」「处理数据」时使用此工具。

⛔ 负面约束：
- 对于简单的文件操作（读写、搜索），不要编写脚本，应使用专门的文件工具。
- 脚本在沙箱中运行，有超时限制（默认 5 秒）。
- 这是一个高权限工具，除非用户明确要求执行代码，否则优先使用其他工具。`,
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
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as ExecuteScriptArgs;
			const code = String(args.script ?? args.code ?? '');
			const timeout = Number.isFinite(args.timeout) ? Number(args.timeout) : 5000;
			const scriptArgs = args.args ?? {};

			const service = new ScriptExecutionService(app);
			const result = await service.executeScript({
				source: 'snippet',
				script: code,
				args: scriptArgs,
				timeout
			});
			const response: ExecuteScriptResult = {
				success: result.success,
				result: result.returnValue,
				output: result.stdout ?? '',
				executionTime: result.duration,
				message: result.success ? 'Script executed successfully' : (result.error || '执行失败')
			};
			return response;
		},
		createdAt: now,
		updatedAt: now
	};
};
