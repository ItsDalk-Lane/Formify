import type { App, EmbedCache } from 'obsidian';
import type { Message as ProviderMessage, MessageToolCall } from 'src/features/tars/providers';
import { SystemPromptMode } from 'src/model/enums/SystemPromptMode';
import { PromptSourceType } from 'src/model/enums/PromptSourceType';
import { InternalLinkParserService, ParseOptions } from 'src/service/InternalLinkParserService';
import type { ChatMessage, ChatRole, SelectedFile, SelectedFolder, FileIntentAnalysis, FileRole } from 'src/features/chat/types/chat';
import type { FileContentOptions, FileContentService, FileContent, FolderContent } from 'src/features/chat/services/FileContentService';
import { FileIntentAnalyzer } from 'src/features/chat/services/FileIntentAnalyzer';
import { parseContentBlocks } from 'src/features/chat/utils/markdown';

export const DEFAULT_HISTORY_ROUNDS = 10;

export interface PromptBuilderLinkParseOptions {
	enabled: boolean;
	maxDepth: number;
	timeout: number;
	preserveOriginalOnError?: boolean;
	enableCache?: boolean;
}

export interface PromptBuilderChatContext {
	systemPrompt?: string;
	contextNotes?: string[];
	selectedFiles?: SelectedFile[];
	selectedFolders?: SelectedFolder[];
	fileContentOptions?: FileContentOptions;
	linkParseOptions?: PromptBuilderLinkParseOptions;
	parseLinksInTemplates?: boolean;
	sourcePath?: string;
	maxHistoryRounds?: number;
	/** 任务模板内容，用于智能判断文件角色 */
	taskTemplate?: string;
	/** 是否启用智能文件角色判断 */
	enableFileIntentAnalysis?: boolean;
}

export class PromptBuilder {
	private readonly linkParser: InternalLinkParserService;
	private readonly intentAnalyzer: FileIntentAnalyzer;

	constructor(
		private readonly app: App,
		private readonly fileContentService?: FileContentService
	) {
		this.linkParser = new InternalLinkParserService(app);
		this.intentAnalyzer = new FileIntentAnalyzer();
	}

	/**
	 * Chat: 将会话消息 + 系统提示词 + 文件上下文，组装成最终发送给 provider 的消息序列。
	 * 顺序：System -> Context(User/XML) -> History(截断) -> Task(当前输入)
	 */
	async buildChatProviderMessages(messages: ChatMessage[], ctx?: PromptBuilderChatContext): Promise<ProviderMessage[]> {
		let systemPrompt = ctx?.systemPrompt;
		const contextNotes = ctx?.contextNotes ?? [];
		const selectedFiles = ctx?.selectedFiles ?? [];
		const selectedFolders = ctx?.selectedFolders ?? [];
		const fileContentOptions = ctx?.fileContentOptions;
		const linkParseOptions = ctx?.linkParseOptions;
		const parseLinksInTemplates = ctx?.parseLinksInTemplates ?? true;
		const sourcePath = ctx?.sourcePath ?? this.app.workspace.getActiveFile()?.path ?? '';
		const maxHistoryRounds = ctx?.maxHistoryRounds ?? DEFAULT_HISTORY_ROUNDS;
		const taskTemplate = ctx?.taskTemplate;
		const enableFileIntentAnalysis = ctx?.enableFileIntentAnalysis ?? true;

		const result: ProviderMessage[] = [];

		// 智能文件角色判断：分析任务模板，生成文件处理指导
		const hasFiles = selectedFiles.length > 0 || selectedFolders.length > 0;
		if (enableFileIntentAnalysis && hasFiles && taskTemplate && systemPrompt) {
			const analysis = this.intentAnalyzer.analyzePromptIntent(taskTemplate);
			const fileRoleGuidance = this.buildFileRoleGuidance(analysis);
			if (fileRoleGuidance) {
				systemPrompt = systemPrompt + '\n\n' + fileRoleGuidance;
			}
		}

		// 1) System
		if (systemPrompt && systemPrompt.trim().length > 0) {
			result.push({ role: 'system', content: systemPrompt });
		}

		// 3) History + 4) Task
		const nonSystemMessages = messages.filter((m) => m.role !== 'system');
		if (nonSystemMessages.length === 0) {
			return result;
		}

		const last = nonSystemMessages[nonSystemMessages.length - 1];
		const isLastUser = last.role === 'user';

		// 2) Context (User/XML)
		// - 文件/文件夹（由 UI 手动或自动添加）
		// - 选中文本/符号触发全文（来自最后一次用户输入的 metadata.selectedText）
		// - 图片（来自最后一次用户输入的 images，按场景规则归入 Context）
		const selectedText = isLastUser ? this.getStringMetadata(last, 'selectedText') : null;
		const contextEmbeds = isLastUser ? this.createEmbedsFromImages(last.images ?? []) : [];
		const contextMessage = await this.buildContextMessage({
			selectedFiles,
			selectedFolders,
			contextNotes,
			selectedText,
			fileContentOptions,
			linkParseOptions,
			sourcePath,
			embeds: contextEmbeds
		});
		if (contextMessage) {
			result.push(contextMessage);
		}

		const history = isLastUser ? nonSystemMessages.slice(0, -1) : nonSystemMessages;
		const trimmedHistory = this.trimHistory(history, maxHistoryRounds);

		for (const message of trimmedHistory) {
			result.push(await this.mapChatMessageToProviderMessage(message, {
				linkParseOptions,
				parseLinksInTemplates,
				sourcePath
			}));
		}

		if (isLastUser) {
			// Task 消息中不再携带 images（按规则归入 Context）
			const taskMessage: ChatMessage = {
				...last,
				images: []
			};
			result.push(await this.mapChatMessageToProviderMessage(taskMessage, {
				linkParseOptions,
				parseLinksInTemplates,
				sourcePath
			}));
		}

		return result;
	}

