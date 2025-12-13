import { v4 as uuidv4 } from 'uuid';
import type { Message as ProviderMessage, EmbedCache } from 'src/features/tars/providers';
import type { ChatMessage, ChatRole, SelectedFile, SelectedFolder } from '../types/chat';
import { FileContentService, FileContentOptions, FileContent, FolderContent } from './FileContentService';
import { InternalLinkParserService, ParseOptions } from 'src/services/InternalLinkParserService';

interface LinkParseOptions {
	enabled: boolean;
	maxDepth: number;
	timeout: number;
	preserveOriginalOnError?: boolean;
	enableCache?: boolean;
}

export class MessageService {
	private linkParser?: InternalLinkParserService;

	constructor(private readonly app: any, private readonly fileContentService?: FileContentService) {}

	createMessage(role: ChatRole, content: string, extras?: Partial<ChatMessage>): ChatMessage {
		const now = Date.now();
		return {
			id: extras?.id ?? uuidv4(),
			role,
			content: content.trim(),
			timestamp: extras?.timestamp ?? now,
			images: extras?.images ?? [],
			isError: extras?.isError ?? false,
			metadata: extras?.metadata ?? {}
		};
	}

	formatTimestamp(timestamp: number): string {
		const locale = (window as any)?.moment?.locale?.() ?? 'zh-CN';
		const formatter = new Intl.DateTimeFormat(locale, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		} as Intl.DateTimeFormatOptions);
		return formatter.format(new Date(timestamp)).replace(/\//g, '/');
	}

	async toProviderMessages(
		messages: ChatMessage[], 
		options?: { 
			contextNotes?: string[]; 
			systemPrompt?: string;
			selectedFiles?: SelectedFile[];
			selectedFolders?: SelectedFolder[];
			fileContentOptions?: FileContentOptions;
			linkParseOptions?: LinkParseOptions;
		}
	): Promise<ProviderMessage[]> {
		const providerMessages: ProviderMessage[] = [];
		const { contextNotes = [], systemPrompt, selectedFiles = [], selectedFolders = [], fileContentOptions, linkParseOptions } = options ?? {};

		if (systemPrompt) {
			providerMessages.push({
				role: 'system',
				content: systemPrompt
			});
		}

		// 处理文件和文件夹内容
		if (selectedFiles.length > 0 || selectedFolders.length > 0) {
			await this.processFileAndFolderContent(
				selectedFiles,
				selectedFolders,
				providerMessages,
				fileContentOptions,
				linkParseOptions
			);
		}

		// 不再显示contextNotes作为Relevant context，因为文件和文件夹信息已经在processFileAndFolderContent中处理
		// if (contextNotes.length > 0) {
		// 	providerMessages.push({
		// 		role: 'system',
		// 		content: `Relevant context provided by the user:\n${contextNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`
		// 	});
		// }

		messages.forEach((message) => {
			const embeds = this.createEmbedsFromImages(message.images ?? []);
			
			// 如果消息的 metadata 中包含 parsedContent，使用解析后的内容
			// 否则使用原始内容
			let messageContent = message.content;
			if (message.metadata?.parsedContent && typeof message.metadata.parsedContent === 'string') {
				messageContent = message.metadata.parsedContent;
			}
			
			providerMessages.push({
				role: message.role,
				content: messageContent,
				embeds: embeds.length > 0 ? embeds : undefined
			});
		});

		return providerMessages;
	}

	serializeMessage(message: ChatMessage, selectedFiles?: SelectedFile[], selectedFolders?: SelectedFolder[]): string {
		const timestamp = this.formatTimestamp(message.timestamp);
		const roleLabel = this.mapRoleToLabel(message.role);
		
		// 处理图片引用
		const images = (message.images ?? []).map((image, index) => `![Image ${index + 1}](${image})`).join('\n');
		
		// 确保消息内容完整，不进行任何截断或压缩
		let content = message.content;
		
		// 如果有错误标记，在内容前添加错误标识
		if (message.isError) {
			content = `[错误] ${content}`;
		}
		
		// 构建完整消息，确保内容不被截断
		let fullMessage = `# ${roleLabel} (${timestamp})\n${content}`;
		
		// 如果是用户消息且有选中的文件或文件夹，添加文件和文件夹信息
		if (message.role === 'user' && (selectedFiles || selectedFolders)) {
			const fileTags = [];
			const folderTags = [];
			
			// 处理文件标签
			if (selectedFiles && selectedFiles.length > 0) {
				for (const file of selectedFiles) {
					fileTags.push(`[[${file.path}]]`);
				}
			}
			
			// 处理文件夹标签
			if (selectedFolders && selectedFolders.length > 0) {
				for (const folder of selectedFolders) {
					folderTags.push(`#${folder.path}`);
				}
			}
			
			// 添加文件和文件夹标签到消息中
			if (fileTags.length > 0 || folderTags.length > 0) {
				const allTags = [...fileTags, ...folderTags].join(' ');
				fullMessage += `\n\n**附件:** ${allTags}`;
			}
		}
		
		// 如果有图片，添加到消息末尾
		if (images) {
			fullMessage += `\n\n${images}`;
		}
		
		return fullMessage;
	}

