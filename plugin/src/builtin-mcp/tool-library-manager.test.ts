import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
} from './constants';
import { ToolLibraryManager } from './tool-library-manager';
import type { ToolLibraryCatalogDefinition } from './tool-library-types';

type VaultEventName = 'create' | 'modify' | 'delete' | 'rename';
type VaultEventRef = {
	event: VaultEventName;
	callback: (...args: any[]) => void;
};

class MockVault {
	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	private readonly listeners = new Map<VaultEventName, Set<(...args: any[]) => void>>([
		['create', new Set()],
		['modify', new Set()],
		['delete', new Set()],
		['rename', new Set()],
	]);

	adapter = {
		exists: jest.fn(async (path: string) => {
			const normalized = this.normalize(path);
			return (
				this.files.has(normalized)
				|| this.folders.has(normalized)
				|| Array.from(this.files.keys()).some((filePath) =>
					filePath.startsWith(`${normalized}/`)
				)
			);
		}),
		list: jest.fn(async (path: string) => {
			const normalized = this.normalize(path);
			return {
				files: Array.from(this.files.keys()).filter((filePath) =>
					filePath.startsWith(`${normalized}/`)
				),
				folders: Array.from(this.folders).filter(
					(folderPath) =>
						folderPath !== normalized && folderPath.startsWith(`${normalized}/`)
				),
			};
		}),
		read: jest.fn(async (path: string) => {
			const normalized = this.normalize(path);
			const content = this.files.get(normalized);
			if (typeof content !== 'string') {
				throw new Error(`missing file: ${normalized}`);
			}
			return content;
		}),
	};

	create = jest.fn(async (path: string, content: string) => {
		const normalized = this.normalize(path);
		this.ensureParentFolders(normalized);
		this.files.set(normalized, content);
		this.emit('create', { path: normalized });
		return { path: normalized };
	});

	modify = jest.fn(async (file: { path: string }, content: string) => {
		const normalized = this.normalize(file.path);
		this.files.set(normalized, content);
		this.emit('modify', { path: normalized });
	});

	on(event: VaultEventName, callback: (...args: any[]) => void): VaultEventRef {
		this.listeners.get(event)?.add(callback);
		return { event, callback };
	}

	offref(ref: VaultEventRef): void {
		this.listeners.get(ref.event)?.delete(ref.callback);
	}

	getAbstractFileByPath(path: string): { path: string } | null {
		const normalized = this.normalize(path);
		if (this.files.has(normalized) || this.folders.has(normalized)) {
			return { path: normalized };
		}
		return null;
	}

	seedFile(path: string, content: string): void {
		const normalized = this.normalize(path);
		this.ensureParentFolders(normalized);
		this.files.set(normalized, content);
	}

	writeExternal(path: string, content: string): void {
		const normalized = this.normalize(path);
		this.ensureParentFolders(normalized);
		this.files.set(normalized, content);
		this.emit('modify', { path: normalized });
	}

	private emit(event: VaultEventName, ...args: any[]): void {
		for (const callback of this.listeners.get(event) ?? []) {
			callback(...args);
		}
	}

	private ensureParentFolders(path: string): void {
		const segments = path.split('/');
		segments.pop();
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			this.folders.add(current);
		}
	}

	private normalize(path: string): string {
		return path.replace(/^\/+|\/+$/g, '');
	}
}

const createCatalog = (
	names: string[]
): ToolLibraryCatalogDefinition[] =>
	names.map((name) => ({
		name,
		description: `${name} description`,
		serverId:
			name === 'search_nodes'
				? BUILTIN_MEMORY_SERVER_ID
				: BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
		serverName:
			name === 'search_nodes'
				? BUILTIN_MEMORY_SERVER_NAME
				: BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: '关键词',
				},
			},
			required: ['query'],
		},
	}));

const waitForReload = async () => {
	await new Promise((resolve) => setTimeout(resolve, 150));
};

