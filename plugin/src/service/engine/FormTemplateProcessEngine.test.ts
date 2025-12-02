import { FormState } from "../FormState";
import { App, TFile, MarkdownView } from "obsidian";
import { FormTemplateProcessEngine } from "./FormTemplateProcessEngine";
import { getCurrentFileContent } from "src/utils/getEditorSelection";

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

// 模拟FormState类
class MockFormState {
	constructor(
		public values: Record<string, any> = {},
		public idValues: Record<string, any> = {}
	) {}
}

// 模拟navigator.clipboard
const mockClipboard = {
	readText: jest.fn()
};

// 设置全局模拟
Object.defineProperty(global, 'navigator', {
	value: { clipboard: mockClipboard },
	writable: true
});

describe('FormTemplateProcessEngine', () => {
	let engine: FormTemplateProcessEngine;
	let mockApp: App;
	let mockFile: TFile;
	let mockView: MarkdownView;
	let mockState: FormState;

	beforeEach(() => {
		engine = new FormTemplateProcessEngine();
		mockApp = new MockApp() as any;
		mockFile = new MockTFile('test.md', 'test.md', 'md') as any;
		mockView = new MockMarkdownView(mockFile) as any;
		mockState = new MockFormState() as any;
		
		// 设置默认返回值
		(mockApp.workspace.getActiveViewOfType as jest.Mock).mockReturnValue(mockView);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue('---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).');
		mockClipboard.readText.mockResolvedValue('clipboard content');
		
		// 模拟getCurrentFileContent函数
		jest.mock('src/utils/getEditorSelection', () => ({
			getCurrentFileContent: jest.fn().mockImplementation((app, options) => {
				if (options?.includeMetadata && options?.plainText) {
					return Promise.resolve('title: Test\n# Test File\nThis is a test file with link.');
				} else if (options?.includeMetadata) {
					return Promise.resolve('---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).');
				} else if (options?.plainText) {
					return Promise.resolve('# Test File\nThis is a test file with link.');
				} else {
					return Promise.resolve('# Test File\nThis is a **test** file with [link](http://example.com).');
				}
			})
		}));
	});

	it('should replace {{currentFile}} with file content without metadata', async () => {
		const template = 'File content: {{currentFile}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('File content: # Test File\nThis is a **test** file with [link](http://example.com).');
	});

	it('should replace {{currentFile:metadata}} with file content including metadata', async () => {
		const template = 'File content: {{currentFile:metadata}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('File content: ---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).');
	});

	it('should replace {{currentFile:plain}} with plain text content', async () => {
		const template = 'File content: {{currentFile:plain}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('File content: # Test File\nThis is a test file with link.');
	});

	it('should replace {{currentFile:metadata:plain}} with plain text content including metadata', async () => {
		const template = 'File content: {{currentFile:metadata:plain}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('File content: title: Test\n# Test File\nThis is a test file with link.');
	});

	it('should handle multiple currentFile variables in the same template', async () => {
		const template = 'Start: {{currentFile:plain}}\nMiddle: {{currentFile:metadata}}\nEnd: {{currentFile}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('Start: # Test File\nThis is a test file with link.\nMiddle: ---\ntitle: Test\n---\n# Test File\nThis is a **test** file with [link](http://example.com).\nEnd: # Test File\nThis is a **test** file with [link](http://example.com).');
	});

	it('should handle mixed variables', async () => {
		mockState.values['testVar'] = 'test value';
		const template = 'Variable: {{testVar}}, File: {{currentFile:plain}}, Clipboard: {{clipboard}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('Variable: test value, File: # Test File\nThis is a test file with link., Clipboard: clipboard content');
	});

	it('should leave currentFile variable unchanged when no active file', async () => {
		(mockApp.workspace.getActiveViewOfType as jest.Mock).mockReturnValue(null);
		
		const template = 'File content: {{currentFile}}';
		const result = await engine.process(template, mockState, mockApp);
		
		expect(result).toBe('File content: ');
	});
});

