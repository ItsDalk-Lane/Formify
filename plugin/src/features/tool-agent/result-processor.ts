import { parseContentBlocks } from 'src/features/chat/utils/markdown';
import type { ProcessedResult } from './types';

const SECRET_PATTERNS = [
	/\bsk-[A-Za-z0-9_-]{12,}\b/g,
	/\b(api[_-]?key|token|secret)\b\s*[:=]\s*["']?([A-Za-z0-9._-]{8,})["']?/gi,
];

const SEARCH_TOOLS = new Set([
	'search_files',
	'search_path',
	'search_folder',
	'search_content',
	'search_tags',
	'search_line',
	'search_block',
	'search_section',
	'search_tasks',
	'search_properties',
	'quick_search',
	'advanced_search',
	'file_only_search',
	'content_only_search',
	'tag_search',
]);

export class ResultProcessor {
	processResult(
		toolName: string,
		rawResult: string,
		context: { task: string }
	): ProcessedResult {
		const stripped = this.stripMarkers(rawResult);
		const sanitized = this.maskSecrets(stripped);
		const parsed = this.tryParseJson(sanitized);

		if (SEARCH_TOOLS.has(toolName) && parsed && typeof parsed === 'object' && Array.isArray((parsed as any).results)) {
			const results = (parsed as any).results as unknown[];
			if (results.length > 10) {
				const truncated = {
					...(parsed as Record<string, unknown>),
					results: results.slice(0, 10),
					truncated: true,
					truncationNote: `Reduced ${results.length} search hits to the first 10 for model context.`,
				};
				return {
					rawResult: sanitized,
					contentForModel: JSON.stringify(truncated),
					structuredData: truncated,
					wasTruncated: true,
					truncationNote: String((truncated as any).truncationNote),
				};
			}
		}

		if (toolName === 'list_directory' && parsed && typeof parsed === 'object' && Array.isArray((parsed as any).items)) {
			const items = (parsed as any).items as Array<Record<string, unknown>>;
			if (items.length > 20) {
				const fileCount = items.filter((item) => item.type === 'file').length;
				const folderCount = items.filter((item) => item.type === 'folder').length;
				const truncated = {
					...(parsed as Record<string, unknown>),
					items: items.slice(0, 20),
					count: items.length,
					fileCount,
					folderCount,
					truncationNote: `Reduced ${items.length} directory entries to the first 20.`,
				};
				return {
					rawResult: sanitized,
					contentForModel: JSON.stringify(truncated),
					structuredData: truncated,
					wasTruncated: true,
					truncationNote: String((truncated as any).truncationNote),
				};
			}
		}

		if (toolName === 'read_file' || toolName === 'write_file') {
			if (sanitized.length > 5000) {
				const head = sanitized.slice(0, 2000);
				const tail = sanitized.slice(-2000);
				const contentForModel = `${head}\n\n...[truncated ${sanitized.length - 4000} chars]...\n\n${tail}`;
				return {
					rawResult: sanitized,
					contentForModel,
					structuredData: parsed ?? undefined,
					wasTruncated: true,
					truncationNote: 'Large file content was trimmed to head and tail sections.',
				};
			}
		}

		if (parsed && Array.isArray(parsed) && parsed.length > 20) {
			const truncated = [...parsed.slice(0, 20), `...[truncated ${parsed.length - 20} items]`];
			return {
				rawResult: sanitized,
				contentForModel: JSON.stringify(truncated),
				structuredData: truncated,
				wasTruncated: true,
				truncationNote: 'Large array result was trimmed to the first 20 items.',
			};
		}

		return {
			rawResult: sanitized,
			contentForModel: sanitized,
			structuredData: parsed ?? undefined,
			wasTruncated: false,
		};
	}

	private stripMarkers(content: string): string {
		const blocks = parseContentBlocks(content);
		const text = blocks
			.filter((block) => block.type === 'text')
			.map((block) => block.content)
			.join('')
			.trim();
		return text || content.trim();
	}

	private maskSecrets(content: string): string {
		return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), content);
	}

	private tryParseJson(content: string): unknown | null {
		try {
			return JSON.parse(content);
		} catch {
			return null;
		}
	}
}
