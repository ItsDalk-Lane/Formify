import { App, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import type { ChatMessage, ChatSession } from '../types/chat';
import { ensureFolderExists, joinPath, sanitizeFileName } from '../utils/storage';
import { MessageService } from './MessageService';

export interface ChatHistoryEntry {
	id: string;
	title: string;
	filePath: string;
	modelId?: string;
	updatedAt: number;
	createdAt: number;
}

const FRONTMATTER_DELIMITER = '---';

export class HistoryService {
	private folderPath: string;
	private readonly messageService: MessageService;

	constructor(private readonly app: App, initialFolder: string) {
		this.folderPath = initialFolder;
		this.messageService = new MessageService();
	}

	/**
	 * 格式化时间戳为YYYY-MM-DD HH:mm:ss格式
	 */
	private formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	/**
	 * 格式化时间戳为YYYYMMDDHHmmss格式（用于文件名后缀）
	 */
	private formatTimestampForFilename(timestamp: number): string {
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		
		return `${year}${month}${day}${hours}${minutes}${seconds}`;
	}

	/**
	 * 清理文本，使其适合作为文件名
	 * - 替换空格为下划线
	 * - 替换无效字符为下划线
	 * - 确保符合系统文件名要求
	 */
	private sanitizeTitle(text: string): string {
		return text
			// 替换空格为下划线
			.replace(/\s+/g, '_')
			// 替换控制字符和无效文件名字符为下划线
			.replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, '_')
			// 移除连续的下划线
			.replace(/_+/g, '_')
			// 移除开头和结尾的下划线
			.replace(/^_|_$/g, '');
	}

	/**
	 * 生成历史记录文件名
	 * 格式：{title}-{日期时间}
	 * title: 第一条用户消息内容，限制在100字节以内
	 * 日期时间: YYYYMMDDHHmmss格式
	 */
	private generateHistoryFileName(firstMessage: ChatMessage): string {
		// 获取第一条消息内容作为标题
		let title = firstMessage.content.trim();
		
		// 清理标题中的无效字符
		title = this.sanitizeTitle(title);
		
		// 计算标题的字节长度（UTF-8编码）
		const encoder = new TextEncoder();
		const titleBytes = encoder.encode(title);
		
		// 如果标题超过100字节，进行截断
		if (titleBytes.length > 100) {
			// 找到最接近100字节的字符位置
			let truncatedLength = title.length;
			for (let i = 0; i < title.length; i++) {
				const testTitle = title.substring(0, i + 1);
				const testBytes = encoder.encode(testTitle);
				if (testBytes.length > 100) {
					truncatedLength = i;
					break;
				}
			}
			
			// 截断标题并添加省略号
			title = title.substring(0, truncatedLength);
			
			// 确保截断后的标题加上省略号不超过100字节
			const ellipsis = '...';
			const titleWithEllipsis = title + ellipsis;
			const titleWithEllipsisBytes = encoder.encode(titleWithEllipsis);
			
			// 如果加上省略号后超过100字节，进一步缩短标题
			if (titleWithEllipsisBytes.length > 100) {
				// 逐步缩短标题直到加上省略号不超过100字节
				while (title.length > 0 && encoder.encode(title + ellipsis).length > 100) {
					title = title.substring(0, title.length - 1);
				}
				title = title + ellipsis;
			} else {
				title = titleWithEllipsis;
			}
		}
		
		// 生成日期时间后缀
		const timestamp = this.formatTimestampForFilename(firstMessage.timestamp);
		
		// 组合最终文件名
		return `${title}-${timestamp}`;
	}

	getFolder(): string {
		return this.folderPath;
	}

	setFolder(folder: string) {
		this.folderPath = folder;
	}

	async listSessions(): Promise<ChatHistoryEntry[]> {
		try {
			const folder = await this.ensureFolder();
			const entries: ChatHistoryEntry[] = [];
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					const cached = this.app.metadataCache.getFileCache(child);
					const frontmatter = cached?.frontmatter;
					if (frontmatter?.id) {
						entries.push({
							id: frontmatter.id as string,
							title: (frontmatter.title as string) ?? child.basename,
							filePath: child.path,
							modelId: frontmatter.model as string,
							createdAt: frontmatter.created ?? child.stat.ctime,
							updatedAt: frontmatter.updated ?? child.stat.mtime
						});
					}
				}
			}
			return entries.sort((a, b) => b.updatedAt - a.updatedAt);
		} catch (error) {
			console.error('[Chat][HistoryService] listSessions error', error);
			return [];
		}
	}

	async saveSession(session: ChatSession): Promise<string> {
		// 如果会话已有文件路径，只更新frontmatter
		if (session.filePath) {
			const file = this.app.vault.getAbstractFileByPath(session.filePath);
			if (file instanceof TFile) {
				await this.updateFileFrontmatter(file, {
					title: session.title,
					model: session.modelId,
					created: this.formatTimestamp(session.createdAt),
					updated: this.formatTimestamp(session.updatedAt),
					messageCount: session.messages.length,
					contextNotes: session.contextNotes ?? []
				});
				return session.filePath;
			}
		}
		
		// 如果没有文件路径或文件不存在，创建新文件
		const folder = await this.ensureFolder();
		
		// 如果有消息，使用第一条消息生成文件名
		let fileName: string;
		if (session.messages.length > 0) {
			fileName = this.generateHistoryFileName(session.messages[0]) + '.md';
		} else {
			// 如果没有消息，使用会话标题生成文件名
			const sanitizedTitle = this.sanitizeTitle(session.title || session.id);
			fileName = `${sanitizedTitle}.md`;
		}
		
		const filePath = joinPath(folder.path, fileName);
		
		// 如果文件已存在，添加时间戳确保唯一性
		let finalFilePath = filePath;
		if (await this.app.vault.adapter.exists(filePath)) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const uniqueFileName = fileName.replace('.md', `-${timestamp}.md`);
			finalFilePath = joinPath(folder.path, uniqueFileName);
		}
		
		const frontmatter = stringifyYaml({
			id: session.id,
			title: session.title,
			model: session.modelId,
			created: this.formatTimestamp(session.createdAt),
			updated: this.formatTimestamp(session.updatedAt),
			messageCount: session.messages.length,
			contextNotes: session.contextNotes ?? []
		});

		const body = session.messages.map((message) => this.messageService.serializeMessage(message)).join('\n\n');
		const content = `${FRONTMATTER_DELIMITER}\n${frontmatter}${FRONTMATTER_DELIMITER}\n\n${body}\n`;

		await this.app.vault.create(finalFilePath, content);
		return finalFilePath;
	}

	async loadSession(filePath: string): Promise<ChatSession | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				return null;
			}

			const data = await this.app.vault.read(file);
			const { frontmatter, body } = this.extractFrontmatter(data);
			
			if (!frontmatter || !frontmatter.id) {
				return null;
			}

			const messages = this.parseMessages(body);
			const session: ChatSession = {
				id: frontmatter.id as string,
				title: (frontmatter.title as string) ?? file.basename,
				modelId: (frontmatter.model as string) ?? '',
				messages,
				contextNotes: (frontmatter.contextNotes as string[]) ?? [],
				createdAt: frontmatter.created ?? file.stat.ctime,
				updatedAt: frontmatter.updated ?? file.stat.mtime,
				selectedImages: [],
				filePath: filePath // 设置文件路径
			};
			return session;
		} catch (error) {
			console.error('[Chat][HistoryService] loadSession error', error);
			return null;
		}
	}

	async deleteSession(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.app.vault.delete(file);
		}
	}

	async createNewSessionFile(session: ChatSession): Promise<string> {
		const folder = await this.ensureFolder();
		const fileName = `${sanitizeFileName(session.title || session.id)}.md`;
		const filePath = joinPath(folder.path, fileName);
		
		// 如果文件已存在，添加时间戳确保唯一性
		let finalFilePath = filePath;
		if (await this.app.vault.adapter.exists(filePath)) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const uniqueFileName = `${sanitizeFileName(session.title || session.id)}-${timestamp}.md`;
			finalFilePath = joinPath(folder.path, uniqueFileName);
		}
		
		const frontmatter = stringifyYaml({
			id: session.id,
			title: session.title,
			model: session.modelId,
			created: session.createdAt,
			updated: session.updatedAt,
			contextNotes: session.contextNotes ?? []
		});

		// 创建文件，只包含frontmatter，不包含任何消息
		const content = `${FRONTMATTER_DELIMITER}\n${frontmatter}${FRONTMATTER_DELIMITER}\n\n`;

		await this.app.vault.create(finalFilePath, content);
		return finalFilePath;
	}

	async appendMessageToFile(filePath: string, message: ChatMessage): Promise<void> {
		if (!filePath) {
			throw new Error('文件路径为空，无法追加消息');
		}
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		// 读取当前文件内容
		const currentContent = await this.app.vault.read(file);
		
		// 序列化新消息
		const serializedMessage = this.messageService.serializeMessage(message);
		
		// 追加新消息到文件末尾
		const newContent = currentContent.trimEnd() + '\n\n' + serializedMessage + '\n';
		
		// 更新文件内容
		await this.app.vault.modify(file, newContent);
		
		// 更新frontmatter中的updated时间
		await this.updateFileTimestamp(file, Date.now());
	}

	async createNewSessionFileWithFirstMessage(session: ChatSession, firstMessage: ChatMessage): Promise<string> {
		const folder = await this.ensureFolder();
		
		// 使用新的文件名生成规则
		const fileName = this.generateHistoryFileName(firstMessage) + '.md';
		const filePath = joinPath(folder.path, fileName);
		
		// 如果文件已存在，添加额外时间戳确保唯一性
		let finalFilePath = filePath;
		if (await this.app.vault.adapter.exists(filePath)) {
			const extraTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const uniqueFileName = this.generateHistoryFileName(firstMessage) + `-${extraTimestamp}.md`;
			finalFilePath = joinPath(folder.path, uniqueFileName);
		}
		
		// 从第一条消息内容中提取标题（不包含日期时间后缀）
		let title = firstMessage.content.trim();
		title = this.sanitizeTitle(title);
		
		// 计算标题的字节长度（UTF-8编码）
		const encoder = new TextEncoder();
		const titleBytes = encoder.encode(title);
		
		// 如果标题超过100字节，进行截断
		if (titleBytes.length > 100) {
			// 找到最接近100字节的字符位置
			let truncatedLength = title.length;
			for (let i = 0; i < title.length; i++) {
				const testTitle = title.substring(0, i + 1);
				const testBytes = encoder.encode(testTitle);
				if (testBytes.length > 100) {
					truncatedLength = i;
					break;
				}
			}
			
			// 截断标题并添加省略号
			title = title.substring(0, truncatedLength);
			
			// 确保截断后的标题加上省略号不超过100字节
			const ellipsis = '...';
			const titleWithEllipsis = title + ellipsis;
			const titleWithEllipsisBytes = encoder.encode(titleWithEllipsis);
			
			// 如果加上省略号后超过100字节，进一步缩短标题
			if (titleWithEllipsisBytes.length > 100) {
				// 逐步缩短标题直到加上省略号不超过100字节
				while (title.length > 0 && encoder.encode(title + ellipsis).length > 100) {
					title = title.substring(0, title.length - 1);
				}
				title = title + ellipsis;
			} else {
				title = titleWithEllipsis;
			}
		}
		
		const frontmatter = stringifyYaml({
			id: session.id,
			title: title, // 使用清理后的标题
			model: session.modelId,
			created: this.formatTimestamp(session.createdAt),
			updated: this.formatTimestamp(session.updatedAt),
			messageCount: 1, // 第一条消息
			contextNotes: session.contextNotes ?? []
		});

		// 序列化第一条消息
		const serializedMessage = this.messageService.serializeMessage(firstMessage);
		
		// 创建文件，包含frontmatter和第一条消息
		const content = `${FRONTMATTER_DELIMITER}\n${frontmatter}${FRONTMATTER_DELIMITER}\n\n${serializedMessage}\n`;

		await this.app.vault.create(finalFilePath, content);
		return finalFilePath;
	}

	async updateFileFrontmatter(file: TFile, updates: Record<string, unknown>): Promise<void> {
		const content = await this.app.vault.read(file);
		const { frontmatter, body } = this.extractFrontmatter(content);
		
		if (!frontmatter) {
			console.warn('[HistoryService] 文件没有frontmatter，无法更新');
			return;
		}
		
		// 合并更新
		const updatedFrontmatter = { ...frontmatter, ...updates };
		
		// 如果更新中包含消息，重新计算消息数量
		if (updates.hasOwnProperty('messages') || body !== undefined) {
			const messages = this.parseMessages(body);
			updatedFrontmatter.messageCount = messages.length;
		}
		
		// 重新构建文件内容
		const newFrontmatter = stringifyYaml(updatedFrontmatter);
		const newContent = `${FRONTMATTER_DELIMITER}\n${newFrontmatter}${FRONTMATTER_DELIMITER}\n\n${body}`;
		
		// 更新文件
		await this.app.vault.modify(file, newContent);
	}

	async rewriteMessagesOnly(filePath: string, messages: ChatMessage[]): Promise<void> {
		if (!filePath) {
			throw new Error('文件路径为空，无法重写消息');
		}
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		// 读取当前文件内容
		const content = await this.app.vault.read(file);
		const { frontmatter } = this.extractFrontmatter(content);
		
		if (!frontmatter) {
			throw new Error('文件没有frontmatter，无法重写消息');
		}
		
		// 更新frontmatter中的时间戳和消息数量
		frontmatter.updated = this.formatTimestamp(Date.now());
		frontmatter.messageCount = messages.length;
		
		// 重新构建文件内容
		const newFrontmatter = stringifyYaml(frontmatter);
		const body = messages.map((message) => this.messageService.serializeMessage(message)).join('\n\n');
		const newContent = `${FRONTMATTER_DELIMITER}\n${newFrontmatter}${FRONTMATTER_DELIMITER}\n\n${body}\n`;
		
		// 更新文件
		await this.app.vault.modify(file, newContent);
	}

	private async updateFileTimestamp(file: TFile, timestamp: number): Promise<void> {
		await this.updateFileFrontmatter(file, { updated: this.formatTimestamp(timestamp) });
	}

	private async ensureFolder(): Promise<TFolder> {
		return ensureFolderExists(this.app, this.folderPath);
	}

	private extractFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
		if (!content.startsWith(FRONTMATTER_DELIMITER)) {
			return { frontmatter: null, body: content };
		}

		const secondDelimiterIndex = content.indexOf(FRONTMATTER_DELIMITER, FRONTMATTER_DELIMITER.length);
		if (secondDelimiterIndex === -1) {
			return { frontmatter: null, body: content };
		}

		const frontmatterBlock = content.substring(FRONTMATTER_DELIMITER.length, secondDelimiterIndex).trim();
		const body = content.substring(secondDelimiterIndex + FRONTMATTER_DELIMITER.length).trimStart();
		const parsed = parseYaml(frontmatterBlock) as Record<string, unknown>;
		return { frontmatter: parsed, body };
	}

	private parseMessages(body: string): ChatMessage[] {
		// 如果body为空，返回空数组
		if (!body || !body.trim()) {
			return [];
		}
		
		const messages: ChatMessage[] = [];
		
		// 使用更简单但更可靠的方法解析消息
		// 1. 按消息标题分割内容
		const messageBlocks = body.split(/\n(?=#)/g);
		
		for (const block of messageBlocks) {
			if (!block.trim()) continue;
			
			// 2. 提取标题和内容
			const titleMatch = block.match(/^#\s+([^\n]+?)(?:\s*\(([^)]+)\))?\n([\s\S]*)$/);
			if (!titleMatch) continue;
			
			const header = titleMatch[1]?.trim() ?? '';
			const timestampStr = titleMatch[2]?.trim() ?? '';
			let content = titleMatch[3]?.trim() ?? '';
			
			// 3. 解析角色
			let role: ChatRole;
			if (header.startsWith('AI')) {
				role = 'assistant';
			} else if (header.startsWith('系统')) {
				role = 'system';
			} else {
				role = 'user';
			}
			
			// 4. 尝试解析时间戳
			let timestamp = Date.now();
			if (timestampStr) {
				try {
					// 尝试解析时间戳字符串
					const dateMatch = timestampStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
					if (dateMatch) {
						const [_, year, month, day, hour, minute, second] = dateMatch.map(Number);
						timestamp = new Date(year, month - 1, day, hour, minute, second).getTime();
					}
				} catch (e) {
					console.warn('[HistoryService] 无法解析时间戳:', timestampStr, e);
				}
			}
			
			// 5. 处理图片引用
			let images: string[] = [];
			const imageMatches = content.matchAll(/!\[Image \d+\]\(([^)]+)\)/g);
			for (const match of imageMatches) {
				if (match[1]) {
					images.push(match[1]);
				}
			}
			
			// 6. 从内容中移除图片引用
			content = content.replace(/!\[Image \d+\]\([^)]+\)\n?/g, '').trim();
			
			// 7. 创建消息对象
			const message = this.messageService.createMessage(role, content, {
				timestamp,
				images,
				metadata: {
					originalHeader: header,
					originalTimestamp: timestampStr
				}
			});
			
			messages.push(message);
		}
		
		// 如果没有匹配到任何消息，尝试使用更宽松的解析方式
		if (messages.length === 0 && body.trim()) {
			console.warn('[HistoryService] 使用更宽松的解析方式');
			const lines = body.split('\n');
			let currentMessage = '';
			let currentRole: ChatRole = 'user';
			let currentTimestamp = Date.now();
			let inMessage = false;
			
			for (const line of lines) {
				if (line.startsWith('# ')) {
					// 保存前一条消息
					if (inMessage && currentMessage.trim()) {
						messages.push(this.messageService.createMessage(currentRole, currentMessage.trim(), {
							timestamp: currentTimestamp
						}));
					}
					
					// 开始新消息
					const header = line.substring(2).trim();
					if (header.startsWith('AI')) {
						currentRole = 'assistant';
					} else if (header.startsWith('系统')) {
						currentRole = 'system';
					} else {
						currentRole = 'user';
					}
					
					currentMessage = '';
					inMessage = true;
				} else if (inMessage) {
					currentMessage += line + '\n';
				}
			}
			
			// 保存最后一条消息
			if (inMessage && currentMessage.trim()) {
				messages.push(this.messageService.createMessage(currentRole, currentMessage.trim(), {
					timestamp: currentTimestamp
				}));
			}
		}
		
		return messages;
	}
}

