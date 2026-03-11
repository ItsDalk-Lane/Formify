import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PlanState } from '../runtime/plan-state';
import { registerTextTool } from '../runtime/register-tool';
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

export function registerPlanTools(
	server: McpServer,
	registry: BuiltinToolRegistry,
	planState: PlanState
): void {
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
}
