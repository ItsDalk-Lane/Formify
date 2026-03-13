import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { createFilesystemBuiltinRuntime } from './filesystem-mcp-server';

type MockFileStat = {
	size: number;
	ctime: number;
	mtime: number;
};

type MockCachedMetadata = {
	frontmatter?: Record<string, unknown>;
	tags?: Array<{ tag: string }>;
	listItems?: Array<{
		task?: string;
		parent: number;
		position?: { start?: { line?: number } };
	}>;
};

type MockPropertyDefinition = Record<
	string,
	{
		name: string;
		type?: string;
		widget?: string;
	}
>;

const createMockFile = (
	path: string,
	content: string,
	options?: Partial<MockFileStat>
): TFile & {
	stat: MockFileStat;
} => {
	const file = Object.create(TFile.prototype) as TFile & {
		path: string;
		name: string;
		basename: string;
		extension: string;
		stat: MockFileStat;
		parent?: TFolder;
	};
	const name = path.split('/').pop() ?? path;
	const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
	file.path = path;
	file.name = name;
	file.basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	file.extension = extension;
	file.stat = {
		size: options?.size ?? content.length,
		ctime: options?.ctime ?? 1,
		mtime: options?.mtime ?? 1,
	};
	return file;
};

const createMockFolder = (path: string): TFolder & { children: Array<TFile | TFolder> } => {
	const folder = Object.create(TFolder.prototype) as TFolder & {
		path: string;
		name: string;
		children: Array<TFile | TFolder>;
		parent?: TFolder;
	};
	folder.path = path;
	folder.name = path.split('/').pop() ?? '';
	folder.children = [];
	return folder;
};

class MockApp {
	private readonly root = createMockFolder('');
	private readonly entries = new Map<string, TFile | TFolder>();
	private readonly textContents = new Map<string, string>();
	private readonly binaryContents = new Map<string, ArrayBuffer>();
	private readonly metadataContents = new Map<string, MockCachedMetadata>();
	private propertyDefinitions: MockPropertyDefinition = {};

	readonly openFile = jest.fn(async () => undefined);

	workspace = {
		getLeaf: jest.fn(() => ({ openFile: this.openFile })),
		getActiveFile: jest.fn(() => null),
	};

	metadataCache = {
		getFirstLinkpathDest: jest.fn((link: string) => {
			return this.entries.get(`${link}.md`) ?? this.entries.get(link) ?? null;
		}),
		getFileCache: jest.fn((file: TFile) => {
			return this.metadataContents.get(file.path) ?? null;
		}),
		getCache: jest.fn((path: string) => {
			return this.metadataContents.get(path) ?? null;
		}),
	};

	metadataTypeManager = {
		getAllProperties: jest.fn(() => this.propertyDefinitions),
	};

	vault = {
		getRoot: jest.fn(() => this.root),
		getFiles: jest.fn(() => {
			return Array.from(this.entries.values()).filter((entry): entry is TFile => entry instanceof TFile);
		}),
		getAbstractFileByPath: jest.fn((path: string) => {
			if (!path) return this.root;
			return this.entries.get(path) ?? null;
		}),
		cachedRead: jest.fn(async (file: TFile) => this.textContents.get(file.path) ?? ''),
		readBinary: jest.fn(async (file: TFile) => this.binaryContents.get(file.path) ?? new ArrayBuffer(0)),
		modify: jest.fn(async (file: TFile, content: string) => {
			this.textContents.set(file.path, content);
			(file as any).stat.size = content.length;
		}),
		create: jest.fn(async (path: string, content: string) => {
			this.addFile(path, content);
		}),
		createFolder: jest.fn(async (path: string) => {
			this.ensureFolder(path);
		}),
		rename: jest.fn(async () => undefined),
		delete: jest.fn(async (target: TAbstractFile, force?: boolean) => {
			this.deleteEntry(target, Boolean(force));
		}),
		adapter: {
			stat: jest.fn(async (path: string) => {
				const entry = path ? this.entries.get(path) : this.root;
				if (!entry) return null;
				if (entry instanceof TFile) {
					return {
						type: 'file',
						size: (entry as any).stat.size,
						ctime: (entry as any).stat.ctime,
						mtime: (entry as any).stat.mtime,
					};
				}
				return {
					type: 'folder',
					size: 0,
					ctime: 0,
					mtime: 0,
				};
			}),
		},
	};

