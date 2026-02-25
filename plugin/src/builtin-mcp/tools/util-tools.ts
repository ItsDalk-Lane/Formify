import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { moment } from 'obsidian';
import { z } from 'zod';
import { AgentRegistry } from '../runtime/agent-registry';
import { PlanState } from '../runtime/plan-state';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';

const nowSchema = z.object({
	format: z
		.string()
		.default('YYYY-MM-DD HH:mm:ss ddd')
		.optional()
		.describe('Moment.js 格式字符串'),
});

const writePlanTaskSchema = z.object({
	name: z.string().min(1),
	status: z.enum(['todo', 'in_progress', 'done', 'skipped']),
	acceptance_criteria: z.array(z.string()).optional(),
	outcome: z.string().optional(),
});

const writePlanSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	tasks: z.array(writePlanTaskSchema).min(1),
});

const delegateToAgentSchema = z.object({
	id: z.string().min(1).describe('代理 ID'),
	task: z.string().min(1).describe('任务描述'),
});

export function registerUtilTools(
	server: McpServer,
	registry: BuiltinToolRegistry,
	planState: PlanState,
	agentRegistry: AgentRegistry
): void {
	registerTextTool(
		server,
		registry,
		'now',
		'获取当前时间并按指定格式输出。',
		nowSchema,
		({ format = 'YYYY-MM-DD HH:mm:ss ddd' }) => {
			return moment().format(format);
		}
	);

	registerTextTool(
		server,
		registry,
		'write_plan',
		'创建或更新任务计划（内存态），并返回完整计划状态。',
		writePlanSchema,
		({ title, description, tasks }) => {
			return planState.update({
				title,
				description,
				tasks,
			});
		}
	);

	registerTextTool(
		server,
		registry,
		'delegate_to_agent',
		'将任务委托给已注册代理执行。',
		delegateToAgentSchema,
		async ({ id, task }) => {
			const result = await agentRegistry.delegate(id, task);
			return {
				id,
				task,
				result,
			};
		}
	);
}
