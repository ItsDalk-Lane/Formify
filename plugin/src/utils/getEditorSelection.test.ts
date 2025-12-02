import { App, TFile, MarkdownView } from 'obsidian';
import { getCurrentFileContent } from './getEditorSelection';

// 模拟App类
class MockApp {
	workspace = {
		getActiveViewOfType: jest.fn()
	};
	vault = {
		cachedRead: jest.fn(),
		read: jest.fn()
	};
}

// 模拟TFile类
class MockTFile {
	constructor(
		public path: string,
		public name: string,
		public extension: string
	) {}
}

// 模拟MarkdownView类
class MockMarkdownView {
	constructor(
		public file: TFile
	) {}
}

describe('getCurrentFileContent', () => {
	let mockApp: App;
	let mockFile: TFile;
	let mockView: MarkdownView;

	beforeEach(() => {
		mockApp = new MockApp() as any;
		mockFile = new MockTFile('test.md', 'test.md', 'md') as any;
		mockView = new MockMarkdownView(mockFile) as any;
		
		// 设置默认返回值
		(mockApp.workspace.getActiveViewOfType as jest.Mock).mockReturnValue(mockView);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue('---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).');
	});

	it('should return file content without metadata by default', async () => {
		const result = await getCurrentFileContent(mockApp);
		
		expect(result).toBe('# Test File\nThis is a **test** file with [link](http://example.com).');
		expect(mockApp.workspace.getActiveViewOfType).toHaveBeenCalledWith(MarkdownView);
		expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockFile);
	});

	it('should return file content with metadata when includeMetadata is true', async () => {
		const result = await getCurrentFileContent(mockApp, { includeMetadata: true });
		
		expect(result).toBe('---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).');
	});

	it('should return plain text content when plainText is true', async () => {
		const result = await getCurrentFileContent(mockApp, { plainText: true });
		
		expect(result).toBe('# Test File\nThis is a test file with link.');
	});

	it('should return plain text content with metadata when both options are true', async () => {
		const result = await getCurrentFileContent(mockApp, { includeMetadata: true, plainText: true });
		
		expect(result).toBe('title: Test\n# Test File\nThis is a test file with link.');
	});

	it('should return empty string when no active view', async () => {
		(mockApp.workspace.getActiveViewOfType as jest.Mock).mockReturnValue(null);
		
		const result = await getCurrentFileContent(mockApp);
		
		expect(result).toBe('');
	});

	it('should return empty string when file is not markdown', async () => {
		const nonMdFile = new MockTFile('test.txt', 'test.txt', 'txt') as any;
		const nonMdView = new MockMarkdownView(nonMdFile) as any;
		(mockApp.workspace.getActiveViewOfType as jest.Mock).mockReturnValue(nonMdView);
		
		const result = await getCurrentFileContent(mockApp);
		
		expect(result).toBe('');
	});

	it('should handle read errors gracefully', async () => {
		(mockApp.vault.cachedRead as jest.Mock).mockRejectedValue(new Error('Read error'));
		
		const result = await getCurrentFileContent(mockApp);
		
		expect(result).toBe('');
	});
});

