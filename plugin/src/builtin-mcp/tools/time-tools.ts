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
	.strict();

type GetTimeArgs = z.infer<typeof getTimeSchema>;

const parseGetTimeArgs = (value: GetTimeArgs): GetTimeArgs => {
	if (value.mode === 'current') {
		for (const field of ['source_timezone', 'target_timezone', 'time'] as const) {
			if (value[field] !== undefined) {
				throw new Error(`current 模式不支持参数 ${field}`);
			}
		}
		return value;
	}

	for (const field of ['source_timezone', 'target_timezone', 'time'] as const) {
		if (value[field] === undefined) {
			throw new Error(`convert 模式必须提供参数 ${field}`);
		}
	}

	if (value.timezone !== undefined) {
		throw new Error('convert 模式不支持参数 timezone');
	}

	return value;
};

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
		'get_time',
		{
			title: '获取或转换时间',
			description:
				'做什么：获取当前时间，或在两个 IANA 时区之间转换时间。\n什么时候用：用户询问当前时间、时区时间，或需要把一个时间从源时区换算到目标时区时使用。\n不要在什么场景用：不要用于日期算术、日程规划或文件操作。\n返回什么：current 模式返回当前时区时间信息；convert 模式返回 source、target 与 time_difference。\n失败后下一步怎么做：如果参数与 mode 不匹配，请按 schema 修正字段；如果只需要当前时间，不要传 convert 模式字段。',
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
			} = parseGetTimeArgs(getTimeSchema.parse(args));

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
