import { TFile, TFolder } from 'obsidian';
import { createFilesystemBuiltinRuntime } from './filesystem-mcp-server';

const createMockFile = (path: string, content: string): TFile & {
	stat: { size: number; ctime: number; mtime: number };
} => {
	const file = Object.create(TFile.prototype) as TFile & {
		path: string;
		name: string;
		basename: string;
		extension: string;
		stat: { size: number; ctime: number; mtime: number };
		parent?: TFolder;
	};
	const name = path.split('/').pop() ?? path;
	const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
	file.path = path;
	file.name = name;
	file.basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	file.extension = extension;
	file.stat = {
		size: content.length,
		ctime: 1,
		mtime: 1,
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

	readonly openFile = jest.fn(async () => undefined);

	workspace = {
		getLeaf: jest.fn(() => ({ openFile: this.openFile })),
		getActiveFile: jest.fn(() => null),
	};

	metadataCache = {
		getFirstLinkpathDest: jest.fn((link: string) => {
			return this.entries.get(`${link}.md`) ?? this.entries.get(link) ?? null;
		}),
	};

	vault = {
		getRoot: jest.fn(() => this.root),
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

	addFile(path: string, content: string, binary?: ArrayBuffer): void {
		const folderPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		const parent = this.ensureFolder(folderPath);
		const file = createMockFile(path, content);
		(file as any).parent = parent;
		parent.children.push(file);
		this.entries.set(path, file);
		this.textContents.set(path, content);
		if (binary) {
			this.binaryContents.set(path, binary);
		}
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
}

describe('createFilesystemBuiltinRuntime', () => {
	it('should expose filesystem tools and support navigation/media helpers', async () => {
		const app = new MockApp() as any;
		app.addFile('notes/alpha.md', '# Alpha\nBody');
		app.addFile(
			'assets/logo.png',
			'',
			new Uint8Array([1, 2, 3]).buffer
		);

		const runtime = await createFilesystemBuiltinRuntime(app);
		const tools = await runtime.listTools();

		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining([
				'read_text_file',
				'read_media_file',
				'edit_file',
				'list_allowed_directories',
				'open_file',
				'get_first_link_path',
			])
		);

		expect(await runtime.callTool('read_text_file', { path: 'notes/alpha.md' })).toBe(
			'# Alpha\nBody'
		);
		expect(
			await runtime.callTool('list_allowed_directories', {})
		).toBe('Allowed directories:\n/');

		const mediaResult = await runtime.callTool('read_media_file', {
			path: 'assets/logo.png',
		});
		expect(mediaResult).toContain('"type": "image"');
		expect(mediaResult).toContain('"mimeType": "image/png"');

		const diff = await runtime.callTool('edit_file', {
			path: 'notes/alpha.md',
			edits: [{ oldText: 'Body', newText: 'Updated body' }],
			dryRun: true,
		});
		expect(diff).toContain('Updated body');
		expect(app.vault.modify).not.toHaveBeenCalled();

		await runtime.callTool('open_file', { path: 'notes/alpha.md' });
		expect(app.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'notes/alpha.md' })
		);

		expect(
			await runtime.callTool('get_first_link_path', { internalLink: 'notes/alpha' })
		).toBe('notes/alpha.md');

		await runtime.close();
	});
});
