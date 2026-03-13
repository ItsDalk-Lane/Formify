import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerBuiltinTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import {
	buildCurrentTimeResult,
	buildTimeConversionResult,
} from './time-utils';

const getTimeSchema = z
	.object({
		mode: z
			.enum(['current', 'convert'])
			.default('current')
			.describe("工具模式，'current' 获取当前时间，'convert' 转换时间"),
		timezone: z
			.string()
			.min(1)
			.optional()
			.describe("当前时间模式使用的 IANA 时区名称，例如 'Asia/Shanghai'"),
		source_timezone: z
			.string()
			.min(1)
			.optional()
			.describe("源 IANA 时区名称，例如 'America/New_York'"),
		target_timezone: z
			.string()
			.min(1)
			.optional()
			.describe("目标 IANA 时区名称，例如 'Europe/London'"),
		time: z
			.string()
			.min(1)
			.optional()
			.describe('要转换的时间，24 小时制 HH:MM'),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.mode === 'current') {
			for (const field of ['source_timezone', 'target_timezone', 'time'] as const) {
				if (value[field] !== undefined) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: [field],
						message: `current 模式不支持参数 ${field}`,
					});
				}
			}
			return;
		}

		for (const field of ['source_timezone', 'target_timezone', 'time'] as const) {
			if (value[field] === undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `convert 模式必须提供参数 ${field}`,
				});
			}
		}

		if (value.timezone !== undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['timezone'],
				message: 'convert 模式不支持参数 timezone',
			});
		}
	});

type GetTimeArgs = z.infer<typeof getTimeSchema>;

const timeResultSchema = z.object({
	timezone: z.string(),
	datetime: z.string(),
	day_of_week: z.string(),
	is_dst: z.boolean(),
	month: z.number().int(),
	iso_week_of_year: z.number().int(),
	iso_week_year: z.number().int(),
});

const getTimeResultSchema = z.object({
	mode: z.enum(['current', 'convert']),
	source: timeResultSchema.optional(),
	target: timeResultSchema.optional(),
	timezone: z.string().optional(),
	datetime: z.string().optional(),
	day_of_week: z.string().optional(),
	is_dst: z.boolean().optional(),
	month: z.number().int().optional(),
	iso_week_of_year: z.number().int().optional(),
	iso_week_year: z.number().int().optional(),
	time_difference: z.string().optional(),
});

interface RegisterTimeToolsOptions {
	defaultTimezone: string;
}

export function registerTimeTools(
	server: McpServer,
	registry: BuiltinToolRegistry,
	options: RegisterTimeToolsOptions
): void {
	registerBuiltinTool(
		server,
		registry,
		'formify_get_time',
		{
			title: '获取或转换时间',
			description: '获取当前时间，或在两个 IANA 时区之间转换时间。默认使用已配置的默认时区。',
			inputSchema: getTimeSchema,
			outputSchema: getTimeResultSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(args: GetTimeArgs) => {
			const {
				mode,
				timezone,
				source_timezone,
				target_timezone,
				time,
			} = getTimeSchema.parse(args);

			if (mode === 'convert') {
				return {
					mode,
					...buildTimeConversionResult(
						source_timezone!,
						time!,
						target_timezone!
					),
				};
			}

			return {
				mode,
				...buildCurrentTimeResult(timezone ?? options.defaultTimezone),
			};
		}
	);
}
