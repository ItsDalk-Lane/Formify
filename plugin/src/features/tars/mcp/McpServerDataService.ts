import { App, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { ensureAIDataFolders, getMcpServersPath } from 'src/utils/AIPathManager';
import { DebugLogger } from 'src/utils/DebugLogger';
import type { McpServerConfig, McpTransportType } from './types';

const FRONTMATTER_DELIMITER = '---';
const DEFAULT_TIMEOUT_MS = 30000;
const VALID_TRANSPORT_TYPES: ReadonlySet<McpTransportType> = new Set([
	'stdio',
	'sse',
	'websocket',
	'http',
	'remote-sse',
]);

type RawMcpServer = Partial<McpServerConfig> & Record<string, unknown>;

const isNonEmptyString = (value: unknown): value is string => {
	return typeof value === 'string' && value.trim().length > 0;
};

const toOptionalString = (value: unknown): string | undefined => {
	return isNonEmptyString(value) ? value : undefined;
};

const toStringArray = (value: unknown): string[] | undefined => {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
	return items.length > 0 ? items : undefined;
};

const toStringRecord = (value: unknown): Record<string, string> | undefined => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const entries = Object.entries(value).filter(([key, item]) => key.trim().length > 0 && typeof item === 'string');
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries.map(([key, item]) => [key, item.trim()]));
};

const resolveTransportType = (value: unknown): McpTransportType => {
	if (typeof value === 'string' && VALID_TRANSPORT_TYPES.has(value as McpTransportType)) {
		return value as McpTransportType;
	}
	return 'stdio';
};

const normalizeServerId = (value: unknown, fallback: string): string => {
	if (!isNonEmptyString(value)) {
		return fallback;
	}
	const sanitized = value.trim().replace(/[\\/]/g, '_');
	return sanitized.length > 0 ? sanitized : fallback;
};

const sanitizeServerConfig = (
	raw: RawMcpServer,
	fallback: { id: string; name: string }
): McpServerConfig => {
	const timeout = typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0
		? raw.timeout
		: DEFAULT_TIMEOUT_MS;
	const transportType = resolveTransportType(raw.transportType);
	const id = normalizeServerId(raw.id, fallback.id);
	const name = isNonEmptyString(raw.name) ? raw.name.trim() : fallback.name;

	return {
		id,
		name,
		enabled: raw.enabled !== false,
		transportType,
		command: toOptionalString(raw.command),
		args: toStringArray(raw.args),
		env: toStringRecord(raw.env),
		cwd: toOptionalString(raw.cwd),
		url: toOptionalString(raw.url),
		headers: toStringRecord(raw.headers),
		timeout,
	};
};

export class McpServerDataService {
	private static instance: McpServerDataService | null = null;

	private constructor(private readonly app: App) {}

	static getInstance(app: App): McpServerDataService {
		if (!McpServerDataService.instance) {
			McpServerDataService.instance = new McpServerDataService(app);
		}
		return McpServerDataService.instance;
	}

	static resetInstance(): void {
		McpServerDataService.instance = null;
	}

	async loadServers(aiDataFolder: string): Promise<McpServerConfig[]> {
		try {
			const folderPath = await this.getStorageFolderPath(aiDataFolder);
			const files = this.listMarkdownFiles(folderPath);
			const loaded: McpServerConfig[] = [];
			const now = Date.now();
			for (const [index, file] of files.entries()) {
				try {
					const content = await this.app.vault.read(file);
					const { frontmatter } = this.parseMarkdownRecord(content);
					const server = sanitizeServerConfig(frontmatter, {
						id: file.basename || `mcp_server_${now}_${index}`,
						name: file.basename || `MCP Server ${index + 1}`,
					});
					loaded.push(server);
				} catch (error) {
					DebugLogger.warn('[McpServerDataService] 读取 MCP 服务器配置失败，已跳过', { path: file.path, error });
				}
			}
			return loaded;
		} catch (error) {
			DebugLogger.error('[McpServerDataService] 读取 MCP 服务器配置目录失败', error);
			return [];
		}
	}

	async syncServers(aiDataFolder: string, servers: McpServerConfig[]): Promise<McpServerConfig[]> {
		const folderPath = await this.getStorageFolderPath(aiDataFolder);
		const now = Date.now();
		const normalized = (servers ?? [])
			.filter((item): item is McpServerConfig => !!item && typeof item === 'object')
			.map((server, index) => sanitizeServerConfig(server as RawMcpServer, {
				id: isNonEmptyString(server.id) ? server.id : `mcp_server_${now}_${index}`,
				name: isNonEmptyString(server.name) ? server.name : `MCP Server ${index + 1}`,
			}));

		const expectedPaths = new Set<string>();
		for (const server of normalized) {
			const filePath = normalizePath(`${folderPath}/${server.id}.md`);
			expectedPaths.add(filePath);
			const markdown = this.buildMarkdownRecord(server);

			const existing = this.app.vault.getAbstractFileByPath(filePath);
			if (existing instanceof TFile) {
				const previous = await this.app.vault.read(existing);
				if (previous !== markdown) {
					await this.app.vault.modify(existing, markdown);
				}
				continue;
			}

			await this.app.vault.create(filePath, markdown);
		}

		for (const file of this.listMarkdownFiles(folderPath)) {
			if (!expectedPaths.has(file.path)) {
				await this.app.vault.delete(file, true);
			}
		}

		return normalized;
	}

	private async getStorageFolderPath(aiDataFolder: string): Promise<string> {
		await ensureAIDataFolders(this.app, aiDataFolder);
		return getMcpServersPath(aiDataFolder);
	}

	private listMarkdownFiles(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			return [];
		}
		return folder.children
			.filter((child): child is TFile => child instanceof TFile && child.extension === 'md')
			.sort((a, b) => a.stat.ctime - b.stat.ctime);
	}

	private parseMarkdownRecord(content: string): { frontmatter: RawMcpServer; body: string } {
		if (!content.startsWith(FRONTMATTER_DELIMITER)) {
			return { frontmatter: {}, body: content };
		}
		const delimiterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n)?/;
		const matched = content.match(delimiterRegex);
		if (!matched) {
			return { frontmatter: {}, body: content };
		}

		try {
			const parsed = parseYaml(matched[1]);
			const frontmatter = (parsed && typeof parsed === 'object' ? parsed : {}) as RawMcpServer;
			const body = content.slice(matched[0].length);
			return { frontmatter, body };
		} catch (error) {
			DebugLogger.warn('[McpServerDataService] 解析 MCP frontmatter 失败，已使用默认值', error);
			return { frontmatter: {}, body: '' };
		}
	}

	private buildMarkdownRecord(frontmatter: RawMcpServer): string {
		const yaml = stringifyYaml(frontmatter).trimEnd();
		return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n`;
	}
}
