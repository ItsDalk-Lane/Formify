import { v4 as uuidv4 } from 'uuid';
import type { EmbedCache } from 'obsidian';
import type { Message as ProviderMessage } from 'src/features/tars/providers';
import type { ChatMessage, ChatRole, SelectedFile, SelectedFolder } from '../types/chat';
import { parseContentBlocks } from '../utils/markdown';
import { FileContentService, FileContentOptions } from './FileContentService';
import { PromptBuilder, PromptBuilderLinkParseOptions } from 'src/service/PromptBuilder';
import { formatReasoningDuration } from 'src/features/tars/providers/utils';

export class MessageService {
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
			linkParseOptions?: PromptBuilderLinkParseOptions;
			parseLinksInTemplates?: boolean;
			sourcePath?: string;
			maxHistoryRounds?: number;
		}
	): Promise<ProviderMessage[]> {
		const { contextNotes = [], systemPrompt, selectedFiles = [], selectedFolders = [], fileContentOptions, linkParseOptions, parseLinksInTemplates, sourcePath, maxHistoryRounds } = options ?? {};

		const promptBuilder = new PromptBuilder(this.app, this.fileContentService);
		return promptBuilder.buildChatProviderMessages(messages, {
			systemPrompt,
			contextNotes,
			selectedFiles,
			selectedFolders,
			fileContentOptions,
			linkParseOptions,
			parseLinksInTemplates,
			sourcePath,
			maxHistoryRounds
		});
	}

	serializeMessage(message: ChatMessage, selectedFiles?: SelectedFile[], selectedFolders?: SelectedFolder[]): string {
		const timestamp = this.formatTimestamp(message.timestamp);
		const roleLabel = this.mapRoleToLabel(message.role);

		// 处理图片引用
		const images = (message.images ?? []).map((image, index) => `![Image ${index + 1}](${image})`).join('\n');

		// 确保消息内容完整，不进行任何截断或压缩
		let content = message.content;
		// 历史文件展示：将推理标记转换为可折叠 callout（不影响聊天界面渲染）
		content = this.formatReasoningBlocksForHistory(content);

		// 如果有错误标记，在内容前添加错误标识
		if (message.isError) {
			content = `[错误] ${content}`;
		}

		// 构建完整消息，确保内容不被截断
		let fullMessage = `# ${roleLabel} (${timestamp})\n${content}`;

		// 如果有选中文本，添加到消息中
		if (message.metadata?.selectedText && typeof message.metadata.selectedText === 'string') {
			const selectedText = message.metadata.selectedText;
			fullMessage += `\n\n> 选中文本:\n> ${selectedText.split('\n').join('\n> ')}`;
		}

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

	private formatReasoningBlocksForHistory(content: string): string {
		if (!content || !content.includes('{{FF_REASONING_START}}')) {
			return content;
		}

		const blocks = parseContentBlocks(content);
		let result = '';

		for (const block of blocks) {
			if (block.type === 'text') {
				result += block.content;
				continue;
			}

			const title = block.durationMs
				? `深度思考 ${formatReasoningDuration(block.durationMs)}`
				: '深度思考';

			const raw = block.content ?? '';
			const normalized = raw.replace(/\s+$/g, '');
			const lines = normalized.split('\n');
			const quotedLines = lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
			const callout = `> [!danger]- ${title}\n${quotedLines}`;

			result += `\n\n${callout}\n\n`;
		}

		return result.replace(/\n{3,}/g, '\n\n');
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
	 * 从base64图片字符串数组创建EmbedCache对象数组
	 * @param imageBase64Array base64图片字符串数组
	 * @returns EmbedCache对象数组
	 * @deprecated Chat 消息拼装已迁移到 PromptBuilder，此方法保留用于向下兼容。
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
			} as unknown as EmbedCache;
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

