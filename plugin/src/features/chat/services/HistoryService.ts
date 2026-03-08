import { App, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import {
	clonePlanSnapshot,
	type PlanSnapshot,
	type PlanTaskStatus,
} from 'src/builtin-mcp/runtime/plan-state';
import type { ChatMessage, ChatRole, ChatSession, SelectedFile, SelectedFolder } from '../types/chat';
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
const PLAN_PROGRESS_RANK: Record<PlanTaskStatus, number> = {
	todo: 0,
	in_progress: 1,
	done: 2,
	skipped: 2,
};

export class HistoryService {
	private folderPath: string;
	private readonly messageService: MessageService;

	constructor(private readonly app: App, initialFolder: string) {
		this.folderPath = initialFolder;
		this.messageService = new MessageService(app);
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
	 * 解析时间戳（支持数字和字符串格式）
	 */
	private parseTimestamp(value: unknown): number {
		if (typeof value === 'number') return value;
		if (typeof value === 'string' && value.trim()) {
			// 尝试解析 YYYY-MM-DD HH:mm:ss 格式
			const match = value.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
			if (match) {
				const [_, year, month, day, hour, minute, second] = match.map(Number);
				return new Date(year, month - 1, day, hour, minute, second).getTime();
			}
		}
		return 0;
	}

	private parseBoolean(value: unknown, fallback = false): boolean {
		if (typeof value === 'boolean') return value;
		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase();
			if (normalized === 'true') return true;
			if (normalized === 'false') return false;
		}
		return fallback;
	}

	private parseOptionalString(value: unknown): string | undefined {
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
	}

	private parseMultiModelMode(value: unknown): ChatSession['multiModelMode'] {
		if (value === 'compare' || value === 'single') {
			return value;
		}
		if (value === 'collaborate') {
			return 'single';
		}
		return undefined;
	}

	private parseLayoutMode(value: unknown): ChatSession['layoutMode'] {
		return value === 'horizontal' || value === 'tabs' || value === 'vertical'
			? value
			: undefined;
	}

	private isPlanTaskStatus(value: unknown): value is PlanTaskStatus {
		return (
			value === 'todo'
			|| value === 'in_progress'
			|| value === 'done'
			|| value === 'skipped'
		);
	}

	private parsePlanSnapshot(value: unknown): PlanSnapshot | null {
		if (!value || typeof value !== 'object') {
			return null;
		}

		const candidate = value as Record<string, unknown>;
		if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
			return null;
		}

		if (!Array.isArray(candidate.tasks) || !candidate.summary || typeof candidate.summary !== 'object') {
			return null;
		}

		const tasks = candidate.tasks
			.map((task) => {
				if (!task || typeof task !== 'object') {
					return null;
				}

				const item = task as Record<string, unknown>;
				if (typeof item.name !== 'string' || !this.isPlanTaskStatus(item.status)) {
					return null;
				}

				return {
					name: item.name,
					status: item.status,
					acceptance_criteria: Array.isArray(item.acceptance_criteria)
						? item.acceptance_criteria
							.filter((criteria): criteria is string => typeof criteria === 'string')
						: [],
					...(typeof item.outcome === 'string' ? { outcome: item.outcome } : {}),
				};
			})
			.filter((task): task is PlanSnapshot['tasks'][number] => task !== null);

		const summary = candidate.summary as Record<string, unknown>;
		const summaryValues = {
			total: Number(summary.total),
			todo: Number(summary.todo),
			inProgress: Number(summary.inProgress),
			done: Number(summary.done),
			skipped: Number(summary.skipped),
		};

		if (Object.values(summaryValues).some((item) => !Number.isFinite(item))) {
			return null;
		}

		return clonePlanSnapshot({
			title: candidate.title.trim(),
			...(typeof candidate.description === 'string' && candidate.description.trim()
				? { description: candidate.description.trim() }
				: {}),
			tasks,
			summary: summaryValues,
		});
	}

	private extractLatestPlanSnapshot(messages: ChatMessage[]): PlanSnapshot | null {
		for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
			const toolCalls = messages[messageIndex].toolCalls ?? [];
			for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
				const call = toolCalls[toolIndex];
				if (call.name !== 'write_plan' || typeof call.result !== 'string' || !call.result.trim()) {
					continue;
				}
				try {
					const parsed = JSON.parse(call.result);
					const snapshot = this.parsePlanSnapshot(parsed);
					if (snapshot) {
						return snapshot;
					}
				} catch {
					continue;
				}
			}
		}

		return null;
	}

	private arePlansComparable(
		left: PlanSnapshot | null,
		right: PlanSnapshot | null
	): left is PlanSnapshot & {} {
		if (!left || !right) {
			return false;
		}

		if (left.title !== right.title || left.tasks.length !== right.tasks.length) {
			return false;
		}

		return left.tasks.every(
			(task, index) =>
				task.name === right.tasks[index]?.name
				&& task.acceptance_criteria.length === right.tasks[index]?.acceptance_criteria.length
				&& task.acceptance_criteria.every(
					(criteria, criteriaIndex) =>
						criteria === right.tasks[index]?.acceptance_criteria[criteriaIndex]
				)
		);
	}

	private isPlanAhead(candidate: PlanSnapshot, baseline: PlanSnapshot): boolean {
		let hasForwardProgress = false;

		for (let index = 0; index < candidate.tasks.length; index += 1) {
			const candidateRank = PLAN_PROGRESS_RANK[candidate.tasks[index].status];
			const baselineRank = PLAN_PROGRESS_RANK[baseline.tasks[index].status];
			if (candidateRank < baselineRank) {
				return false;
			}
			if (candidateRank > baselineRank) {
				hasForwardProgress = true;
			}
		}

		return hasForwardProgress;
	}

	private resolveLivePlan(
		persistedPlan: PlanSnapshot | null,
		messagePlan: PlanSnapshot | null
	): PlanSnapshot | null {
		if (!persistedPlan) {
			return messagePlan;
		}
		if (!messagePlan) {
			return persistedPlan;
		}

		if (JSON.stringify(persistedPlan) === JSON.stringify(messagePlan)) {
			return persistedPlan;
		}

		if (!this.arePlansComparable(persistedPlan, messagePlan)) {
			return persistedPlan;
		}

		if (this.isPlanAhead(messagePlan, persistedPlan)) {
			return clonePlanSnapshot(messagePlan);
		}

		return persistedPlan;
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
							createdAt: this.parseTimestamp(frontmatter.created ?? child.stat.ctime),
							updatedAt: this.parseTimestamp(frontmatter.updated ?? child.stat.mtime)
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
				const existingContent = await this.app.vault.read(file);
				if (
					existingContent.includes('FF_TOOL_CALLS_BASE64') ||
					existingContent.includes('FF_TOOL_CALLS_BLOCK_START') ||
					existingContent.includes('工具调用 {{FF_TOOL_CALLS}}')
				) {
					await this.rewriteMessagesOnly(session.filePath, session.messages);
				}
				await this.updateFileFrontmatter(file, {
					title: session.title,
					model: session.modelId,
					created: this.formatTimestamp(session.createdAt),
					updated: this.formatTimestamp(session.updatedAt),
					messageCount: session.messages.length,
					contextNotes: session.contextNotes ?? [],
					enableTemplateAsSystemPrompt: session.enableTemplateAsSystemPrompt ?? false,
					multiModelMode: session.multiModelMode ?? 'single',
					activeCompareGroupId: session.activeCompareGroupId,
					layoutMode: session.layoutMode,
					livePlan: clonePlanSnapshot(session.livePlan ?? null),
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
			contextNotes: session.contextNotes ?? [],
			enableTemplateAsSystemPrompt: session.enableTemplateAsSystemPrompt ?? false,
			multiModelMode: session.multiModelMode ?? 'single',
			activeCompareGroupId: session.activeCompareGroupId,
			layoutMode: session.layoutMode,
			livePlan: clonePlanSnapshot(session.livePlan ?? null),
		});

		const body = session.messages.map((message) => this.messageService.serializeMessage(message)).join('\n\n');
		const content = `${FRONTMATTER_DELIMITER}
${frontmatter}${FRONTMATTER_DELIMITER}

${body}
`;

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
			const persistedPlan = this.parsePlanSnapshot(frontmatter.livePlan);
			const messagePlan = this.extractLatestPlanSnapshot(messages);
			const session: ChatSession = {
				id: frontmatter.id as string,
				title: (frontmatter.title as string) ?? file.basename,
				modelId: (frontmatter.model as string) ?? '',
				messages,
				contextNotes: (frontmatter.contextNotes as string[]) ?? [],
				createdAt: this.parseTimestamp(frontmatter.created ?? file.stat.ctime),
				updatedAt: this.parseTimestamp(frontmatter.updated ?? file.stat.mtime),
				selectedImages: [],
				enableTemplateAsSystemPrompt: this.parseBoolean(frontmatter.enableTemplateAsSystemPrompt, false),
				multiModelMode: this.parseMultiModelMode(frontmatter.multiModelMode),
				activeCompareGroupId: this.parseOptionalString(frontmatter.activeCompareGroupId),
				layoutMode: this.parseLayoutMode(frontmatter.layoutMode),
				livePlan: this.resolveLivePlan(persistedPlan, messagePlan),
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
			contextNotes: session.contextNotes ?? [],
			enableTemplateAsSystemPrompt: session.enableTemplateAsSystemPrompt ?? false,
			multiModelMode: session.multiModelMode ?? 'single',
			activeCompareGroupId: session.activeCompareGroupId,
			layoutMode: session.layoutMode,
			livePlan: clonePlanSnapshot(session.livePlan ?? null),
		});

		// 创建文件，只包含frontmatter，不包含任何消息
		const content = `${FRONTMATTER_DELIMITER}\n${frontmatter}${FRONTMATTER_DELIMITER}\n\n`;

		await this.app.vault.create(finalFilePath, content);
		return finalFilePath;
	}

	async appendMessageToFile(
		filePath: string, 
		message: ChatMessage, 
		selectedFiles?: SelectedFile[], 
		selectedFolders?: SelectedFolder[]
	): Promise<void> {
		if (!filePath) {
			throw new Error('文件路径为空，无法追加消息');
		}
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		// 读取当前文件内容
		const currentContent = await this.app.vault.read(file);
		
		// 序列化新消息，但不重复添加文件和文件夹信息（因为已经在消息内容中了）
		const serializedMessage = this.messageService.serializeMessage(message);
		
		// 追加新消息到文件末尾
		const newContent = currentContent.trimEnd() + '\n\n' + serializedMessage + '\n';
		
		// 更新文件内容
		await this.app.vault.modify(file, newContent);
		
		// 更新frontmatter中的updated时间和文件/文件夹信息
		await this.updateFileTimestamp(file, Date.now(), selectedFiles, selectedFolders);
	}

	async createNewSessionFileWithFirstMessage(
		session: ChatSession, 
		firstMessage: ChatMessage, 
		selectedFiles?: SelectedFile[], 
		selectedFolders?: SelectedFolder[]
	): Promise<string> {
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
		
		// 如果第一条消息是系统消息且内容为空，使用默认标题
		if (firstMessage.role === 'system' && !title) {
			title = '新对话';
		}
		
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
		
		// 创建文件和文件夹标签数组
		const fileTags = selectedFiles ? selectedFiles.map(file => `[[${file.name}]]`) : []; // 只使用文件名，不使用路径
		const folderTags = selectedFolders ? selectedFolders.map(folder => folder.path) : []; // 不添加#符号
		const allTags = [...fileTags, ...folderTags];
		
		// 更新contextNotes，添加文件和文件夹标签
		const updatedContextNotes = [...(session.contextNotes || []), ...allTags];
		
		const frontmatter = stringifyYaml({
			id: session.id,
			title: title, // 使用清理后的标题
			model: session.modelId,
			created: this.formatTimestamp(session.createdAt),
			updated: this.formatTimestamp(session.updatedAt),
			messageCount: 1, // 第一条消息
			contextNotes: updatedContextNotes,
			enableTemplateAsSystemPrompt: session.enableTemplateAsSystemPrompt ?? false,
			multiModelMode: session.multiModelMode ?? 'single',
			activeCompareGroupId: session.activeCompareGroupId,
			layoutMode: session.layoutMode,
			livePlan: clonePlanSnapshot(session.livePlan ?? null),
		});

		// 序列化第一条消息，但不重复添加文件和文件夹信息（因为已经在消息内容中了）
		const serializedMessage = this.messageService.serializeMessage(firstMessage);
		
		// 创建文件，包含frontmatter和第一条消息
		const content = `${FRONTMATTER_DELIMITER}
${frontmatter}${FRONTMATTER_DELIMITER}

${serializedMessage}
`;

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
		const newContent = `${FRONTMATTER_DELIMITER}
${newFrontmatter}${FRONTMATTER_DELIMITER}

${body}
`;
		
		// 更新文件
		await this.app.vault.modify(file, newContent);
	}

	private async updateFileTimestamp(
		file: TFile, 
		timestamp: number, 
		selectedFiles?: SelectedFile[], 
		selectedFolders?: SelectedFolder[]
	): Promise<void> {
		// 创建文件和文件夹标签数组
		const fileTags = selectedFiles ? selectedFiles.map(file => `[[${file.name}]]`) : []; // 只使用文件名，不使用路径
		const folderTags = selectedFolders ? selectedFolders.map(folder => folder.path) : []; // 不添加#符号
		const allTags = [...fileTags, ...folderTags];
		
		// 准备更新对象
		const updates: Record<string, unknown> = {
			updated: this.formatTimestamp(timestamp)
		};
		
		// 如果有文件或文件夹标签，更新contextNotes
		if (allTags.length > 0) {
			// 读取当前frontmatter
			const content = await this.app.vault.read(file);
			const { frontmatter } = this.extractFrontmatter(content);
			
			if (frontmatter) {
				// 获取现有的contextNotes
				const existingContextNotes = (frontmatter.contextNotes as string[]) || [];
				// 添加新的标签
				const updatedContextNotes = [...existingContextNotes, ...allTags];
				updates.contextNotes = updatedContextNotes;
			}
		}
		
		await this.updateFileFrontmatter(file, updates);
	}

		async updateSessionFrontmatter(filePath: string, updates: Record<string, unknown>): Promise<void> {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				throw new Error(`文件不存在: ${filePath}`);
			}
			await this.updateFileFrontmatter(file, updates);
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
		
		// 支持单模型格式：# AI (时间)
		// 以及多模型格式：# AI [model-tag] (时间)
		// 只在行首的消息头部处分割，避免消息内容中的Markdown标题导致截断
		const messageHeaderRegex = /^#\s+(用户|AI|系统)(?:\s+\[([^\]]+)\])?\s*(?:\(([^)]+)\))?\s*$/gm;
		
		// 找到所有消息头部的位置
		const headerMatches: { index: number; header: string; role: ChatRole; timestampStr: string; modelTag?: string }[] = [];
		let match;
		
		while ((match = messageHeaderRegex.exec(body)) !== null) {
			const roleLabel = match[1]?.trim() ?? '';
			const modelTag = match[2]?.trim() ?? '';
			const timestampStr = match[3]?.trim() ?? '';
			
			let role: ChatRole;
			if (roleLabel === 'AI') {
				role = 'assistant';
			} else if (roleLabel === '系统') {
				role = 'system';
			} else {
				role = 'user';
			}
			
			headerMatches.push({
				index: match.index,
				header: match[0],
				role,
				timestampStr,
				modelTag: modelTag || undefined
			});
		}
		
		// 根据头部位置提取每条消息的内容
		for (let i = 0; i < headerMatches.length; i++) {
			const currentHeader = headerMatches[i];
			const nextHeader = headerMatches[i + 1];
			
			// 计算内容的起始位置（头部之后）
			const contentStart = currentHeader.index + currentHeader.header.length;
			// 计算内容的结束位置（下一个头部之前，或文本末尾）
			const contentEnd = nextHeader ? nextHeader.index : body.length;
			
			// 提取内容并去除首尾空白
			let content = body.substring(contentStart, contentEnd).trim();

			// 移除历史文件中的 Agent 事件流标记（避免展示原始数据）
			content = content.replace(/<!-- FF_AGENT_EVENTS_START -->[\s\S]*?<!-- FF_AGENT_EVENTS_END -->\n?/g, '').trim();

			// 将历史文件中的 callout 格式转换回推理标记格式
			content = this.messageService.parseReasoningBlocksFromHistory(content);

			const extracted = this.messageService.extractToolCallsFromHistory(content);
			content = extracted.content;

			// 将历史文件中的 MCP 工具 callout 格式转换回标记格式
			content = this.messageService.parseMcpToolBlocksFromHistory(content);

			// 清理转换后可能产生的多余空行（将3个或以上的连续换行缩减为2个）
			content = content.replace(/\n{3,}/g, '\n\n').trim();
			
			// 尝试解析时间戳
			let timestamp = Date.now();
			if (currentHeader.timestampStr) {
				try {
					const dateMatch = currentHeader.timestampStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
					if (dateMatch) {
						const [_, year, month, day, hour, minute, second] = dateMatch.map(Number);
						timestamp = new Date(year, month - 1, day, hour, minute, second).getTime();
					}
				} catch (e) {
					console.warn('[HistoryService] 无法解析时间戳:', currentHeader.timestampStr, e);
				}
			}
			
			let taskDescription: string | undefined;
			const taskDescriptionMatch = content.match(/\n\n> 任务:\s*(.+)$/m);
			if (taskDescriptionMatch?.[1]) {
				taskDescription = taskDescriptionMatch[1].trim();
				content = content.replace(/\n\n> 任务:\s*.+$/m, '').trim();
			}

			let modelName: string | undefined;
			const modelNameMatch = content.match(/\n\n> 模型名称:\s*(.+)$/m);
			if (modelNameMatch?.[1]) {
				modelName = modelNameMatch[1].trim();
				content = content.replace(/\n\n> 模型名称:\s*.+$/m, '').trim();
			}

			let executionIndex: number | undefined;
			const executionIndexMatch = content.match(/\n\n> 执行序号:\s*(\d+)$/m);
			if (executionIndexMatch?.[1]) {
				executionIndex = Number(executionIndexMatch[1]);
				content = content.replace(/\n\n> 执行序号:\s*\d+$/m, '').trim();
			}

			let parallelGroupId: string | undefined;
			const parallelGroupMatch = content.match(/\n\n> 对比组:\s*(.+)$/m);
			if (parallelGroupMatch?.[1]) {
				parallelGroupId = parallelGroupMatch[1].trim();
				content = content.replace(/\n\n> 对比组:\s*.+$/m, '').trim();
			}

			let isError = false;
			if (content.startsWith('[错误]')) {
				isError = true;
				content = content.replace(/^\[错误\]\s*/, '').trim();
			}

			// 处理图片引用
			let images: string[] = [];
			const imageMatches = content.matchAll(/!\[Image \d+\]\(([^)]+)\)/g);
			for (const imgMatch of imageMatches) {
				if (imgMatch[1]) {
					images.push(imgMatch[1]);
				}
			}
			
			// 从内容中移除图片引用
			content = content.replace(/!\[Image \d+\]\([^)]+\)\n?/g, '').trim();
			
			// 创建消息对象
			const message = this.messageService.createMessage(currentHeader.role, content, {
				timestamp,
				images,
				modelTag: currentHeader.modelTag,
				modelName: modelName ?? currentHeader.modelTag,
				taskDescription,
				executionIndex,
				parallelGroupId,
				isError,
				toolCalls: extracted.toolCalls,
				metadata: {
					hiddenFromModel: currentHeader.role === 'assistant' && Boolean(parallelGroupId),
					originalHeader: currentHeader.header.trim(),
					originalTimestamp: currentHeader.timestampStr
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
			let currentModelTag: string | undefined;
			let inMessage = false;
			
			for (const line of lines) {
				// 检查是否为消息头部
				const headerLineMatch = line.match(/^#\s+(用户|AI|系统)(?:\s+\[([^\]]+)\])?\s*(?:\(([^)]+)\))?\s*$/);
				if (headerLineMatch) {
					// 保存前一条消息
					if (inMessage && currentMessage.trim()) {
						let content = currentMessage.trim();

						// 移除历史文件中的 Agent 事件流标记
						content = content.replace(/<!-- FF_AGENT_EVENTS_START -->[\s\S]*?<!-- FF_AGENT_EVENTS_END -->\n?/g, '').trim();

						// 将历史文件中的 callout 格式转换回推理标记格式
						content = this.messageService.parseReasoningBlocksFromHistory(content);
						const extracted = this.messageService.extractToolCallsFromHistory(content);
						content = extracted.content;
						// 将历史文件中的 MCP 工具 callout 格式转换回标记格式
						content = this.messageService.parseMcpToolBlocksFromHistory(content);
						// 清理转换后可能产生的多余空行
						content = content.replace(/\n{3,}/g, '\n\n').trim();

						const message = this.messageService.createMessage(currentRole, content, {
							timestamp: currentTimestamp,
							modelTag: currentModelTag,
							modelName: currentModelTag,
							toolCalls: extracted.toolCalls
						});

						messages.push(message);
					}
					
					// 开始新消息
					const roleLabel = headerLineMatch[1]?.trim() ?? '';
					if (roleLabel === 'AI') {
						currentRole = 'assistant';
					} else if (roleLabel === '系统') {
						currentRole = 'system';
					} else {
						currentRole = 'user';
					}
					currentModelTag = headerLineMatch[2]?.trim() || undefined;
					
					currentMessage = '';
					inMessage = true;
				} else if (inMessage) {
					currentMessage += line + '\n';
				}
			}
			
			// 保存最后一条消息
			if (inMessage && currentMessage.trim()) {
				let content = currentMessage.trim();
				// 将历史文件中的 callout 格式转换回推理标记格式
				content = this.messageService.parseReasoningBlocksFromHistory(content);
				// 将历史文件中的 MCP 工具 callout 格式转换回标记格式
				content = this.messageService.parseMcpToolBlocksFromHistory(content);
				// 清理转换后可能产生的多余空行
				content = content.replace(/\n{3,}/g, '\n\n').trim();
				messages.push(this.messageService.createMessage(currentRole, content, {
					timestamp: currentTimestamp,
					modelTag: currentModelTag,
					modelName: currentModelTag
				}));
			}
		}
		
		return messages;
	}
}
