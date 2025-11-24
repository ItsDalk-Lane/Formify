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
		const folder = await this.ensureFolder();
		const fileName = `${sanitizeFileName(session.title || session.id)}.md`;
		const filePath = joinPath(folder.path, fileName);
		const frontmatter = stringifyYaml({
			id: session.id,
			title: session.title,
			model: session.modelId,
			created: session.createdAt,
			updated: session.updatedAt,
			contextNotes: session.contextNotes ?? []
		});

		const body = session.messages.map((message) => this.messageService.serializeMessage(message)).join('\n\n');
		const content = `${FRONTMATTER_DELIMITER}\n${frontmatter}${FRONTMATTER_DELIMITER}\n\n${body}\n`;

		if (await this.app.vault.adapter.exists(filePath)) {
			await this.app.vault.adapter.write(filePath, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
		return filePath;
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
			return {
				id: frontmatter.id as string,
				title: (frontmatter.title as string) ?? file.basename,
				modelId: (frontmatter.model as string) ?? '',
				messages,
				contextNotes: (frontmatter.contextNotes as string[]) ?? [],
				createdAt: frontmatter.created ?? file.stat.ctime,
				updatedAt: frontmatter.updated ?? file.stat.mtime,
				selectedImages: []
			};
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
		const matcher = body.matchAll(/^#\s([^\n]+)\n([\s\S]*?)(?=^#\s|\s*$)/gm);
		const messages: ChatMessage[] = [];
		for (const match of matcher) {
			const header = match[1]?.trim() ?? '';
			const content = match[2]?.trim() ?? '';
			const role = header.startsWith('AI') ? 'assistant' : header.startsWith('系统') ? 'system' : 'user';
			messages.push(this.messageService.createMessage(role, content));
		}
		return messages;
	}
}

