import { App, TFile, TFolder } from 'obsidian';
import { FileContentService } from './FileContentService';
import type { SelectedFile, SelectedFolder } from '../types/chat';

// 模拟App类
class MockApp {
	vault = {
		getAbstractFileByPath: jest.fn(),
		read: jest.fn(),
		adapter: {
			stat: jest.fn()
		}
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

// 模拟TFolder类
class MockTFolder {
	constructor(
		public path: string,
		public name: string,
		public children: any[] = []
	) {}
}

describe('FileContentService', () => {
	let service: FileContentService;
	let mockApp: App;

	beforeEach(() => {
		mockApp = new MockApp() as any;
		service = new FileContentService(mockApp);
	});

	describe('readFileContent', () => {
		it('should read file content successfully', async () => {
			// 设置模拟数据
			const selectedFile: SelectedFile = {
				id: 'test.md',
				name: 'test.md',
				path: 'test.md',
				extension: 'md',
				type: 'file'
			};

			const mockFile = new MockTFile('test.md', 'test.md', 'md');
			const fileContent = '# Test File\nThis is a test file content.';
			const fileStats = { size: 100 };

			// 设置模拟函数返回值
			(mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);
			(mockApp.vault.read as jest.Mock).mockResolvedValue(fileContent);
			(mockApp.vault.adapter.stat as jest.Mock).mockResolvedValue(fileStats);

			// 调用方法
			const result = await service.readFileContent(selectedFile);

			// 验证结果
			expect(result).toEqual({
				path: 'test.md',
				name: 'test.md',
				content: fileContent,
				extension: 'md',
				size: 100
			});

			// 验证函数调用
			expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('test.md');
			expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
			expect(mockApp.vault.adapter.stat).toHaveBeenCalledWith('test.md');
		});

		it('should return null if file does not exist', async () => {
			const selectedFile: SelectedFile = {
				id: 'nonexistent.md',
				name: 'nonexistent.md',
				path: 'nonexistent.md',
				extension: 'md',
				type: 'file'
			};

			// 设置模拟函数返回值
			(mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

			// 调用方法
			const result = await service.readFileContent(selectedFile);

			// 验证结果
			expect(result).toBeNull();
		});

		it('should truncate content if it exceeds maxContentLength', async () => {
			const selectedFile: SelectedFile = {
				id: 'large.md',
				name: 'large.md',
				path: 'large.md',
				extension: 'md',
				type: 'file'
			};

			const mockFile = new MockTFile('large.md', 'large.md', 'md');
			// 创建一个超过最大长度的内容
			const largeContent = 'a'.repeat(20000);
			const fileStats = { size: 20000 };

			// 设置模拟函数返回值
			(mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);
			(mockApp.vault.read as jest.Mock).mockResolvedValue(largeContent);
			(mockApp.vault.adapter.stat as jest.Mock).mockResolvedValue(fileStats);

			// 调用方法，设置较小的最大内容长度
			const result = await service.readFileContent(selectedFile, { maxContentLength: 1000 });

			// 验证结果
			expect(result?.content.length).toBeLessThanOrEqual(1000 + '\n\n[内容已截断...]'.length);
			expect(result?.content).toContain('[内容已截断...]');
		});
	});

	describe('formatFileContentForAI', () => {
		it('should format file content correctly', () => {
			const fileContent = {
				path: 'test.md',
				name: 'test.md',
				content: '# Test File\nThis is a test file content.',
				extension: 'md',
				size: 100
			};

			const result = service.formatFileContentForAI(fileContent);

			expect(result).toContain('## 文件: test.md (路径: test.md)');
			expect(result).toContain('```markdown');
			expect(result).toContain('# Test File\nThis is a test file content.');
			expect(result).toContain('```');
		});
	});

	describe('formatFolderContentForAI', () => {
		it('should format folder content correctly', () => {
			const folderContent = {
				path: 'test-folder',
				name: 'test-folder',
				files: [
					{
						path: 'test-folder/file1.md',
						name: 'file1.md',
						content: '# File 1\nContent of file 1.',
						extension: 'md',
						size: 50
					},
					{
						path: 'test-folder/file2.js',
						name: 'file2.js',
						content: 'console.log("Hello, world!");',
						extension: 'js',
						size: 30
					}
				]
			};

			const result = service.formatFolderContentForAI(folderContent);

			expect(result).toContain('# 文件夹: test-folder (路径: test-folder)');
			expect(result).toContain('包含 2 个文件:');
			expect(result).toContain('## 文件: file1.md (路径: test-folder/file1.md)');
			expect(result).toContain('```markdown');
			expect(result).toContain('# File 1\nContent of file 1.');
			expect(result).toContain('## 文件: file2.js (路径: test-folder/file2.js)');
			expect(result).toContain('```javascript');
			expect(result).toContain('console.log("Hello, world!");');
		});

		it('should handle empty folder', () => {
			const folderContent = {
				path: 'empty-folder',
				name: 'empty-folder',
				files: []
			};

			const result = service.formatFolderContentForAI(folderContent);

			expect(result).toContain('# 文件夹: empty-folder (路径: empty-folder)');
			expect(result).toContain('此文件夹中没有可读取的文件。');
		});
	});
});