	constructor() {
		this.entries.set('', this.root);
	}

	setProperties(definitions: MockPropertyDefinition): void {
		this.propertyDefinitions = definitions;
	}

	setCachedMetadata(path: string, metadata: MockCachedMetadata): void {
		this.metadataContents.set(path, metadata);
	}

	addFile(
		path: string,
		content: string,
		options?: {
			binary?: ArrayBuffer;
			stat?: Partial<MockFileStat>;
			metadata?: MockCachedMetadata;
		}
	): void {
		const folderPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		const parent = this.ensureFolder(folderPath);
		const file = createMockFile(path, content, options?.stat);
		(file as any).parent = parent;
		parent.children.push(file);
		this.entries.set(path, file);
		this.textContents.set(path, content);
		if (options?.binary) {
			this.binaryContents.set(path, options.binary);
		}
		if (options?.metadata) {
			this.metadataContents.set(path, options.metadata);
		}
	}

	hasPath(path: string): boolean {
		return this.entries.has(path);
	}

	private ensureFolder(path: string): TFolder & { children: Array<TFile | TFolder> } {
		if (!path) return this.root;
		const existing = this.entries.get(path);
		if (existing instanceof TFolder) {
			return existing as TFolder & { children: Array<TFile | TFolder> };
		}

		const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		const parent = this.ensureFolder(parentPath);
		const folder = createMockFolder(path);
		(folder as any).parent = parent;
		parent.children.push(folder);
		this.entries.set(path, folder);
		return folder;
	}

	private removeFromParent(target: TAbstractFile): void {
		const parent = (target as any).parent as (TFolder & { children: Array<TFile | TFolder> }) | undefined;
		if (!parent) return;
		parent.children = parent.children.filter((child) => child !== target);
	}

	private deleteEntry(target: TAbstractFile, force: boolean): void {
		if (target instanceof TFolder) {
			if (!force && target.children.length > 0) {
				throw new Error('文件夹非空，无法删除');
			}
			for (const child of [...target.children]) {
				this.deleteEntry(child, force);
			}
		}
		this.removeFromParent(target);
		this.entries.delete(target.path);
		this.textContents.delete(target.path);
		this.binaryContents.delete(target.path);
		this.metadataContents.delete(target.path);
	}
}

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

