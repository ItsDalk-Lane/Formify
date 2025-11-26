import { App, TFile, TFolder, TAbstractFile, Notice } from 'obsidian';
import type { SelectedFile, SelectedFolder } from '../types/chat';

export interface FileContent {
	path: string;
	name: string;
	content: string;
	extension: string;
	size: number;
}

export interface FolderContent {
	path: string;
	name: string;
	files: FileContent[];
}

export interface FileContentOptions {
	maxFileSize?: number; // 最大文件大小（字节）
	maxContentLength?: number; // 最大内容长度（字符）
	includeExtensions?: string[]; // 包含的文件扩展名，为空则包含所有
	excludeExtensions?: string[]; // 排除的文件扩展名
	excludePatterns?: RegExp[]; // 排除的文件路径模式
}

export class FileContentService {
	private readonly defaultOptions: FileContentOptions = {
		maxFileSize: 1024 * 1024, // 1MB
		maxContentLength: 10000, // 10000个字符
		includeExtensions: [], // 包含所有文件
		excludeExtensions: ['exe', 'dll', 'bin', 'zip', 'rar', 'tar', 'gz'], // 排除二进制文件
		excludePatterns: [
			/node_modules/,
			/\.git/,
			/\.DS_Store/,
			/Thumbs\.db/
		]
	};

	constructor(private readonly app: App) {}

	/**
	 * 读取单个文件的内容
	 * @param file 选中的文件信息
	 * @param options 读取选项
	 * @returns 文件内容
	 */
	async readFileContent(file: SelectedFile, options?: FileContentOptions): Promise<FileContent | null> {
		const opts = { ...this.defaultOptions, ...options };
		
		try {
			// 获取Obsidian文件对象
			const tFile = this.app.vault.getAbstractFileByPath(file.path);
			if (!tFile || !(tFile instanceof TFile)) {
				console.warn(`[FileContentService] 文件不存在或不是文件: ${file.path}`);
				return null;
			}

			// 检查文件大小
			const fileSize = await this.app.vault.adapter.stat(file.path);
			if (fileSize && fileSize.size > opts.maxFileSize) {
				console.warn(`[FileContentService] 文件过大，跳过: ${file.path} (${fileSize.size} bytes)`);
				return null;
			}

			// 检查文件扩展名
			if (opts.includeExtensions.length > 0 && !opts.includeExtensions.includes(file.extension)) {
				console.warn(`[FileContentService] 文件扩展名不匹配，跳过: ${file.path}`);
				return null;
			}

			if (opts.excludeExtensions.includes(file.extension)) {
				console.warn(`[FileContentService] 文件扩展名被排除，跳过: ${file.path}`);
				return null;
			}

			// 检查排除模式
			if (opts.excludePatterns.some(pattern => pattern.test(file.path))) {
				console.warn(`[FileContentService] 文件路径匹配排除模式，跳过: ${file.path}`);
				return null;
			}

			// 读取文件内容
			let content = await this.app.vault.read(tFile);
			
			// 截断内容
			if (content.length > opts.maxContentLength) {
				content = content.substring(0, opts.maxContentLength) + '\n\n[内容已截断...]';
			}

			return {
				path: file.path,
				name: file.name,
				content,
				extension: file.extension,
				size: fileSize?.size || 0
			};
		} catch (error) {
			console.error(`[FileContentService] 读取文件失败: ${file.path}`, error);
			return null;
		}
	}

	/**
	 * 递归读取文件夹中的所有文件内容
	 * @param folder 选中的文件夹信息
	 * @param options 读取选项
	 * @returns 文件夹内容
	 */
	async readFolderContent(folder: SelectedFolder, options?: FileContentOptions): Promise<FolderContent | null> {
		const opts = { ...this.defaultOptions, ...options };
		
		try {
			// 获取Obsidian文件夹对象
			const tFolder = this.app.vault.getAbstractFileByPath(folder.path);
			if (!tFolder || !(tFolder instanceof TFolder)) {
				console.warn(`[FileContentService] 文件夹不存在或不是文件夹: ${folder.path}`);
				return null;
			}

			const files: FileContent[] = [];
			await this.processFolder(tFolder, files, opts);

			return {
				path: folder.path,
				name: folder.name,
				files
			};
		} catch (error) {
			console.error(`[FileContentService] 读取文件夹失败: ${folder.path}`, error);
			return null;
		}
	}

