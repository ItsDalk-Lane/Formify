import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PlanState } from '../runtime/plan-state';
import { registerBuiltinTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';

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

const writePlanResultSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	tasks: z.array(
		z.object({
			name: z.string(),
			status: z.enum(['todo', 'in_progress', 'done', 'skipped']),
			acceptance_criteria: z.array(z.string()),
			outcome: z.string().optional(),
		})
	),
	summary: z.object({
		total: z.number().int().nonnegative(),
		todo: z.number().int().nonnegative(),
		inProgress: z.number().int().nonnegative(),
		done: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
	}),
});

const buildToolDescription = (parts: {
	what: string;
	when: string;
	notFor: string;
	returns: string;
	recovery: string;
}): string =>
	[
		`做什么：${parts.what}`,
		`什么时候用：${parts.when}`,
		`不要在什么场景用：${parts.notFor}`,
		`返回什么：${parts.returns}`,
		`失败后下一步怎么做：${parts.recovery}`,
	].join('\n');

export function registerPlanTools(
	server: McpServer,
	registry: BuiltinToolRegistry,
	planState: PlanState
): void {
	registerBuiltinTool(
		server,
		registry,
		'write_plan',
		{
			title: '更新 Live Plan',
			description: buildToolDescription({
				what: '创建或更新当前会话的 live plan（内存态），支持设置标题、描述和任务列表（含状态、验收标准、执行结果）。',
				when: '需要为复杂任务创建执行计划、更新任务进度或记录任务执行结果时使用。',
				notFor: '不要用于直接操作文件、执行命令或读取内容；这些场景请使用对应的文件系统工具或脚本工具。',
				returns: '更新后的完整计划状态，包括 title、description、tasks 数组（含 name、status、acceptance_criteria、outcome），以及 summary 统计（total、todo、inProgress、done、skipped）。',
				recovery: '如果任务状态更新失败，检查 status 值是否为有效枚举（todo/in_progress/done/skipped）；如果任务列表为空，确保 tasks 至少包含一个任务。',
			}),
			inputSchema: writePlanSchema,
			outputSchema: writePlanResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		({ title, description, tasks }) => {
			return planState.update({
				title,
				description,
				tasks,
			});
		}
	);
}