describe('createFilesystemBuiltinRuntime', () => {
	it('should expose renamed filesystem tools and support JSON-first navigation helpers', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha\nBody');
		app.addFile(
			'assets/logo.png',
			'',
			{ binary: new Uint8Array([1, 2, 3]).buffer }
		);

		const runtime = await createFilesystemBuiltinRuntime(app);
		const tools = await runtime.listTools();

		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining([
				'read_file',
				'read_media',
				'edit_file',
				'find_paths',
				'list_directory',
				'open_file',
				'delete_path',
				'search_content',
				'query_index',
			])
		);
		expect(tools.find((tool) => tool.name === 'find_paths')?.description).toContain('不要在什么场景用');
		expect(tools.find((tool) => tool.name === 'query_index')?.description).toContain('不要用于发现未知路径');
		expect(
			(tools.find((tool) => tool.name === 'read_file')?.inputSchema as { properties?: Record<string, unknown> })?.properties
		).toEqual(expect.objectContaining({
			file_path: expect.any(Object),
			read_mode: expect.any(Object),
		}));
		expect(
			(tools.find((tool) => tool.name === 'list_directory')?.inputSchema as { properties?: Record<string, unknown> })?.properties
		).toEqual(expect.objectContaining({
			directory_path: expect.any(Object),
			view: expect.any(Object),
		}));

		const textFileResult = parseJson<{
			file_path: string;
			read_mode: string;
			content: string;
			truncated: boolean;
			total_lines: number;
			has_more: boolean;
		}>(
			await runtime.callTool('read_file', { file_path: 'notes/alpha.md', read_mode: 'full' })
		);
		expect(textFileResult).toMatchObject({
			file_path: 'notes/alpha.md',
			read_mode: 'full',
			content: '# Alpha\nBody',
			truncated: false,
			total_lines: 2,
			has_more: false,
		});

		const mediaResult = await runtime.callTool('read_media', {
			file_path: 'assets/logo.png',
		});
		expect(mediaResult).toContain('"type": "image"');
		expect(mediaResult).toContain('"mimeType": "image/png"');

		const editResult = parseJson<{
			diff: string;
			dry_run: boolean;
			updated: boolean;
		}>(
			await runtime.callTool('edit_file', {
				file_path: 'notes/alpha.md',
				edits: [{ oldText: 'Body', newText: 'Updated body' }],
				dry_run: true,
			})
		);
		expect(editResult.diff).toContain('Updated body');
		expect(editResult.updated).toBe(false);
		expect(app.vault.modify).not.toHaveBeenCalled();

		const openResult = parseJson<{ file_path: string; opened: boolean }>(
			await runtime.callTool('open_file', { file_path: 'notes/alpha.md' })
		);
		expect(openResult).toMatchObject({
			file_path: 'notes/alpha.md',
			opened: true,
		});
		expect(app.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'notes/alpha.md' })
		);

		await runtime.close();
	});

	it('should filter list_directory flat results by regex and keep text mode', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');
		app.addFile('notes/beta.txt', 'Beta');
		app.addFile('notes/gamma.md', '# Gamma');

		const runtime = await createFilesystemBuiltinRuntime(app);

		expect(
			await runtime.callTool('list_directory', {
				directory_path: 'notes',
				regex: '\\.md$',
				response_format: 'text',
			})
		).toBe('[FILE] alpha.md\n[FILE] gamma.md');

		const jsonResult = parseJson<{
			items: Array<{ name: string }>;
			meta: { returned: number; truncated: boolean };
		}>(
			await runtime.callTool('list_directory', {
				directory_path: 'notes',
				regex: '\\.md$',
			})
		);
		expect(jsonResult.items.map((item) => item.name)).toEqual(['alpha.md', 'gamma.md']);
		expect(jsonResult.meta).toMatchObject({
			returned: 2,
			truncated: false,
		});

		const error = await runtime.callTool('list_directory', {
			directory_path: 'notes',
			regex: '(',
		});
		expect(error).toContain('[工具执行错误]');
		expect(error).toContain('非法正则表达式');

		await runtime.close();
	});

	it('should support list_directory tree and size views', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha', { stat: { size: 7 } });
		app.addFile('notes/nested/beta.md', '# Beta', { stat: { size: 20 } });
		app.addFile('notes/nested/gamma.txt', 'Gamma', { stat: { size: 5 } });

		const runtime = await createFilesystemBuiltinRuntime(app);

		const sized = parseJson<{
			items: Array<{ name: string; sizeText: string | null }>;
			summary: { totalFiles: number; totalDirs: number };
		}>(
			await runtime.callTool('list_directory', {
				directory_path: 'notes',
				include_sizes: true,
				sort_by: 'size',
			})
		);
		expect(sized.items[0]).toMatchObject({ name: 'alpha.md', sizeText: '7 B' });
		expect(sized.summary).toMatchObject({ totalFiles: 1, totalDirs: 1 });

		const tree = parseJson<{
			view: string;
			tree: Array<{ name: string; type: string; children?: Array<{ name: string }> }>;
		}>(
			await runtime.callTool('list_directory', {
				directory_path: 'notes',
				view: 'tree',
				max_depth: 3,
				max_nodes: 20,
			})
		);
		expect(tree.view).toBe('tree');
		expect(tree.tree).toEqual([
			{ name: 'alpha.md', type: 'file' },
			{
				name: 'nested',
				type: 'directory',
				children: expect.arrayContaining([
					expect.objectContaining({ name: 'beta.md', type: 'file' }),
					expect.objectContaining({ name: 'gamma.txt', type: 'file' }),
				]),
			},
		]);

		await runtime.close();
	});

	it('should paginate read_file segments and suggest the next call for long content', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/long.md', 'line 1\nline 2\nline 3\nline 4\nline 5');

		const runtime = await createFilesystemBuiltinRuntime(app);

		const firstSegment = parseJson<{
			file_path: string;
			read_mode: string;
			content: string;
			returned_start_line: number;
			returned_end_line: number;
			has_more: boolean;
			next_start_line: number | null;
			suggested_next_call: { tool_name: string; args: { start_line: number; line_count: number } } | null;
		}>(
			await runtime.callTool('read_file', {
				file_path: 'notes/long.md',
				read_mode: 'segment',
				start_line: 1,
				line_count: 2,
			})
		);

		expect(firstSegment).toMatchObject({
			file_path: 'notes/long.md',
			read_mode: 'segment',
			content: 'line 1\nline 2',
			returned_start_line: 1,
			returned_end_line: 2,
			has_more: true,
			next_start_line: 3,
		});
		expect(firstSegment.suggested_next_call).toEqual({
			tool_name: 'read_file',
			args: {
				file_path: 'notes/long.md',
				read_mode: 'segment',
				start_line: 3,
				line_count: 2,
			},
		});

		const secondSegment = parseJson<{
			content: string;
			returned_start_line: number;
			returned_end_line: number;
			has_more: boolean;
			next_start_line: number | null;
		}>(
			await runtime.callTool('read_file', {
				file_path: 'notes/long.md',
				read_mode: 'segment',
				start_line: 3,
				line_count: 2,
			})
		);

		expect(secondSegment).toMatchObject({
			content: 'line 3\nline 4',
			returned_start_line: 3,
			returned_end_line: 4,
			has_more: true,
			next_start_line: 5,
		});

		const oversizedApp = new MockApp() as any;
		oversizedApp.addFile(
			'notes/huge.md',
			'x'.repeat(25_000)
		);
		const oversizedRuntime = await createFilesystemBuiltinRuntime(oversizedApp);
		const fullReadFallback = parseJson<{
			content: string;
			truncated: boolean;
			has_more: boolean;
			warning: string | null;
			suggested_next_call: { tool_name: string; args: { file_path: string; read_mode: string } } | null;
		}>(
			await oversizedRuntime.callTool('read_file', {
				file_path: 'notes/huge.md',
				read_mode: 'full',
			})
		);
		expect(fullReadFallback.content).toBe('');
		expect(fullReadFallback.truncated).toBe(true);
		expect(fullReadFallback.has_more).toBe(true);
		expect(fullReadFallback.warning).toContain('请改用 segment 模式');
		expect(fullReadFallback.suggested_next_call).toMatchObject({
			tool_name: 'read_file',
			args: {
				file_path: 'notes/huge.md',
				read_mode: 'segment',
			},
		});

		await oversizedRuntime.close();
		await runtime.close();
	});

	it('should find paths by name fragments and scope path', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');
		app.addFile('notes/beta.md', '# Beta');
		app.addFile('notes/gamma.md', '# Gamma');
		app.addFile('notes/archive/todo.md', 'todo');
		app.addFile('notes/keep.txt', 'Keep');

		const runtime = await createFilesystemBuiltinRuntime(app);
		const result = parseJson<{
			matches: Array<{ path: string; type: string; matched_on: string }>;
			meta: { truncated: boolean; returned: number; total_before_limit: number };
		}>(
			await runtime.callTool('find_paths', {
				query: 'a',
				scope_path: 'notes',
				target_type: 'file',
				max_results: 2,
			})
		);

		expect(result.matches.map((match) => match.path)).toEqual([
			'notes/alpha.md',
			'notes/beta.md',
		]);
		expect(result.meta).toMatchObject({
			truncated: true,
			returned: 2,
			total_before_limit: 4,
		});

		const directoryResult = parseJson<{
			matches: Array<{ path: string; type: string }>;
		}>(
			await runtime.callTool('find_paths', {
				query: 'archive',
				scope_path: 'notes',
				target_type: 'directory',
				match_mode: 'exact',
			})
		);
		expect(directoryResult.matches).toEqual([
			{ path: 'notes/archive', name: 'archive', type: 'directory', matched_on: 'name' },
		]);

		await runtime.close();
	});

	it('should delete files and folders while handling missing or invalid targets', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');
		app.addFile('trash/nested/one.md', '1');
		app.addFile('trash/nested/two.md', '2');

		const runtime = await createFilesystemBuiltinRuntime(app);

		expect(
			parseJson<{ deleted: boolean; existed: boolean }>(
				await runtime.callTool('delete_path', { target_path: 'notes/alpha.md' })
			)
		).toMatchObject({ deleted: true, existed: true });
		expect(app.hasPath('notes/alpha.md')).toBe(false);

		expect(
			parseJson<{ deleted: boolean; existed: boolean }>(
				await runtime.callTool('delete_path', { target_path: 'trash', force: true })
			)
		).toMatchObject({ deleted: true, existed: true });
		expect(app.hasPath('trash')).toBe(false);
		expect(app.hasPath('trash/nested/one.md')).toBe(false);

		expect(
			parseJson<{ deleted: boolean; existed: boolean }>(
				await runtime.callTool('delete_path', { target_path: 'missing.md' })
			)
		).toMatchObject({ deleted: false, existed: false });

		expect(await runtime.callTool('delete_path', { target_path: '/' })).toContain(
			'[工具执行错误] 不允许删除 Vault 根目录'
		);

		await runtime.close();
	});

	it('should search file content with filters, context, truncation, and skipped files', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', 'hello world\nAlpha line\nHELLO again');
		app.addFile('notes/code.ts', 'const hello = 1;\nconsole.log(hello);');
		app.addFile('notes/image.png', '', {
			binary: new Uint8Array([1, 2, 3]).buffer,
		});
		app.addFile('notes/large.md', 'stub', {
			stat: { size: 2 * 1024 * 1024 + 10 },
		});

		const runtime = await createFilesystemBuiltinRuntime(app);

		const markdownResult = parseJson<{
			matches: Array<{
				path: string;
				line: number;
				text: string;
				before: Array<{ line: number; text: string }>;
				after: Array<{ line: number; text: string }>;
			}>;
			meta: {
				truncated: boolean;
				has_more: boolean;
				scanned_files: number;
				skipped_files: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('search_content', {
				pattern: 'hello',
				scope_path: 'notes',
				file_types: ['md'],
				context_lines: 1,
				max_results: 2,
			})
		);

		expect(markdownResult.matches).toHaveLength(2);
		expect(markdownResult.matches[0]).toMatchObject({
			path: 'notes/alpha.md',
			line: 1,
			text: 'hello world',
		});
		expect(markdownResult.matches[0].after).toEqual([
			{ line: 2, text: 'Alpha line' },
		]);
		expect(markdownResult.meta.truncated).toBe(true);
		expect(markdownResult.meta.has_more).toBe(true);

		const tsResult = parseJson<{
			matches: Array<{ path: string }>;
			meta: {
				truncated: boolean;
				skipped_files: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('search_content', {
				pattern: 'HELLO',
				scope_path: 'notes',
				file_types: ['ts', 'tsx'],
				case_sensitive: true,
				max_results: 5,
			})
		);

		expect(tsResult.matches).toHaveLength(0);
		expect(tsResult.meta.truncated).toBe(false);

		const allResult = parseJson<{
			meta: {
				skipped_files: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('search_content', {
				pattern: 'Alpha',
				scope_path: 'notes',
			})
		);
		expect(allResult.meta.skipped_files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'notes/image.png' }),
				expect.objectContaining({ path: 'notes/large.md' }),
			])
		);

		await runtime.close();
	});

	it('should query structured index data sources with filtering, grouping, and pagination', async () => {
		const app = new MockApp() as any;
		app.setProperties({
			status: { name: 'status', type: 'text' },
			done: { name: 'done', widget: 'checkbox' },
		});
		app.addFile('notes/alpha.md', '---\nstatus: open\ndone: false\n---\n- [ ] Task Alpha 🔺', {
			stat: { ctime: 10, mtime: 20 },
			metadata: {
				frontmatter: { status: 'open', done: false },
				tags: [{ tag: '#work' }],
				listItems: [
					{
						task: ' ',
						parent: -1,
						position: { start: { line: 4 } },
					},
				],
			},
		});
		app.addFile('notes/beta.md', '---\nstatus: closed\ndone: true\n---\n- [x] Task Beta ⏫', {
			stat: { ctime: 5, mtime: 15, size: 120 },
			metadata: {
				frontmatter: { status: 'closed', done: true },
				tags: [{ tag: '#work' }, { tag: '#home' }],
				listItems: [
					{
						task: 'x',
						parent: -1,
						position: { start: { line: 4 } },
					},
				],
			},
		});
		app.addFile('scripts/build.ts', 'export const size = 5;', {
			stat: { ctime: 8, mtime: 18, size: 80 },
		});

		const runtime = await createFilesystemBuiltinRuntime(app);

		const fileRows = parseJson<{
			rows: Array<{ extension: string; total: number; avg_size: number; total_size: number }>;
		}>(
			await runtime.callTool('query_index', {
				data_source: 'file',
				select: {
					fields: ['extension'],
					aggregates: [
						{ aggregate: 'count', alias: 'total' },
						{ aggregate: 'avg', field: 'size', alias: 'avg_size' },
						{ aggregate: 'sum', field: 'size', alias: 'total_size' },
					],
				},
				filters: {
					match: 'all',
					conditions: [
						{ field: 'size', operator: 'gte', value: 0 },
					],
				},
				group_by: 'extension',
				order_by: { field: 'extension', direction: 'asc' },
			})
		);
		expect(fileRows.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ extension: 'md', total: 2 }),
				expect.objectContaining({ extension: 'ts', total: 1 }),
			])
		);

		const propertyRows = parseJson<{
			rows: Array<{ name: string; usage_count: number }>;
		}>(
			await runtime.callTool('query_index', {
				data_source: 'property',
				select: {
					fields: ['name', 'usage_count'],
				},
				filters: {
					match: 'all',
					conditions: [{ field: 'usage_count', operator: 'gt', value: 0 }],
				},
				order_by: { field: 'name', direction: 'asc' },
			})
		);
		expect(propertyRows.rows).toEqual([
			{ name: 'done', usage_count: 2 },
			{ name: 'status', usage_count: 2 },
		]);

		const tagRows = parseJson<{
			rows: Array<{ tag: string; count: number; file_count: number }>;
			meta: { total_before_limit: number; returned: number; truncated: boolean };
		}>(
			await runtime.callTool('query_index', {
				data_source: 'tag',
				select: {
					fields: ['tag', 'count', 'file_count'],
				},
				order_by: { field: 'tag', direction: 'asc' },
				limit: 1,
				offset: 1,
			})
		);
		expect(tagRows.rows).toHaveLength(1);
		expect(tagRows.meta).toMatchObject({
			total_before_limit: 2,
			returned: 1,
			truncated: false,
		});

		const taskRows = parseJson<{
			rows: Array<{ file_path: string; completed: boolean; priority: string | null }>;
		}>(
			await runtime.callTool('query_index', {
				data_source: 'task',
				select: {
					fields: ['file_path', 'completed', 'priority'],
				},
				filters: {
					match: 'any',
					conditions: [
						{ field: 'completed', operator: 'eq', value: true },
						{ field: 'priority', operator: 'eq', value: 'high' },
					],
				},
				order_by: { field: 'file_path', direction: 'asc' },
			})
		);
		expect(taskRows.rows).toEqual([
			{ file_path: 'notes/alpha.md', completed: false, priority: 'high' },
			{ file_path: 'notes/beta.md', completed: true, priority: 'highest' },
		]);

		await runtime.close();
	});

	it('should return clear query_index errors for invalid field definitions', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');

		const runtime = await createFilesystemBuiltinRuntime(app);

		expect(
			await runtime.callTool('query_index', {
				data_source: 'file',
				select: {
					fields: ['unknown_field'],
				},
			})
		).toContain('[工具执行错误]');
		expect(
			await runtime.callTool('query_index', {
				data_source: 'file',
				select: {
					fields: [],
					aggregates: [],
				},
			})
		).toContain('select.fields 或 select.aggregates');
		expect(
			await runtime.callTool('query_index', {
				data_source: 'file',
				select: {
					aggregates: [{ aggregate: 'sum' }],
				},
			})
		).toContain('sum 聚合必须提供 field');

		await runtime.close();
	});
});
