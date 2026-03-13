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
			description: '创建或更新当前会话的 live plan（内存态），并返回完整计划状态。',
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
