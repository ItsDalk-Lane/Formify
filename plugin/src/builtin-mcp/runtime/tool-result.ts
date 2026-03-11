export interface McpToolResultContentItem {
	type?: string;
	text?: string;
	[key: string]: unknown;
}

export interface McpToolResultLike {
	content?: McpToolResultContentItem[];
	isError?: boolean;
}

const MAX_TOOL_RESULT_TEXT_LENGTH = 2 * 1024 * 1024;

const toJsonText = (value: unknown): string => {
	try {
		return JSON.stringify(value, null, 2);
	} catch (error) {
		return String(error instanceof Error ? error.message : value);
	}
};

const serializeContentItem = (item: McpToolResultContentItem): string => {
	if (item.type === 'text' && typeof item.text === 'string') {
		return item.text;
	}
	return toJsonText(item);
};

const truncate = (text: string): string => {
	if (text.length <= MAX_TOOL_RESULT_TEXT_LENGTH) {
		return text;
	}
	return `${text.slice(0, MAX_TOOL_RESULT_TEXT_LENGTH)}\n\n[结果已截断]`;
};

export function serializeMcpToolResult(result: McpToolResultLike): string {
	const text = truncate(
		(result.content ?? [])
			.map((item) => serializeContentItem(item))
			.filter((item) => item.length > 0)
			.join('\n')
	);
	if (result.isError) {
		return `[工具执行错误] ${text}`;
	}
	return text;
}
