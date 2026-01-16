import { v4 as uuidv4 } from 'uuid';
import type { EmbedCache } from 'obsidian';
import type { Message as ProviderMessage } from 'src/features/tars/providers';
import type { ChatMessage, ChatRole, SelectedFile, SelectedFolder } from '../types/chat';
import type { ToolCall } from '../types/tools';
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
			metadata: extras?.metadata ?? {},
			toolCalls: extras?.toolCalls ?? []
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


		// 如果有工具调用，追加历史展示块
		if (message.toolCalls && message.toolCalls.length > 0) {
			const displayBlock = this.formatToolCallsForHistory(message.toolCalls);
			if (displayBlock) {
				fullMessage += `\n\n${displayBlock}`;
			}
		}

		// 如果有图片，添加到消息末尾
		if (images) {
			fullMessage += `\n\n${images}`;
		}

		return fullMessage;
	}

	public extractToolCallsFromHistory(content: string): { content: string; toolCalls?: ToolCall[] } {
		if (!content) {
			return { content };
		}

		const { cleanedContent, toolCalls } = this.parseToolCallsFromCallout(content);
		return { content: cleanedContent, toolCalls };
	}

	private formatToolCallsForHistory(toolCalls: ToolCall[]): string {
		if (!toolCalls.length) return '';

		const lines: string[] = [];
		const first = toolCalls[0];
		const firstSummary = this.buildToolCallSummary(first);
		const title = `**${first.name}**${firstSummary ? ` ${firstSummary}` : ''}`;
		lines.push(`> [!info]- ${title}`);

		for (let index = 0; index < toolCalls.length; index += 1) {
			const call = toolCalls[index];
			if (index > 0) {
				const summary = this.buildToolCallSummary(call);
				lines.push(`> **${call.name}**${summary ? ` ${summary}` : ''}`);
			}

			const content = this.getToolCallContent(call);
			if (content) {
				lines.push('> ```text');
				for (const line of content.split('\n')) {
					lines.push(`> ${line}`);
				}
				lines.push('> ```');
			}

			if (call.result && String(call.result).trim()) {
				lines.push(`> 结果: ${String(call.result).trim()}`);
			}
			lines.push('>');
		}

		return lines.join('\n').trim();
	}

	private buildToolCallSummary(call: ToolCall): string {
		const args = call.arguments ?? {};
		const filePath = args.filePath ?? args.path ?? args.file ?? args.target;
		if (typeof filePath === 'string' && filePath.trim().length > 0) {
			const content = args.content;
			if (typeof content === 'string') {
				return `${filePath}（${content.length}字）`;
			}
			return filePath;
		}
		const url = args.url ?? args.uri ?? args.link;
		if (typeof url === 'string' && url.trim().length > 0) {
			return url;
		}
		const name = args.name ?? args.title ?? args.query;
		if (typeof name === 'string' && name.trim().length > 0) {
			return name;
		}
		return '';
	}

	private getToolCallContent(call: ToolCall): string {
		const raw = (call.arguments ?? {}).content;
		if (typeof raw === 'string') return raw;
		try {
			const text = JSON.stringify(raw ?? {}, null, 2);
			return text === '{}' ? '' : text;
		} catch {
			return '';
		}
	}

	private parseToolCallsFromCallout(content: string): { cleanedContent: string; toolCalls?: ToolCall[] } {
		const lines = content.split('\n');
		const output: string[] = [];
		const toolCalls: ToolCall[] = [];
		let index = 0;

		const parseSummaryToArgs = (summary: string): Record<string, any> => {
			const trimmed = summary.trim();
			if (!trimmed) return {};
			const match = trimmed.match(/^(.*?)(?:（(\d+)字）)?$/);
			if (!match) return {};
			const filePath = match[1]?.trim();
			if (filePath) {
				return { filePath };
			}
			return {};
		};

			const parseBlock = (blockLines: string[]) => {
			let current: ToolCall | null = null;
			let inCode = false;
			let codeLines: string[] = [];
				let currentArgs: Record<string, any> = {};

				const flush = () => {
				if (!current) return;
					if (Object.keys(currentArgs).length > 0) {
						current.arguments = { ...(current.arguments ?? {}), ...currentArgs };
					}
				if (codeLines.length > 0) {
					current.arguments = {
						...(current.arguments ?? {}),
						content: codeLines.join('\n')
					};
				}
				toolCalls.push(current);
				current = null;
					currentArgs = {};
				codeLines = [];
			};

			for (const rawLine of blockLines) {
				const line = rawLine.replace(/^>\s?/, '');
				const headerLine = line.startsWith('[!info]- ') ? line.replace('[!info]- ', '') : line;
				const entryMatch = headerLine.match(/^\*\*(.+?)\*\*(.*)$/);
				if (entryMatch) {
					flush();
					const summaryText = entryMatch[2] ? entryMatch[2].trim() : '';
					currentArgs = parseSummaryToArgs(summaryText);
					current = {
						id: uuidv4(),
						name: entryMatch[1].trim(),
						arguments: {},
						status: 'completed',
						timestamp: Date.now()
					};
					inCode = false;
					continue;
				}

				if (line.trim().startsWith('```')) {
					if (inCode) {
						inCode = false;
					} else {
						inCode = true;
						codeLines = [];
					}
					continue;
				}

				if (line.startsWith('结果:')) {
					const resultText = line.replace(/^结果:\s*/, '').trim();
					if (current) {
						current.result = resultText;
					}
					continue;
				}

				if (inCode) {
					codeLines.push(line);
				}
			}

			flush();
		};

		while (index < lines.length) {
			const line = lines[index];
			if (line.startsWith('> [!info]- **')) {
				let endIndex = index;
				while (endIndex + 1 < lines.length && lines[endIndex + 1].startsWith('>')) {
					endIndex += 1;
				}

				const blockLines = lines.slice(index, endIndex + 1);
				parseBlock(blockLines);
				index = endIndex + 1;
				continue;
			}

			output.push(line);
			index += 1;
		}

		const cleanedContent = output.join('\n').trim();
		return { cleanedContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
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

	/**
	 * 将历史文件中的 callout 格式转换回推理标记格式
	 * 用于在加载历史消息时恢复推理块的原始格式
	 */
	public parseReasoningBlocksFromHistory(content: string): string {
		if (!content || !content.includes('> [!danger]')) {
			return content;
		}

		// 匹配 callout 格式：> [!danger]- 深度思考 或 > [!danger]- 深度思考 X.XXs
		// 后面跟着引用内容行（以 > 开头）
		// 允许 callout 之后出现空行或普通内容，避免漏匹配
		const calloutPattern = /> \[!danger\]- (深度思考(?:\s+\d+\.?\d*s)?)\n((?:>[^\n]*\n)+?)(?=\n(?:[^>]|$))/g;
		let result = content;
		let match: RegExpExecArray | null;

		while ((match = calloutPattern.exec(content)) !== null) {
			const title = match[1];
			const quotedContent = match[2];

			// 提取时长
			let durationMs: number | undefined;
			const timeMatch = title.match(/(\d+\.?\d*)s/);
			if (timeMatch) {
				durationMs = Math.round(parseFloat(timeMatch[1]) * 1000);
			}

			// 移除引用标记，恢复原始内容
			const reasoningContent = quotedContent
				.split('\n')
				.map(line => line.replace(/^>\s*/, '').trim()) // 只移除 > 和后面的空格
				.filter(line => line.length > 0) // 过滤空行
				.join('\n');

			// 计算开始时间（使用当前时间减去时长，这样推理块会显示为已完成状态）
			const startMs = durationMs ? Date.now() - durationMs : Date.now();

			// 构建推理标记
			let reasoningBlock: string;
			if (durationMs !== undefined) {
				reasoningBlock = `{{FF_REASONING_START}}:${startMs}:${reasoningContent}:{{FF_REASONING_END}}:${durationMs}`;
			} else {
				reasoningBlock = `{{FF_REASONING_START}}:${startMs}:${reasoningContent}`;
			}

			// 替换原内容中的 callout
			result = result.replace(match[0], reasoningBlock);
		}

		return result;
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

