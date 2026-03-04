import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { moment } from 'obsidian';
import { z } from 'zod';
import { AgentRegistry } from '../runtime/agent-registry';
import { PlanState } from '../runtime/plan-state';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import {
	buildCurrentTimeResult,
	buildTimeConversionResult,
} from './time-utils';

const nowSchema = z.object({
	format: z
		.string()
		.default('YYYY-MM-DD HH:mm:ss ddd')
		.optional()
		.describe('Moment.js 格式字符串'),
	timezone: z
		.string()
		.optional()
		.describe(
			"IANA 时区名称（如 'Asia/Shanghai', 'Europe/London'）。提供后返回结构化时间信息。"
		),
	source_timezone: z
		.string()
		.optional()
		.describe(
			"IANA 源时区名称（如 'Europe/Warsaw'）。与 time、target_timezone 一起使用。"
		),
	time: z
		.string()
		.optional()
		.describe("待转换时间，24 小时制 HH:MM（如 '12:30'）。"),
	target_timezone: z
		.string()
		.optional()
		.describe(
			"IANA 目标时区名称（如 'America/New_York'）。与 source_timezone、time 一起使用。"
		),
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
	id: z
		.string()
		.min(1)
		.describe('代理 ID（内置默认代理: builtin.echo）'),
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
		({
			format = 'YYYY-MM-DD HH:mm:ss ddd',
			timezone,
			source_timezone,
			time,
			target_timezone,
		}) => {
			const hasTimezone = typeof timezone === 'string' && timezone.trim() !== '';
			const hasConversionArg =
				(typeof source_timezone === 'string' && source_timezone.trim() !== '')
				|| (typeof time === 'string' && time.trim() !== '')
				|| (typeof target_timezone === 'string' && target_timezone.trim() !== '');

			if (hasTimezone && hasConversionArg) {
				throw new Error(
					'Argument conflict: timezone cannot be used together with source_timezone/time/target_timezone'
				);
			}

			if (hasTimezone) {
				return buildCurrentTimeResult(timezone as string);
			}

			if (hasConversionArg) {
				const missing = [
					['source_timezone', source_timezone],
					['time', time],
					['target_timezone', target_timezone],
				]
					.filter(([, value]) => typeof value !== 'string' || value.trim() === '')
					.map(([name]) => name);

				if (missing.length > 0) {
					throw new Error(
						`Missing required arguments for conversion mode: ${missing.join(', ')}`
					);
				}

				return buildTimeConversionResult(
					source_timezone as string,
					time as string,
					target_timezone as string
				);
			}

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
		'将任务委托给已注册代理执行。内置默认代理: builtin.echo。',
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