	private mapRoleToLabel(role: ChatRole): string {
		switch (role) {
			case 'assistant':
				return 'AI';
			case 'system':
				return '系统';
			default:
				return '用户';
		}
	}

	/**
	 * 处理文件和文件夹内容，将其添加到提供者消息中
	 * @param selectedFiles 选中的文件列表
	 * @param selectedFolders 选中的文件夹列表
	 * @param providerMessages 提供者消息数组
	 * @param options 文件内容读取选项
	 */
	private async processFileAndFolderContent(
		selectedFiles: SelectedFile[],
		selectedFolders: SelectedFolder[],
		providerMessages: ProviderMessage[],
		options?: FileContentOptions,
		linkParseOptions?: LinkParseOptions
	): Promise<void> {
		if (!this.fileContentService) {
			console.warn('[MessageService] FileContentService未初始化，无法处理文件内容');
			return;
		}

		try {
			let fileContentText = '用户提供了以下文件和文件夹作为上下文:\n\n';

			// 处理文件内容
			if (selectedFiles.length > 0) {
				const fileContents = await this.fileContentService.readFilesContent(selectedFiles, options);
				const parsedFiles = await this.parseFilesWithInternalLinks(fileContents, linkParseOptions);
				for (const fileContent of parsedFiles) {
					fileContentText += this.fileContentService.formatFileContentForAI(fileContent) + '\n\n';
				}
			}

			// 处理文件夹内容
			if (selectedFolders.length > 0) {
				const folderContents = await this.fileContentService.readFoldersContent(selectedFolders, options);
				const parsedFolders = await this.parseFoldersWithInternalLinks(folderContents, linkParseOptions);
				for (const folderContent of parsedFolders) {
					fileContentText += this.fileContentService.formatFolderContentForAI(folderContent) + '\n\n';
				}
			}

			// 添加文件内容作为系统消息
			providerMessages.push({
				role: 'system',
				content: fileContentText
			});
		} catch (error) {
			console.error('[MessageService] 处理文件和文件夹内容失败:', error);
		}
	}

	private getLinkParser(): InternalLinkParserService {
		if (!this.linkParser) {
			this.linkParser = new InternalLinkParserService(this.app);
		}
		return this.linkParser;
	}

	private async parseContentIfNeeded(content: string, sourcePath: string, options?: LinkParseOptions): Promise<string> {
		if (!options?.enabled) {
			return content;
		}

		const parser = this.getLinkParser();
		const parseOptions: ParseOptions = {
			enableParsing: true,
			maxDepth: options.maxDepth,
			timeout: options.timeout,
			preserveOriginalOnError: options.preserveOriginalOnError ?? true,
			enableCache: options.enableCache ?? true
		};

		return parser.parseLinks(content, sourcePath, parseOptions);
	}

	private async parseFilesWithInternalLinks(files: FileContent[], options?: LinkParseOptions): Promise<FileContent[]> {
		return Promise.all(
			files.map(async (file) => ({
				...file,
				content: await this.parseContentIfNeeded(file.content, file.path, options)
			}))
		);
	}

	private async parseFoldersWithInternalLinks(folders: FolderContent[], options?: LinkParseOptions): Promise<FolderContent[]> {
		return Promise.all(
			folders.map(async (folder) => ({
				...folder,
				files: await this.parseFilesWithInternalLinks(folder.files, options)
			}))
		);
	}

	/**
	 * 从base64图片字符串数组创建EmbedCache对象数组
	 * @param imageBase64Array base64图片字符串数组
	 * @returns EmbedCache对象数组
	 */
	private createEmbedsFromImages(imageBase64Array: string[]): EmbedCache[] {
		return imageBase64Array.map((imageBase64, index) => {
			// 从base64字符串中提取MIME类型
			let mimeType = 'image/png'; // 默认值
			let filename = `image-${index + 1}`;

			if (imageBase64.startsWith('data:')) {
				const mimeMatch = imageBase64.match(/data:([^;]+);/);
				if (mimeMatch) {
					mimeType = mimeMatch[1];
					const extension = this.getExtensionFromMimeType(mimeType);
					filename = `image-${index + 1}.${extension}`;
				}
			}

			// 创建虚拟的EmbedCache对象
			return {
				link: filename,
				path: filename,
				// 为了避免使用Obsidian的内部缓存，我们创建一个简单的对象
				// 实际的图片数据将在resolveEmbedAsBinary时从base64字符串中获取
				[Symbol.for('originalBase64')]: imageBase64,
				[Symbol.for('mimeType')]: mimeType
			} as EmbedCache;
		});
	}

	/**
	 * 从MIME类型获取文件扩展名
	 * @param mimeType MIME类型
	 * @returns 文件扩展名
	 */
	private getExtensionFromMimeType(mimeType: string): string {
		const mimeToExt: Record<string, string> = {
			'image/png': 'png',
			'image/jpeg': 'jpg',
			'image/jpg': 'jpg',
			'image/gif': 'gif',
			'image/webp': 'webp',
			'image/svg+xml': 'svg',
			'image/bmp': 'bmp',
			'image/x-icon': 'ico'
		};
		return mimeToExt[mimeType] || 'png';
	}
}

