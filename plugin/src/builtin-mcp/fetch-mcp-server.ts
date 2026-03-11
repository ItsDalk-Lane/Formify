import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, requestUrl } from 'obsidian';
import TurndownService from 'turndown';
import { z } from 'zod';
import {
	BUILTIN_FETCH_CLIENT_NAME,
	BUILTIN_FETCH_SERVER_ID,
	BUILTIN_FETCH_SERVER_NAME,
	BUILTIN_FETCH_SERVER_VERSION,
} from './constants';
import { serializeMcpToolResult } from './runtime/tool-result';

export interface BuiltinToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	serverId: string;
}

export interface FetchBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<BuiltinToolInfo[]>;
	close: () => Promise<void>;
}

export const DEFAULT_USER_AGENT_AUTONOMOUS =
	'ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)';

interface RobotsRule {
	type: 'allow' | 'disallow';
	path: string;
}

interface RobotsGroup {
	userAgents: string[];
	rules: RobotsRule[];
}

type RequestUrlResult = Awaited<ReturnType<typeof requestUrl>>;

export interface FetchBuiltinDependencies {
	request: (options: {
		url: string;
		method?: string;
		headers?: Record<string, string>;
		throw?: boolean;
	}) => Promise<RequestUrlResult>;
	domParserFactory?: () => DOMParser | null;
	turndownFactory?: () => TurndownService;
}

const fetchSchema = z.object({
	url: z.string().url().describe('要抓取的 URL'),
	max_length: z
		.number()
		.int()
		.positive()
		.max(1_000_000)
		.optional()
		.default(5000)
		.describe('返回内容的最大字符数'),
	start_index: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.default(0)
		.describe('从该字符下标开始继续读取内容'),
	raw: z
		.boolean()
		.optional()
		.default(false)
		.describe('返回原始内容，不对 HTML 做 Markdown 提取'),
});

const defaultDependencies: FetchBuiltinDependencies = {
	request: async (options) => await requestUrl(options),
	domParserFactory: () =>
		typeof DOMParser !== 'undefined' ? new DOMParser() : null,
	turndownFactory: () =>
		new TurndownService({
			headingStyle: 'atx',
			codeBlockStyle: 'fenced',
		}),
};

const getHeaderValue = (
	headers: RequestUrlResult['headers'] | Headers | Record<string, unknown> | undefined,
	name: string
): string => {
	if (!headers) return '';
	if (typeof (headers as Headers).get === 'function') {
		return (headers as Headers).get(name) ?? '';
	}
	const targetName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === targetName) {
			return String(value ?? '');
		}
	}
	return '';
};

const stripHtmlTags = (html: string): string =>
	html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const pickContentRoot = (doc: Document): Element | null => {
	const candidates = [
		doc.querySelector('article'),
		doc.querySelector('main'),
		doc.querySelector('[role="main"]'),
		doc.body,
	].filter(Boolean) as Element[];

	if (candidates.length === 0) {
		return null;
	}

	return [...candidates].sort((left, right) => {
		const leftLength = left.textContent?.trim().length ?? 0;
		const rightLength = right.textContent?.trim().length ?? 0;
		return rightLength - leftLength;
	})[0];
};

export function extractContentFromHtml(
	html: string,
	dependencies: Pick<FetchBuiltinDependencies, 'domParserFactory' | 'turndownFactory'> = defaultDependencies
): string {
	const parser = dependencies.domParserFactory?.() ?? null;
	const turndown = dependencies.turndownFactory?.() ?? defaultDependencies.turndownFactory();

	if (!parser) {
		return stripHtmlTags(html);
	}

	const doc = parser.parseFromString(html, 'text/html');
	doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
	const root = pickContentRoot(doc);
	if (!root) {
		return stripHtmlTags(html);
	}

	const markdown = turndown.turndown(root.innerHTML).trim();
	return markdown || stripHtmlTags(root.textContent ?? html);
}

export function getRobotsTxtUrl(url: string): string {
	const parsed = new URL(url);
	parsed.pathname = '/robots.txt';
	parsed.search = '';
	parsed.hash = '';
	return parsed.toString();
}