	/**
	 * Action: 统一组装 system + user 消息（用于 AIActionService 等非聊天链路）。
	 */
	buildActionProviderMessages(systemPrompt: string | null, userPrompt: string): ProviderMessage[] {
		const result: ProviderMessage[] = [];
		if (systemPrompt && systemPrompt.trim().length > 0) {
			result.push({ role: 'system', content: systemPrompt });
		}
		result.push({ role: 'user', content: userPrompt });
		return result;
	}

	/**
	 * History 截断：仅对中间 History 层做截断，保留最近 N 轮（2N 条消息）。
	 */
	trimHistory(messages: ChatMessage[], maxRounds: number): ChatMessage[] {
		const safeMaxRounds = Number.isFinite(maxRounds) && maxRounds > 0 ? Math.floor(maxRounds) : DEFAULT_HISTORY_ROUNDS;
		const maxMessages = safeMaxRounds * 2;
		if (messages.length <= maxMessages) {
			return messages;
		}
		return messages.slice(messages.length - maxMessages);
	}

	/**
	 * Action: 构建系统提示词（默认/自定义/无）并处理内链解析。
	 * 保留 SystemPromptMode 枚举语义。
	 */
	async buildSystemPrompt(params: {
		mode: SystemPromptMode;
		defaultSystemPrompt?: string | null;
		customSystemPrompt?: string | null;
		processTemplate: (template: string) => Promise<string>;
		enableInternalLinkParsing: boolean;
		sourcePath: string;
		parseOptions: ParseOptions;
	}): Promise<string | null> {
		const mode = params.mode ?? SystemPromptMode.DEFAULT;

		let systemPrompt: string | null = null;

		switch (mode) {
			case SystemPromptMode.NONE:
				return null;
			case SystemPromptMode.CUSTOM:
				if (!params.customSystemPrompt) {
					return null;
				}
				systemPrompt = await params.processTemplate(params.customSystemPrompt);
				break;
			case SystemPromptMode.DEFAULT:
			default:
				if (!params.defaultSystemPrompt) {
					return null;
				}
				systemPrompt = await params.processTemplate(params.defaultSystemPrompt);
				break;
		}

		if (systemPrompt && params.enableInternalLinkParsing) {
			systemPrompt = await this.parseInternalLinks(systemPrompt, params.sourcePath, params.parseOptions);
		}

		return systemPrompt;
	}

	/**
	 * Action: 构建用户提示词（从模板文件或自定义内容）并处理内链解析。
	 */
	async buildUserPrompt(params: {
		promptSource: PromptSourceType;
		templateFile?: string;
		customPrompt?: string | null;
		loadTemplateFile: (templatePath: string) => Promise<string>;
		processTemplate: (template: string) => Promise<string>;
		enableInternalLinkParsing: boolean;
		sourcePath: string;
		parseOptions: ParseOptions;
	}): Promise<string> {
		let userPrompt: string;

		if (params.promptSource === PromptSourceType.TEMPLATE && params.templateFile) {
			userPrompt = await params.loadTemplateFile(params.templateFile);
		} else if (params.promptSource === PromptSourceType.CUSTOM && params.customPrompt) {
			userPrompt = await params.processTemplate(params.customPrompt);
		} else {
			throw new Error('提示词来源无效');
		}

		if (params.enableInternalLinkParsing) {
			userPrompt = await this.parseInternalLinks(userPrompt, params.sourcePath, params.parseOptions);
		}

		return userPrompt;
	}