	/**
	 * 读取多个文件的内容
	 * @param files 选中的文件列表
	 * @param options 读取选项
	 * @returns 文件内容列表
	 */
	async readFilesContent(files: SelectedFile[], options?: FileContentOptions): Promise<FileContent[]> {
		const opts = { ...this.defaultOptions, ...options };
		const results: FileContent[] = [];

		for (const file of files) {
			const content = await this.readFileContent(file, opts);
			if (content) {
				results.push(content);
			}
		}

		return results;
	}

	/**
	 * 读取多个文件夹的内容
	 * @param folders 选中的文件夹列表
	 * @param options 读取选项
	 * @returns 文件夹内容列表
	 */
	async readFoldersContent(folders: SelectedFolder[], options?: FileContentOptions): Promise<FolderContent[]> {
		const opts = { ...this.defaultOptions, ...options };
		const results: FolderContent[] = [];

		for (const folder of folders) {
			const content = await this.readFolderContent(folder, opts);
			if (content) {
				results.push(content);
			}
		}

		return results;
	}

	/**
	 * 将文件内容格式化为AI可理解的文本
	 * @param fileContent 文件内容
	 * @returns 格式化后的文本
	 */
	formatFileContentForAI(fileContent: FileContent): string {
		const { path, name, content, extension } = fileContent;
		const languageId = this.getLanguageId(extension);
		
		return `## 文件: ${name} (路径: ${path})

\`\`\`${languageId}
${content}
\`\`\``;
	}

	/**
	 * 将文件夹内容格式化为AI可理解的文本
	 * @param folderContent 文件夹内容
	 * @returns 格式化后的文本
	 */
	formatFolderContentForAI(folderContent: FolderContent): string {
		const { path, name, files } = folderContent;
		
		let result = `# 文件夹: ${name} (路径: ${path})\n\n`;
		
		if (files.length === 0) {
			result += '此文件夹中没有可读取的文件。\n';
			return result;
		}
		
		result += `包含 ${files.length} 个文件:\n\n`;
		
		for (const file of files) {
			result += this.formatFileContentForAI(file) + '\n\n';
		}
		
		return result;
	}

	/**
	 * 递归处理文件夹中的文件
	 * @param folder 文件夹对象
	 * @param results 结果数组
	 * @param options 读取选项
	 */
	private async processFolder(folder: TFolder, results: FileContent[], options: FileContentOptions): Promise<void> {
		for (const child of folder.children) {
			// 检查排除模式
			if (options.excludePatterns.some(pattern => pattern.test(child.path))) {
				continue;
			}

			if (child instanceof TFile) {
				// 处理文件
				const selectedFile: SelectedFile = {
					id: child.path,
					name: child.name,
					path: child.path,
					extension: child.extension || '',
					type: 'file'
				};
				
				const content = await this.readFileContent(selectedFile, options);
				if (content) {
					results.push(content);
				}
			} else if (child instanceof TFolder) {
				// 递归处理子文件夹
				await this.processFolder(child, results, options);
			}
		}
	}

	/**
	 * 根据文件扩展名获取语言标识符
	 * @param extension 文件扩展名
	 * @returns 语言标识符
	 */
	private getLanguageId(extension: string): string {
		const extToLanguage: Record<string, string> = {
			'md': 'markdown',
			'js': 'javascript',
			'ts': 'typescript',
			'jsx': 'jsx',
			'tsx': 'tsx',
			'py': 'python',
			'java': 'java',
			'c': 'c',
			'cpp': 'cpp',
			'cc': 'cpp',
			'h': 'c',
			'hpp': 'cpp',
			'cs': 'csharp',
			'php': 'php',
			'rb': 'ruby',
			'go': 'go',
			'rs': 'rust',
			'swift': 'swift',
			'kt': 'kotlin',
			'scala': 'scala',
			'r': 'r',
			'sql': 'sql',
			'html': 'html',
			'css': 'css',
			'scss': 'scss',
			'sass': 'sass',
			'less': 'less',
			'xml': 'xml',
			'json': 'json',
			'yaml': 'yaml',
			'yml': 'yaml',
			'toml': 'toml',
			'ini': 'ini',
			'cfg': 'ini',
			'conf': 'ini',
			'sh': 'bash',
			'bash': 'bash',
			'zsh': 'zsh',
			'fish': 'fish',
			'ps1': 'powershell',
			'bat': 'batch',
			'cmd': 'batch',
			'dockerfile': 'dockerfile',
			'docker': 'dockerfile',
			'gitignore': 'gitignore',
			'gitattributes': 'gitattributes',
			'txt': 'text',
			'log': 'log',
			'csv': 'csv',
			'tsv': 'tsv'
		};
		
		return extToLanguage[extension.toLowerCase()] || 'text';
	}
}
