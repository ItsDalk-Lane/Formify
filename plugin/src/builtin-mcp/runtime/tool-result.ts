import { DEFAULT_TOOL_RESULT_TEXT_LIMIT } from '../constants';

export interface McpToolResultContentItem {
	type?: string;
	text?: string;
	[key: string]: unknown;
}

export interface McpToolResultLike {
	structuredContent?: Record<string, unknown>;
	content?: McpToolResultContentItem[];
	isError?: boolean;
}

const toJsonText = (value: unknown): string => {
	try {
		return JSON.stringify(value, null, 2);
	} catch (error) {
		return String(error instanceof Error ? error.message : value);
	}
};

const sortJsonValue = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map((item) => sortJsonValue(item));
	}
	if (value && typeof value === 'object') {
		return Object.keys(value as Record<string, unknown>)
			.sort((left, right) => left.localeCompare(right))
			.reduce<Record<string, unknown>>((result, key) => {
				result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
				return result;
			}, {});
	}
	return value;
};

export const toCanonicalJsonText = (value: unknown): string => {
	return toJsonText(sortJsonValue(value));
};

const isStructuredContent = (value: unknown): value is Record<string, unknown> => {
	return !!value && typeof value === 'object' && !Array.isArray(value);
};

const serializeContentItem = (item: McpToolResultContentItem): string => {
	if (item.type === 'text' && typeof item.text === 'string') {
		return item.text;
	}
	return toJsonText(item);
};

export const truncateToolResultText = (text: string): string => {
	if (text.length <= DEFAULT_TOOL_RESULT_TEXT_LIMIT) {
		return text;
	}
	return `${text.slice(0, DEFAULT_TOOL_RESULT_TEXT_LIMIT)}\n\n[结果已截断，请缩小查询范围或改用更具体的参数]`;
};

export function serializeMcpToolResult(result: McpToolResultLike): string {
	const text = truncateToolResultText(
		isStructuredContent(result.structuredContent)
			? toCanonicalJsonText(result.structuredContent)
			: (result.content ?? [])
				.map((item) => serializeContentItem(item))
				.filter((item) => item.length > 0)
				.join('\n')
	);
	if (result.isError) {
		return `[工具执行错误] ${text}`;
	}
	return text;
}

export function normalizeStructuredToolResult(result: unknown): McpToolResultLike {
	if (isStructuredContent(result)) {
		const text = truncateToolResultText(toCanonicalJsonText(result));
		return {
			structuredContent: result,
			content: [
				{
					type: 'text',
					text,
				},
			],
		};
	}

	const text = truncateToolResultText(
		typeof result === 'string' ? result : toCanonicalJsonText(result)
	);
	return {
		content: [
			{
				type: 'text',
				text,
			},
		],
	};
}
