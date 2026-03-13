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
				'formify_read_text_file',
				'formify_read_media_file',
				'formify_edit_file',
				'formify_list_allowed_directories',
				'formify_open_file',
				'formify_get_first_link_path',
				'formify_delete_file',
				'formify_search_content',
				'formify_query_vault',
			])
		);

		const textFileResult = parseJson<{
			path: string;
			content: string;
			truncated: boolean;
		}>(
			await runtime.callTool('formify_read_text_file', { path: 'notes/alpha.md' })
		);
		expect(textFileResult).toMatchObject({
			path: 'notes/alpha.md',
			content: '# Alpha\nBody',
			truncated: false,
		});

		expect(
			parseJson<{ directories: string[]; scope: string }>(
				await runtime.callTool('formify_list_allowed_directories', {})
			)
		).toEqual({
			directories: ['/'],
			scope: 'vault-root',
		});

		const mediaResult = await runtime.callTool('formify_read_media_file', {
			path: 'assets/logo.png',
		});
		expect(mediaResult).toContain('"type": "image"');
		expect(mediaResult).toContain('"mimeType": "image/png"');

		const editResult = parseJson<{
			diff: string;
			dryRun: boolean;
			updated: boolean;
		}>(
			await runtime.callTool('formify_edit_file', {
				path: 'notes/alpha.md',
				edits: [{ oldText: 'Body', newText: 'Updated body' }],
				dryRun: true,
			})
		);
		expect(editResult.diff).toContain('Updated body');
		expect(editResult.updated).toBe(false);
		expect(app.vault.modify).not.toHaveBeenCalled();

		const openResult = parseJson<{ path: string; opened: boolean }>(
			await runtime.callTool('formify_open_file', { path: 'notes/alpha.md' })
		);
		expect(openResult).toMatchObject({
			path: 'notes/alpha.md',
			opened: true,
		});
		expect(app.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'notes/alpha.md' })
		);

		expect(
			parseJson<{
				internalLink: string;
				sourcePath: string;
				resolvedPath: string | null;
				found: boolean;
			}>(
				await runtime.callTool('formify_get_first_link_path', {
					internalLink: 'notes/alpha',
				})
			)
		).toEqual({
			internalLink: 'notes/alpha',
			sourcePath: '',
			resolvedPath: 'notes/alpha.md',
			found: true,
		});

		await runtime.close();
	});

	it('should filter formify_list_directory results by regex and keep text mode', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');
		app.addFile('notes/beta.txt', 'Beta');
		app.addFile('notes/gamma.md', '# Gamma');

		const runtime = await createFilesystemBuiltinRuntime(app);

		expect(
			await runtime.callTool('formify_list_directory', {
				path: 'notes',
				regex: '\\.md$',
				response_format: 'text',
			})
		).toBe('[FILE] alpha.md\n[FILE] gamma.md');

		const jsonResult = parseJson<{
			items: Array<{ name: string }>;
			meta: { returned: number; truncated: boolean };
		}>(
			await runtime.callTool('formify_list_directory', {
				path: 'notes',
				regex: '\\.md$',
			})
		);
		expect(jsonResult.items.map((item) => item.name)).toEqual(['alpha.md', 'gamma.md']);
		expect(jsonResult.meta).toMatchObject({
			returned: 2,
			truncated: false,
		});

		const error = await runtime.callTool('formify_list_directory', {
			path: 'notes',
			regex: '(',
		});
		expect(error).toContain('[工具执行错误]');
		expect(error).toContain('非法正则表达式');

		await runtime.close();
	});

	it('should cap formify_search_files results and return truncation metadata', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');
		app.addFile('notes/beta.md', '# Beta');
		app.addFile('notes/gamma.md', '# Gamma');
		app.addFile('notes/keep.txt', 'Keep');

		const runtime = await createFilesystemBuiltinRuntime(app);
		const result = parseJson<{
			matches: string[];
			meta: { truncated: boolean; returned: number; totalBeforeLimit: number };
		}>(
			await runtime.callTool('formify_search_files', {
				path: 'notes',
				pattern: '*.md',
				excludePatterns: ['gamma.md'],
				maxResults: 1,
			})
		);

		expect(result.matches).toEqual(['notes/alpha.md']);
		expect(result.meta).toMatchObject({
			truncated: true,
			returned: 1,
			totalBeforeLimit: 2,
		});

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
				await runtime.callTool('formify_delete_file', { path: 'notes/alpha.md' })
			)
		).toMatchObject({ deleted: true, existed: true });
		expect(app.hasPath('notes/alpha.md')).toBe(false);

		expect(
			parseJson<{ deleted: boolean; existed: boolean }>(
				await runtime.callTool('formify_delete_file', { path: 'trash', force: true })
			)
		).toMatchObject({ deleted: true, existed: true });
		expect(app.hasPath('trash')).toBe(false);
		expect(app.hasPath('trash/nested/one.md')).toBe(false);

		expect(
			parseJson<{ deleted: boolean; existed: boolean }>(
				await runtime.callTool('formify_delete_file', { path: 'missing.md' })
			)
		).toMatchObject({ deleted: false, existed: false });

		expect(await runtime.callTool('formify_delete_file', { path: '/' })).toContain(
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
				hasMore: boolean;
				scannedFiles: number;
				skippedFiles: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('formify_search_content', {
				pattern: 'hello',
				path: 'notes',
				fileType: 'md',
				contextLines: 1,
				maxResults: 2,
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
		expect(markdownResult.meta.hasMore).toBe(true);

		const tsResult = parseJson<{
			matches: Array<{ path: string }>;
			meta: {
				truncated: boolean;
				skippedFiles: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('formify_search_content', {
				pattern: 'HELLO',
				path: 'notes',
				fileType: 'ts,tsx',
				caseSensitive: true,
				maxResults: 5,
			})
		);

		expect(tsResult.matches).toHaveLength(0);
		expect(tsResult.meta.truncated).toBe(false);

		const allResult = parseJson<{
			meta: {
				skippedFiles: Array<{ path: string; reason: string }>;
			};
		}>(
			await runtime.callTool('formify_search_content', {
				pattern: 'Alpha',
				path: 'notes',
			})
		);
		expect(allResult.meta.skippedFiles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'notes/image.png' }),
				expect.objectContaining({ path: 'notes/large.md' }),
			])
		);

		await runtime.close();
	});

	it('should query vault data sources with filtering, grouping, and pagination', async () => {
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
			rows: Array<{ extension: string; total: number; avgSize: number; totalSize: number }>;
		}>(
			await runtime.callTool('formify_query_vault', {
				expression:
					'select(extension, count() as total, avg(size) as avgSize, sum(size) as totalSize).from(file).where(size >= 0).andGroup(size >= 80).orGroup(name == "alpha.md").groupBy(extension).orderBy(extension)',
			})
		);
		expect(fileRows.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ extension: 'md', total: 2 }),
				expect.objectContaining({ extension: 'ts', total: 1 }),
			])
		);

		const propertyRows = parseJson<{
			rows: Array<{ name: string; usageCount: number }>;
		}>(
			await runtime.callTool('formify_query_vault', {
				expression:
					'select(name, usageCount).from(property).where(usageCount > 0).orderBy(name)',
			})
		);
		expect(propertyRows.rows).toEqual([
			{ name: 'done', usageCount: 2 },
			{ name: 'status', usageCount: 2 },
		]);

		const tagRows = parseJson<{
			rows: Array<{ tag: string; count: number; fileCount: number }>;
			meta: { totalBeforeLimit: number; returned: number; truncated: boolean };
		}>(
			await runtime.callTool('formify_query_vault', {
				expression:
					'select(tag, count, fileCount).from(tag).orderBy(tag).limit(1).offset(1)',
			})
		);
		expect(tagRows.rows).toHaveLength(1);
		expect(tagRows.meta).toMatchObject({
			totalBeforeLimit: 2,
			returned: 1,
			truncated: false,
		});

		const taskRows = parseJson<{
			rows: Array<{ filePath: string; completed: boolean; priority: string | null }>;
		}>(
			await runtime.callTool('formify_query_vault', {
				expression:
					'select(filePath, completed, priority).from(task).where(completed == true || priority == "high").orderBy(filePath)',
			})
		);
		expect(taskRows.rows).toEqual([
			{ filePath: 'notes/alpha.md', completed: false, priority: 'high' },
			{ filePath: 'notes/beta.md', completed: true, priority: 'highest' },
		]);

		await runtime.close();
	});

	it('should return clear formify_query_vault errors for invalid expressions', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha');

		const runtime = await createFilesystemBuiltinRuntime(app);

		expect(
			await runtime.callTool('formify_query_vault', {
				expression: 'select(path).from(unknown)',
			})
		).toContain('[工具执行错误]');
		expect(
			await runtime.callTool('formify_query_vault', {
				expression: 'select(missingField).from(file)',
			})
		).toContain('未知字段');
		expect(
			await runtime.callTool('formify_query_vault', {
				expression: 'from(file)',
			})
		).toContain('select');

		await runtime.close();
	});
});