const parseRobotsGroups = (robotsTxt: string): RobotsGroup[] => {
	const groups: RobotsGroup[] = [];
	let currentGroup: RobotsGroup = { userAgents: [], rules: [] };

	const pushCurrentGroup = () => {
		if (currentGroup.userAgents.length === 0) {
			currentGroup = { userAgents: [], rules: [] };
			return;
		}
		groups.push(currentGroup);
		currentGroup = { userAgents: [], rules: [] };
	};

	for (const rawLine of robotsTxt.split('\n')) {
		const line = rawLine.replace(/#.*$/, '').trim();
		if (!line) {
			if (currentGroup.rules.length > 0) {
				pushCurrentGroup();
			}
			continue;
		}

		const separatorIndex = line.indexOf(':');
		if (separatorIndex < 0) continue;

		const field = line.slice(0, separatorIndex).trim().toLowerCase();
		const value = line.slice(separatorIndex + 1).trim();
		if (!value) continue;

		if (field === 'user-agent') {
			if (currentGroup.rules.length > 0) {
				pushCurrentGroup();
			}
			currentGroup.userAgents.push(value.toLowerCase());
			continue;
		}

		if (field === 'allow' || field === 'disallow') {
			if (currentGroup.userAgents.length === 0) {
				continue;
			}
			currentGroup.rules.push({
				type: field,
				path: value,
			});
		}
	}

	pushCurrentGroup();
	return groups;
};

const ruleToRegex = (pathPattern: string): RegExp => {
	const escaped = pathPattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\\\*/g, '.*');
	const suffix = pathPattern.endsWith('$') ? '' : '.*';
	const normalized = pathPattern.endsWith('$')
		? escaped.slice(0, -2)
		: escaped;
	return new RegExp(`^${normalized}${suffix}`);
};

const resolveMatchingRules = (
	pathname: string,
	userAgent: string,
	robotsTxt: string
): RobotsRule[] => {
	const normalizedAgent = userAgent.toLowerCase();
	const groups = parseRobotsGroups(robotsTxt);
	const matchingGroups = groups.filter((group) =>
		group.userAgents.some(
			(agent) =>
				agent === '*'
				|| normalizedAgent.includes(agent)
				|| agent.includes(normalizedAgent)
		)
	);

	if (matchingGroups.length === 0) {
		return [];
	}

	const specificity = Math.max(
		...matchingGroups.map((group) =>
			Math.max(
				...group.userAgents
					.filter((agent) => agent === '*' || normalizedAgent.includes(agent) || agent.includes(normalizedAgent))
					.map((agent) => (agent === '*' ? 0 : agent.length))
			)
		)
	);

	return matchingGroups
		.filter((group) =>
			group.userAgents.some((agent) =>
				(agent === '*' ? 0 : agent.length) === specificity
			)
		)
		.flatMap((group) => group.rules)
		.filter((rule) => rule.path !== '')
		.filter((rule) => ruleToRegex(rule.path).test(pathname));
};

export function isUrlAllowedByRobots(
	url: string,
	userAgent: string,
	robotsTxt: string
): boolean {
	const pathname = new URL(url).pathname || '/';
	const matchingRules = resolveMatchingRules(pathname, userAgent, robotsTxt);
	if (matchingRules.length === 0) {
		return true;
	}

	const sortedRules = [...matchingRules].sort((left, right) => {
		if (right.path.length !== left.path.length) {
			return right.path.length - left.path.length;
		}
		if (left.type === right.type) {
			return 0;
		}
		return left.type === 'allow' ? -1 : 1;
	});

	return sortedRules[0].type !== 'disallow';
}

export async function checkMayAutonomouslyFetchUrl(
	url: string,
	userAgent: string,
	dependencies: FetchBuiltinDependencies = defaultDependencies
): Promise<void> {
	const robotsUrl = getRobotsTxtUrl(url);
	let response: RequestUrlResult;
	try {
		response = await dependencies.request({
			url: robotsUrl,
			method: 'GET',
			headers: { 'User-Agent': userAgent },
			throw: false,
		});
	} catch (error) {
		throw new Error(`Failed to fetch robots.txt ${robotsUrl} due to a connection issue`);
	}

	if (response.status === 401 || response.status === 403) {
		throw new Error(
			`When fetching robots.txt (${robotsUrl}), received status ${response.status} so assuming that autonomous fetching is not allowed.`
		);
	}

	if (response.status >= 400 && response.status < 500) {
		return;
	}

	const robotsTxt = response.text ?? '';
	if (!isUrlAllowedByRobots(url, userAgent, robotsTxt)) {
		throw new Error(
			`The site's robots.txt (${robotsUrl}) does not allow autonomous fetching for ${url}.`
		);
	}
}

