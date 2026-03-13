export type ToolHintCoercion = 'number' | 'integer' | 'boolean' | 'string_array';

export interface ToolConditionalRule {
	field: string;
	when: unknown;
	requires?: string[];
	forbids?: string[];
	message?: string;
}

export interface ToolHint {
	aliases?: Record<string, string>;
	valueCoercions?: Record<string, ToolHintCoercion>;
	mutuallyExclusive?: string[][];
	conditionalRules?: ToolConditionalRule[];
	usageHint?: string;
	fallbackTool?: string;
	normalize?: (args: Record<string, unknown>) => {
		args: Record<string, unknown>;
		notes: string[];
	};
}

const normalizeLegacyReadModeArgs = (
	args: Record<string, unknown>,
	mode: 'head' | 'tail'
): { args: Record<string, unknown>; notes: string[] } => {
	const next = { ...args };
	const notes: string[] = [];
	const legacyCount = next[mode];
	if (typeof legacyCount === 'number' && Number.isFinite(legacyCount)) {
		if (next.read_mode === undefined) {
			next.read_mode = mode;
		}
		if (next.line_count === undefined) {
			next.line_count = legacyCount;
		}
		delete next[mode];
		notes.push(`${mode} 已转换为 read_mode=${mode} 和 line_count`);
	}
	return { args: next, notes };
};

export const BUILTIN_TOOL_HINTS: Record<string, ToolHint> = {
	read_file: {
		aliases: {
			path: 'file_path',
			filePath: 'file_path',
			readMode: 'read_mode',
			startLine: 'start_line',
			lineCount: 'line_count',
			responseFormat: 'response_format',
		},
		valueCoercions: {
			start_line: 'integer',
			line_count: 'integer',
		},
		conditionalRules: [
			{
				field: 'read_mode',
				when: 'full',
				forbids: ['start_line'],
				message: 'full 模式不接受 start_line；文件过长时会返回改用 segment 的提示',
			},
			{
				field: 'read_mode',
				when: 'segment',
				requires: ['file_path'],
			},
		],
		usageHint: '已知文件路径后读取内容。长文优先使用 segment 分段读取；如果只知道名称，请先用 find_paths。',
		fallbackTool: 'find_paths',
		normalize(args) {
			let next = { ...args };
			const notes: string[] = [];
			for (const mode of ['head', 'tail'] as const) {
				const normalized = normalizeLegacyReadModeArgs(next, mode);
				next = normalized.args;
				notes.push(...normalized.notes);
			}
			if ('max_chars' in next) {
				delete next.max_chars;
				notes.push('max_chars 已移除；请改用 read_mode + line_count 控制读取范围');
			}
			return { args: next, notes };
		},
	},
	read_files: {
		aliases: {
			files: 'file_paths',
			paths: 'file_paths',
			filePaths: 'file_paths',
			readMode: 'read_mode',
			startLine: 'start_line',
			lineCount: 'line_count',
			responseFormat: 'response_format',
		},
		valueCoercions: {
			start_line: 'integer',
			line_count: 'integer',
		},
		usageHint: '用于批量预览多个已知文件路径的部分内容；单篇长文请改用 read_file。',
		fallbackTool: 'read_file',
		normalize(args) {
			const next = { ...args };
			const notes: string[] = [];
			if ('max_chars' in next) {
				delete next.max_chars;
				notes.push('max_chars 已移除；批量读取现使用 read_mode + line_count');
			}
			return { args: next, notes };
		},
	},
	read_media: {
		aliases: {
			path: 'file_path',
			filePath: 'file_path',
		},
		usageHint: '仅用于已知媒体文件路径的图片或音频读取。',
		fallbackTool: 'find_paths',
	},
	write_file: {
		aliases: {
			path: 'file_path',
			filePath: 'file_path',
		},
		usageHint: '整文件写入或覆盖时使用；局部编辑请用 edit_file。',
	},
	edit_file: {
		aliases: {
			path: 'file_path',
			filePath: 'file_path',
			dryRun: 'dry_run',
		},
		valueCoercions: {
			dry_run: 'boolean',
		},
		usageHint: '局部编辑已知文件时使用；读取内容前先用 read_file。',
	},
	create_directory: {
		aliases: {
			path: 'directory_path',
			directoryPath: 'directory_path',
		},
	},
	move_path: {
		aliases: {
			source: 'source_path',
			sourcePath: 'source_path',
			destination: 'destination_path',
			destinationPath: 'destination_path',
		},
	},
	delete_path: {
		aliases: {
			path: 'target_path',
			targetPath: 'target_path',
		},
	},
	stat_path: {
		aliases: {
			path: 'target_path',
			targetPath: 'target_path',
		},
		fallbackTool: 'find_paths',
	},
	open_file: {
		aliases: {
			path: 'file_path',
			filePath: 'file_path',
			new_panel: 'open_in_new_panel',
			newPanel: 'open_in_new_panel',
		},
		valueCoercions: {
			open_in_new_panel: 'boolean',
		},
	},
	search_content: {
		aliases: {
			fileType: 'file_types',
			fileTypes: 'file_types',
			maxResults: 'max_results',
			caseSensitive: 'case_sensitive',
			contextLines: 'context_lines',
			matchMode: 'match_mode',
			scopePath: 'scope_path',
			responseFormat: 'response_format',
		},
		valueCoercions: {
			file_types: 'string_array',
			max_results: 'integer',
			case_sensitive: 'boolean',
			context_lines: 'integer',
		},
		usageHint: '只搜索正文内容，不按文件名找路径。',
		fallbackTool: 'find_paths',
	},
	find_paths: {
		aliases: {
			scopePath: 'scope_path',
			targetType: 'target_type',
			matchMode: 'match_mode',
			maxResults: 'max_results',
			responseFormat: 'response_format',
		},
		usageHint: '只根据名称或路径片段发现路径，不读取内容。',
	},
	list_directory: {
		aliases: {
			path: 'directory_path',
			directoryPath: 'directory_path',
			includeSizes: 'include_sizes',
			sortBy: 'sort_by',
			excludePatterns: 'exclude_patterns',
			maxDepth: 'max_depth',
			maxNodes: 'max_nodes',
			responseFormat: 'response_format',
		},
		valueCoercions: {
			include_sizes: 'boolean',
			limit: 'integer',
			offset: 'integer',
			max_depth: 'integer',
			max_nodes: 'integer',
		},
		usageHint: '仅在已经知道 directory_path 时浏览目录。',
		fallbackTool: 'find_paths',
	},
	query_index: {
		aliases: {
			dataSource: 'data_source',
			groupBy: 'group_by',
			orderBy: 'order_by',
			responseFormat: 'response_format',
		},
		valueCoercions: {
			limit: 'integer',
			offset: 'integer',
		},
		usageHint: '只做结构化索引查询，不用于发现文件路径或搜索正文。',
		fallbackTool: 'find_paths',
	},
	run_shell: {
		usageHint: '只执行本机 shell 命令，不用于工具编排。',
	},
	run_script: {
		usageHint: '只做工具编排，不执行本机 shell 命令。',
	},
};

export function getBuiltinToolHint(toolName: string): ToolHint | undefined {
	return BUILTIN_TOOL_HINTS[toolName];
}