describe('ToolLibraryManager', () => {
	it('should parse frontmatter and body into entry metadata', async () => {
		const vault = new MockVault();
		vault.seedFile(
			'library/search_content.md',
			`---
name: search_content
serverId: builtin.obsidian-search
serverName: Obsidian Search
category: search
keywords:
  - 正文搜索
scenarios:
  - 按正文查内容
decisionGuide:
  - 当需要搜正文时使用
capabilities:
  - 只搜索正文内容
parameters:
  - name: query
    type: string
    required: true
    description: 搜索关键词
examples:
  - title: 搜索正文
    summary: 示例
    args:
      query: 发布计划
---
用于在正文内容中搜索关键字。
`
		);

		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI',
			toolCatalogLoader: async () => [],
			ensureStorageFolder: async () => {},
			storagePathFactory: () => 'library',
		});

		await manager.initialize();
		const entry = await manager.getEntry('search_content');

		expect(entry?.metadata.category).toBe('search');
		expect(entry?.metadata.parameters[0]).toEqual({
			name: 'query',
			type: 'string',
			required: true,
			description: '搜索关键词',
		});
		expect(entry?.body).toContain('用于在正文内容中搜索关键字');
	});

	it('should bootstrap only missing markdown files', async () => {
		const vault = new MockVault();
		vault.seedFile(
			'library/quick_search.md',
			`---
name: quick_search
serverId: builtin.obsidian-search
serverName: Obsidian Search
category: search
keywords: [quick]
scenarios: [快速搜索]
decisionGuide: [已有文件不应被覆盖]
capabilities: [quick]
parameters: []
examples: []
---
自定义正文
`
		);

		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI',
			toolCatalogLoader: async () => createCatalog(['quick_search', 'search_content']),
			ensureStorageFolder: async () => {},
			storagePathFactory: () => 'library',
		});

		await manager.initialize();
		const quickSearch = await manager.getEntry('quick_search');
		const searchContent = await manager.getEntry('search_content');

		expect(vault.create).toHaveBeenCalledTimes(1);
		expect(vault.create).toHaveBeenCalledWith(
			'library/search_content.md',
			expect.stringContaining('name: search_content')
		);
		expect(quickSearch?.body).toContain('自定义正文');
		expect(searchContent?.metadata.name).toBe('search_content');
	});

	it('should search case-insensitively and sort by score', async () => {
		const vault = new MockVault();
		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI',
			toolCatalogLoader: async () =>
				createCatalog(['search_tasks', 'search_content', 'quick_search']),
			ensureStorageFolder: async () => {},
			storagePathFactory: () => 'library',
		});

		await manager.initialize();
		const results = await manager.searchTools({
			task: '任务搜索',
			categories: ['SEARCH'],
			limit: 3,
		});

		expect(results).toHaveLength(3);
		expect(results[0].entry.metadata.name).toBe('search_tasks');
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it('should return friendly no-match message when nothing is found', async () => {
		const vault = new MockVault();
		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI',
			toolCatalogLoader: async () => createCatalog(['search_content']),
			ensureStorageFolder: async () => {},
			storagePathFactory: () => 'library',
		});

		await manager.initialize();
		const results = await manager.searchTools({
			task: '完全不存在的独特短语',
		});

		expect(results).toEqual([]);
		expect(manager.formatFindToolResults(results, '完全不存在的独特短语')).toContain('未找到');
	});

	it('should hot reload modified files from the tool-library directory', async () => {
		const vault = new MockVault();
		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI',
			toolCatalogLoader: async () => createCatalog(['search_content']),
			ensureStorageFolder: async () => {},
			storagePathFactory: () => 'library',
			reloadDebounceMs: 50,
		});

		await manager.initialize();
		vault.writeExternal(
			'library/search_content.md',
			`---
name: search_content
serverId: builtin.obsidian-search
serverName: Obsidian Search
category: search
keywords: [正文搜索]
scenarios: [按正文查内容]
decisionGuide: [使用更新后的说明]
capabilities: [只搜索正文内容]
parameters: []
examples: []
---
更新后的正文说明
`
		);

		await waitForReload();
		const entry = await manager.getEntry('search_content');

		expect(entry?.body).toContain('更新后的正文说明');
		expect(entry?.metadata.decisionGuide).toContain('使用更新后的说明');
	});

	it('should rebuild the library when aiDataFolder changes', async () => {
		const vault = new MockVault();
		const manager = new ToolLibraryManager({
			app: { vault } as any,
			aiDataFolder: 'AI-A',
			toolCatalogLoader: async () => createCatalog(['search_content']),
			ensureStorageFolder: async () => {},
			storagePathFactory: (folder) => `${folder}/tool-library`,
		});

		await manager.initialize();
		await manager.updateAiDataFolder('AI-B');
		const entries = await manager.listEntries();

		expect(vault.create).toHaveBeenCalledWith(
			'AI-B/tool-library/search_content.md',
			expect.any(String)
		);
		expect(entries[0]?.filePath).toContain('AI-B/tool-library');
	});
});