export async function fetchUrl(
	url: string,
	userAgent: string,
	forceRaw = false,
	dependencies: FetchBuiltinDependencies = defaultDependencies
): Promise<{ content: string; prefix: string }> {
	let response: RequestUrlResult;
	try {
		response = await dependencies.request({
			url,
			method: 'GET',
			headers: { 'User-Agent': userAgent },
			throw: false,
		});
	} catch (error) {
		throw new Error(`Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (response.status >= 400) {
		throw new Error(`Failed to fetch ${url} - status code ${response.status}`);
	}

	const rawText = response.text ?? '';
	const contentType = getHeaderValue(response.headers, 'content-type');
	const isHtml =
		contentType.includes('text/html')
		|| contentType.includes('application/xhtml+xml')
		|| /<html[\s>]/i.test(rawText.slice(0, 200));

	if (isHtml && !forceRaw) {
		return {
			content: extractContentFromHtml(rawText, dependencies),
			prefix: '',
		};
	}

	return {
		content: rawText,
		prefix: `Content type ${contentType || 'unknown'} cannot be simplified to markdown, but here is the raw content:\n`,
	};
}

export function truncateFetchContent(
	content: string,
	startIndex: number,
	maxLength: number
): string {
	if (startIndex >= content.length) {
		return '<error>No more content available.</error>';
	}

	const truncated = content.slice(startIndex, startIndex + maxLength);
	if (!truncated) {
		return '<error>No more content available.</error>';
	}

	const nextStart = startIndex + truncated.length;
	if (truncated.length === maxLength && nextStart < content.length) {
		return `${truncated}\n\n<error>Content truncated. Call the fetch tool with a start_index of ${nextStart} to get more content.</error>`;
	}
	return truncated;
}

export async function createFetchBuiltinRuntime(
	_app: App,
	dependencies: Partial<FetchBuiltinDependencies> = {}
): Promise<FetchBuiltinRuntime> {
	const resolvedDependencies: FetchBuiltinDependencies = {
		...defaultDependencies,
		...dependencies,
	};
	const server = new McpServer({
		name: BUILTIN_FETCH_SERVER_NAME,
		version: BUILTIN_FETCH_SERVER_VERSION,
	});

	server.registerTool(
		'fetch',
		{
			description: '抓取网页内容，并在可能时提取为 Markdown 文本。',
			inputSchema: fetchSchema,
		},
		async (args) => {
			try {
				const parsed = fetchSchema.parse(args);
				await checkMayAutonomouslyFetchUrl(
					parsed.url,
					DEFAULT_USER_AGENT_AUTONOMOUS,
					resolvedDependencies
				);
				const { content, prefix } = await fetchUrl(
					parsed.url,
					DEFAULT_USER_AGENT_AUTONOMOUS,
					parsed.raw,
					resolvedDependencies
				);
				const truncated = truncateFetchContent(
					content,
					parsed.start_index,
					parsed.max_length
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: `${prefix}Contents of ${parsed.url}:\n${truncated}`,
						},
					],
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: 'text' as const,
							text: error instanceof Error ? error.message : String(error),
						},
					],
				};
			}
		}
	);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_FETCH_CLIENT_NAME,
		version: BUILTIN_FETCH_SERVER_VERSION,
	});

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const close = async (): Promise<void> => {
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_FETCH_SERVER_ID,
		serverName: BUILTIN_FETCH_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return serializeMcpToolResult({
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				serverId: BUILTIN_FETCH_SERVER_ID,
			}));
		},
		close,
	};
}

export async function createFetchBuiltinClient(app: App): Promise<Client> {
	const runtime = await createFetchBuiltinRuntime(app);
	return runtime.client;
}