	/**
	 * Task 层：模板结构化组装（显式替换 / 隐式包装），随后再做全局变量/内链解析。
	 * 目前主要供后续扩展使用；Chat 侧仍沿用既有消息内容（保持向下兼容）。
	 */
	async buildTaskContent(params: {
		userInput: string;
		template?: string;
		explicitPlaceholder?: string;
		globalVariableProcessor?: (text: string) => Promise<string>;
		enableInternalLinkParsing: boolean;
		sourcePath: string;
		parseOptions: ParseOptions;
	}): Promise<string> {
		const placeholder = params.explicitPlaceholder ?? '{{user_input}}';
		const rawUserInput = params.userInput ?? '';

		let content: string;
		if (typeof params.template === 'string' && params.template.length > 0) {
			if (params.template.includes(placeholder)) {
				content = params.template.split(placeholder).join(rawUserInput);
			} else {
				content = `### 任务指令\n${params.template}\n\n### 用户输入\n${rawUserInput}`;
			}
		} else {
			content = rawUserInput;
		}

		if (params.globalVariableProcessor) {
			content = await params.globalVariableProcessor(content);
		}

		if (params.enableInternalLinkParsing) {
			content = await this.parseInternalLinks(content, params.sourcePath, params.parseOptions);
		}

		return content;
	}

	private async buildContextMessage(params: {
		selectedFiles: SelectedFile[];
		selectedFolders: SelectedFolder[];
		contextNotes: string[];
		selectedText: string | null;
		fileContentOptions?: FileContentOptions;
		linkParseOptions?: PromptBuilderLinkParseOptions;
		sourcePath: string;
		embeds: EmbedCache[];
	}): Promise<ProviderMessage | null> {
		const documents: Array<{ source: string; content: string }> = [];

		// 1) 附加上下文备注
		for (const note of params.contextNotes) {
			const trimmed = (note ?? '').trim();
			if (!trimmed) {
				continue;
			}
			documents.push({ source: 'context_note', content: trimmed });
		}

		// 2) 选中文本 / 符号触发全文
		if (params.selectedText && params.selectedText.trim().length > 0) {
			const maybeParsed = await this.parseContentIfNeeded(params.selectedText, params.sourcePath, params.linkParseOptions);
			documents.push({ source: 'selected_text', content: maybeParsed });
		}

		// 3) 文件/文件夹内容
		if (this.fileContentService) {
			const files: FileContent[] = [];

			if (params.selectedFiles.length > 0) {
				const fileContents = await this.fileContentService.readFilesContent(params.selectedFiles, params.fileContentOptions);
				const parsedFiles = await this.parseFilesWithInternalLinks(fileContents, params.linkParseOptions);
				files.push(...parsedFiles);
			}

			if (params.selectedFolders.length > 0) {
				const folderContents = await this.fileContentService.readFoldersContent(params.selectedFolders, params.fileContentOptions);
				const parsedFolders = await this.parseFoldersWithInternalLinks(folderContents, params.linkParseOptions);
				for (const folder of parsedFolders) {
					files.push(...folder.files);
				}
			}

			for (const file of files) {
				documents.push({ source: file.path, content: file.content ?? '' });
			}
		}

		const hasDocs = documents.length > 0;
		const hasEmbeds = params.embeds.length > 0;
		if (!hasDocs && !hasEmbeds) {
			return null;
		}

		const xml = this.formatDocumentsAsXml(documents);
		return {
			role: 'user',
			content: xml,
			embeds: hasEmbeds ? params.embeds : undefined
		};
	}

	private formatDocumentsAsXml(documents: Array<{ source: string; content: string }>): string {
		let index = 1;
		let xml = '<documents>\n';

		for (const doc of documents) {
			const source = this.escapeXml(doc.source);
			const content = this.escapeXml(doc.content ?? '');
			xml += `  <document index="${index}">\n`;
			xml += `    <source>${source}</source>\n`;
			xml += '    <document_content>\n';
			xml += `${content}\n`;
			xml += '    </document_content>\n';
			xml += '  </document>\n';
			index += 1;
		}

		xml += '</documents>';
		return xml;
	}

