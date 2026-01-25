import { requestUrl } from 'obsidian';
import type { ToolDefinition } from '../types/tools';

interface WebFetchArgs {
	url: string;
	maxLength?: number;
}

interface WebFetchResult {
	url: string;
	title: string;
	content: string;
	contentLength: number;
	truncated: boolean;
	message: string;
}

const stripHtml = (html: string): string => {
	const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
	const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
	const text = withoutStyles.replace(/<[^>]+>/g, ' ');
	return text.replace(/\s+/g, ' ').trim();
};

const decodeHtmlEntities = (text: string): string => {
	const map: Record<string, string> = {
		'&nbsp;': ' ',
		'&lt;': '<',
		'&gt;': '>',
		'&amp;': '&',
		'&quot;': '"',
		'&#39;': "'"
	};
	return text.replace(/&nbsp;|&lt;|&gt;|&amp;|&quot;|&#39;/g, (m) => map[m] ?? m);
};

const extractTitle = (html: string): string => {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return '';
	return decodeHtmlEntities(match[1].trim());
};

export const createWebFetchTool = (): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'web_fetch',
		name: 'web_fetch',
		description: `抓取指定 URL 的网页内容并返回纯文本。当用户想要「获取网页」「抓取链接」「读取 URL 内容」时使用此工具。

⛔ 负面约束：
- 此工具只能获取公开可访问的网页，不支持需要登录的页面。
- 对于 vault 内部的文件，不要使用此工具，应使用 read_file。
- 返回的是去除 HTML 标签后的纯文本，可能丢失格式信息。`,
		enabled: true,
		executionMode: 'auto',
		category: 'web',
		icon: 'Globe',
		parameters: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: '要抓取的网页 URL，必须是 http/https'
				},
				maxLength: {
					type: 'number',
					description: '返回内容的最大字符数，默认 50000'
				}
			},
			required: ['url']
		},
		handler: async (rawArgs: Record<string, any>) => {
			const args = rawArgs as WebFetchArgs;
			const url = String(args.url ?? '').trim();
			const maxLength = Number.isFinite(args.maxLength) ? Number(args.maxLength) : 50000;

			if (!url) {
				throw new Error('url 不能为空。示例: "https://example.com"');
			}

			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new Error('URL 格式无效，请提供合法的 http/https 地址');
			}

			if (!['http:', 'https:'].includes(parsed.protocol)) {
				throw new Error('仅支持 http/https 协议的 URL');
			}

			try {
				const response = await requestUrl({
					url,
					method: 'GET',
					timeout: 30000
				});
				const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase();
				const rawText = response.text ?? '';
				const title = contentType.includes('text/html') ? extractTitle(rawText) : '';
				const text = contentType.includes('text/html') ? decodeHtmlEntities(stripHtml(rawText)) : rawText;
				const truncated = text.length > maxLength;
				const content = truncated ? text.slice(0, Math.max(0, maxLength)) : text;
				const result: WebFetchResult = {
					url,
					title,
					content,
					contentLength: content.length,
					truncated,
					message: truncated ? 'Content fetched (truncated)' : 'Content fetched'
				};
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`抓取失败: ${message}`);
			}
		},
		createdAt: now,
		updatedAt: now
	};
};