	private formatFilesAsDocumentsXml(files: FileContent[]): string {
		return this.formatDocumentsAsXml(files.map((f) => ({ source: f.path, content: f.content ?? '' })));
	}

	private escapeXml(text: string): string {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	private async mapChatMessageToProviderMessage(
		message: ChatMessage,
		ctx?: {
			linkParseOptions?: PromptBuilderLinkParseOptions;
			parseLinksInTemplates: boolean;
			sourcePath: string;
		}
	): Promise<ProviderMessage> {
		const embeds = this.createEmbedsFromImages(message.images ?? []);

		let messageContent = message.content;
		let reasoningContent: string | undefined;
		let toolCalls: MessageToolCall[] | undefined;

		if (message.role === 'user') {
			const taskUserInput = this.getStringMetadata(message, 'taskUserInput');
			const taskTemplate = this.getStringMetadata(message, 'taskTemplate');

			if (taskUserInput !== null) {
				const linkParseOptions = ctx?.linkParseOptions;
				const enableInternalLinkParsing = linkParseOptions?.enabled ?? false;
				const parseOptions: ParseOptions = {
					enableParsing: true,
					maxDepth: linkParseOptions?.maxDepth ?? 5,
					timeout: linkParseOptions?.timeout ?? 5000,
					preserveOriginalOnError: linkParseOptions?.preserveOriginalOnError ?? true,
					enableCache: linkParseOptions?.enableCache ?? true
				};

				const structuredTask = await this.buildChatTaskContent({
					userInput: taskUserInput,
					template: taskTemplate,
					enableInternalLinkParsing,
					parseLinksInTemplates: ctx?.parseLinksInTemplates ?? true,
					sourcePath: ctx?.sourcePath ?? '',
					parseOptions
				});
				messageContent = structuredTask;
			} else if (message.metadata?.parsedContent && typeof message.metadata.parsedContent === 'string') {
				messageContent = message.metadata.parsedContent;
			}
		} else if (message.role === 'assistant') {
			// 对于 assistant 消息，提取推理内容和普通文本内容
			const blocks = parseContentBlocks(messageContent);
			const reasoningBlocks = blocks.filter(b => b.type === 'reasoning');
			const textBlocks = blocks.filter(b => b.type === 'text');
			
			if (reasoningBlocks.length > 0) {
				// 合并所有推理内容
				reasoningContent = reasoningBlocks.map(b => b.content).join('\n');
				// 合并所有普通文本内容
				messageContent = textBlocks.map(b => b.content).join('\n');
			}
			
			// 处理 parsedContent
			if (message.metadata?.parsedContent && typeof message.metadata.parsedContent === 'string') {
				messageContent = message.metadata.parsedContent;
			}
			
			// 处理工具调用（转换为 DeepSeek/OpenAI 兼容格式）
			if (message.toolCalls && message.toolCalls.length > 0) {
				toolCalls = message.toolCalls.map(tc => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments)
					}
				}));
			}
		} else if (message.role === 'tool') {
			// tool 角色消息：工具执行结果
			// 不需要特殊处理内容，直接返回
		} else if (message.metadata?.parsedContent && typeof message.metadata.parsedContent === 'string') {
			messageContent = message.metadata.parsedContent;
		}

		return {
			role: message.role,
			content: messageContent,
			embeds: embeds.length > 0 ? embeds : undefined,
			reasoning_content: reasoningContent,
			tool_calls: toolCalls,
			tool_call_id: message.toolCallId
		};
	}

	private getStringMetadata(message: ChatMessage, key: string): string | null {
		const meta = message.metadata;
		if (!meta || typeof meta !== 'object') {
			return null;
		}
		const value = (meta as Record<string, unknown>)[key];
		return typeof value === 'string' ? value : null;
	}

	private async buildChatTaskContent(params: {
		userInput: string;
		template: string | null;
		enableInternalLinkParsing: boolean;
		parseLinksInTemplates: boolean;
		sourcePath: string;
		parseOptions: ParseOptions;
	}): Promise<string> {
		const rawUserInput = params.userInput ?? '';
		const template = params.template ?? '';
		const placeholderRegex = /\{\{\s*\}\}|\{\{\s*@[^}]+\}\}|\{\{\s*user_input\s*\}\}/;

		// 1) Task 层：先做结构化组装
		let assembled: string;
		if (template && template.length > 0) {
			if (placeholderRegex.test(template)) {
				assembled = template.replace(placeholderRegex, rawUserInput);
			} else {
				assembled = `### 任务指令\n${template}\n\n### 用户输入\n${rawUserInput}`;
			}
		} else {
			assembled = rawUserInput;
		}

		// 2) 全局内链解析：按配置决定是否解析模板内链
		if (!params.enableInternalLinkParsing || assembled.trim().length === 0) {
			return assembled;
		}

		if (!params.parseLinksInTemplates && template && template.length > 0) {
			// 仅解析用户输入部分，保持旧行为：模板内容不解析
			const parsedInput = await this.parseInternalLinks(rawUserInput, params.sourcePath, params.parseOptions);
			if (placeholderRegex.test(template)) {
				return template.replace(placeholderRegex, parsedInput);
			}
			return `### 任务指令\n${template}\n\n### 用户输入\n${parsedInput}`;
		}

		return this.parseInternalLinks(assembled, params.sourcePath, params.parseOptions);
	}

	private createEmbedsFromImages(imageBase64Array: string[]): EmbedCache[] {
		return imageBase64Array.map((imageBase64, index) => {
			let mimeType = 'image/png';
			let filename = `image-${index + 1}`;

			if (imageBase64.startsWith('data:')) {
				const mimeMatch = imageBase64.match(/data:([^;]+);/);
				if (mimeMatch) {
					mimeType = mimeMatch[1];
					const extension = this.getExtensionFromMimeType(mimeType);
					filename = `image-${index + 1}.${extension}`;
				}
			}

			return {
				link: filename,
				path: filename,
				[Symbol.for('originalBase64')]: imageBase64,
				[Symbol.for('mimeType')]: mimeType
			} as unknown as EmbedCache;
		});
	}

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

	private async parseInternalLinks(content: string, sourcePath: string, parseOptions: ParseOptions): Promise<string> {
		return this.linkParser.parseLinks(content, sourcePath, parseOptions);
	}

	private async parseContentIfNeeded(content: string, sourcePath: string, options?: PromptBuilderLinkParseOptions): Promise<string> {
		if (!options?.enabled) {
			return content;
		}

		const parseOptions: ParseOptions = {
			enableParsing: true,
			maxDepth: options.maxDepth,
			timeout: options.timeout,
			preserveOriginalOnError: options.preserveOriginalOnError ?? true,
			enableCache: options.enableCache ?? true
		};

		return this.linkParser.parseLinks(content, sourcePath, parseOptions);
	}

	private async parseFilesWithInternalLinks(files: FileContent[], options?: PromptBuilderLinkParseOptions): Promise<FileContent[]> {
		return Promise.all(
			files.map(async (file) => ({
				...file,
				content: await this.parseContentIfNeeded(file.content, file.path, options)
			}))
		);
	}

	private async parseFoldersWithInternalLinks(folders: FolderContent[], options?: PromptBuilderLinkParseOptions): Promise<FolderContent[]> {
		return Promise.all(
			folders.map(async (folder) => ({
				...folder,
				files: await this.parseFilesWithInternalLinks(folder.files, options)
			}))
		);
	}

	/**
	 * 根据文件意图分析结果，生成文件角色指导提示词
	 * 返回空字符串表示不需要额外指导
	 */
	private buildFileRoleGuidance(analysis: FileIntentAnalysis): string {
		// 仅对高置信度的 processing_target 生成指导
		// 其他角色（reference/example/context）使用系统提示词的默认行为
		if (analysis.role !== 'processing_target' || analysis.confidence === 'low') {
			return '';
		}

		return `<file_processing_guidance>
当前任务检测结果：文件为【待处理数据】（置信度：${analysis.confidence === 'high' ? '高' : '中'}）

处理指导：
- 用户提供的文件是需要分析和处理的**核心数据**
- 请立即对文件内容执行提示词要求的任务
- 不要等待用户额外的"请分析"指令
- 直接基于文件内容生成结果

当您收到以下结构时：
<documents>
  <document index="N">
    <source>文件路径</source>
    <document_content>文件内容...</document_content>
  </document>
</documents>

这些内容即是您需要处理的数据，请直接执行任务。
</file_processing_guidance>`;
	}

	/**
	 * 获取文件意图分析器实例（供外部使用）
	 */
	getIntentAnalyzer(): FileIntentAnalyzer {
		return this.intentAnalyzer;
	}
}
