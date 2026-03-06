import { Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../types/chat';
import type { CollaborationTemplate, ParallelResponseEntry, ParallelResponseGroup } from '../types/multiModel';
import type { ChatService, PreparedChatRequest } from './ChatService';
import { MultiModelConfigService } from './MultiModelConfigService';
import { localInstance } from 'src/i18n/locals';

export class MultiModelChatService {
	private static readonly MAX_COMPARE_CONCURRENCY = 5;
	private static readonly STREAM_UPDATE_INTERVAL = 100;
	private readonly abortControllers = new Map<string, AbortController>();
	private readonly pendingResponsePatches = new Map<string, Map<string, Partial<ParallelResponseEntry>>>();
	private readonly pendingFlushTimers = new Map<string, number>();
	private compareStopRequested = false;

	constructor(
		private readonly chatService: ChatService,
		private readonly configService: MultiModelConfigService
	) {}

	async sendCompareMessage(prepared: PreparedChatRequest): Promise<void> {
		this.compareStopRequested = false;
		const session = prepared.session;
		const requestedModelTags = await this.resolveCompareModelTags();
		const modelTags = await this.filterAvailableCompareModels(requestedModelTags, prepared);
		if (modelTags.length === 0) {
			new Notice(localInstance.no_models_selected || '请至少选择一个模型');
			return;
		}

		const parallelGroupId = `compare-${uuidv4()}`;
		const parallelResponses: ParallelResponseGroup = {
			groupId: parallelGroupId,
			userMessageId: prepared.userMessage.id,
			responses: modelTags.map((tag) => ({
				modelTag: tag,
				modelName: this.getModelDisplayName(tag),
				content: '',
				isComplete: false,
				isError: false
			}))
		};

		this.chatService.setErrorState(undefined);
		this.chatService.setParallelResponses(parallelResponses);
		this.chatService.setGeneratingState(true);

		try {
			const results = await this.runWithConcurrency(
				modelTags,
				MultiModelChatService.MAX_COMPARE_CONCURRENCY,
				async (modelTag) => {
					if (this.compareStopRequested) {
						return null;
					}

					const controller = new AbortController();
					this.abortControllers.set(modelTag, controller);

					try {
						const message = await this.chatService.generateAssistantResponseForModel(session, modelTag, {
							abortSignal: controller.signal,
							createMessageInSession: false,
							manageGeneratingState: false,
							onChunk: (_chunk, currentMessage) => {
								this.queueParallelResponseUpdate(parallelGroupId, modelTag, {
									content: currentMessage.content
								});
							}
						});

						message.parallelGroupId = parallelGroupId;
						message.metadata = {
							...(message.metadata ?? {}),
							hiddenFromModel: true
						};

						this.flushQueuedParallelResponseUpdates(parallelGroupId);
						this.applyParallelResponsePatch(parallelGroupId, modelTag, {
							content: message.content,
							isComplete: true,
							isError: false,
							error: undefined,
							errorMessage: undefined,
							messageId: message.id
						});

						return message;
					} catch (error) {
						if (this.isAbortError(error)) {
							this.flushQueuedParallelResponseUpdates(parallelGroupId);
							this.applyParallelResponsePatch(parallelGroupId, modelTag, {
								isComplete: true,
								isError: false,
								error: undefined,
								errorMessage: undefined
							});
							return null;
						}

						const failedMessage = this.createErrorMessage(modelTag, error, {
							parallelGroupId
						});
						this.flushQueuedParallelResponseUpdates(parallelGroupId);
						this.applyParallelResponsePatch(parallelGroupId, modelTag, {
							content: failedMessage.content,
							isComplete: true,
							isError: true,
							error: failedMessage.content,
							errorMessage: failedMessage.content,
							messageId: failedMessage.id
						});
						return failedMessage;
					} finally {
						this.abortControllers.delete(modelTag);
					}
				},
				() => this.compareStopRequested
			);

			session.messages.push(...results);
			session.updatedAt = Date.now();
			this.chatService.notifyStateChange();
			await this.chatService.rewriteSessionMessages(session);

			const failedCount = results.filter((message) => message.isError).length;
			const successCount = results.length - failedCount;
			if (failedCount > 0) {
				new Notice(
					(localInstance.partial_success || '{success}/{total} 个模型响应成功，{failed} 个失败')
						.replace('{success}', String(successCount))
						.replace('{total}', String(results.length))
						.replace('{failed}', String(failedCount))
				);
			}
		} finally {
			this.compareStopRequested = false;
			this.clearPendingParallelUpdates(parallelGroupId);
			this.chatService.clearParallelResponses();
			this.chatService.setGeneratingState(false);
		}
	}

	async sendCollaborateMessage(prepared: PreparedChatRequest): Promise<void> {
		const session = prepared.session;
		const template = await this.resolveActiveCollaborationTemplate();
		if (!template) {
			new Notice('请先选择有效的协作模板。');
			return;
		}

		this.chatService.setErrorState(undefined);
		this.chatService.setGeneratingState(true);

		let previousOutput = '';
		try {
			for (let index = 0; index < template.steps.length; index += 1) {
				const step = template.steps[index];
				const controller = new AbortController();
				const controllerKey = `${step.modelTag}::${index}`;
				this.abortControllers.set(controllerKey, controller);

				try {
					const message = await this.chatService.generateAssistantResponseForModel(session, step.modelTag, {
						abortSignal: controller.signal,
						context: step.passContext ? previousOutput : undefined,
						taskDescription: step.taskDescription,
						executionIndex: index + 1,
						systemPromptOverride: step.systemPromptOverride,
						createMessageInSession: false,
						manageGeneratingState: false
					});
					message.metadata = {
						...(message.metadata ?? {}),
						hiddenFromModel: true
					};
					session.messages.push(message);
					previousOutput = message.content;
					session.updatedAt = Date.now();
					this.chatService.notifyStateChange();

					if (controller.signal.aborted) {
						break;
					}
				} catch (error) {
					const failedMessage = this.createErrorMessage(step.modelTag, error, {
						taskDescription: step.taskDescription,
						executionIndex: index + 1
					});
					session.messages.push(failedMessage);
					session.updatedAt = Date.now();
					this.chatService.notifyStateChange();
				} finally {
					this.abortControllers.delete(controllerKey);
				}
			}

			await this.chatService.rewriteSessionMessages(session);
		} finally {
			this.chatService.setGeneratingState(false);
		}
	}

	stopAllGeneration(): void {
		this.compareStopRequested = true;
		for (const controller of this.abortControllers.values()) {
			controller.abort();
		}
		this.abortControllers.clear();
		this.clearAllPendingParallelUpdates();
		this.chatService.setGeneratingState(false);
	}

	stopModelGeneration(modelTag: string): void {
		for (const [key, controller] of this.abortControllers.entries()) {
			if (key === modelTag || key.startsWith(`${modelTag}::`)) {
				controller.abort();
				this.abortControllers.delete(key);
			}
		}
		if (this.abortControllers.size === 0) {
			this.clearAllPendingParallelUpdates();
			this.chatService.setGeneratingState(false);
		}
	}

	async retryModel(messageId: string): Promise<void> {
		const session = this.chatService.getActiveSession();
		if (!session) {
			return;
		}

		const target = session.messages.find((message) => message.id === messageId);
		if (!target || !target.modelTag) {
			new Notice('未找到可重试的模型消息。');
			return;
		}

		const index = session.messages.findIndex((message) => message.id === messageId);
		if (index === -1) {
			return;
		}

		const replacement = await this.retrySingleMessage(session, target);
		session.messages.splice(index, 1, replacement);
		session.updatedAt = Date.now();
		this.chatService.notifyStateChange();
		await this.chatService.rewriteSessionMessages(session);
	}

	async retryAllFailed(): Promise<void> {
		const session = this.chatService.getActiveSession();
		if (!session) {
			return;
		}

		const failedMessages = session.messages.filter((message) => message.role === 'assistant' && message.isError && message.modelTag);
		if (failedMessages.length > 0) {
			new Notice(
				(localInstance.retrying_failed || '正在重试 {count} 个失败的模型...')
					.replace('{count}', String(failedMessages.length))
			);
		}
		for (const message of failedMessages) {
			await this.retryModel(message.id);
		}
	}

	private async retrySingleMessage(session: NonNullable<ReturnType<ChatService['getActiveSession']>>, target: ChatMessage): Promise<ChatMessage> {
		try {
			const message = await this.chatService.generateAssistantResponseForModel(session, target.modelTag!, {
				taskDescription: target.taskDescription,
				executionIndex: target.executionIndex,
				createMessageInSession: false,
				manageGeneratingState: false
			});

			message.parallelGroupId = target.parallelGroupId;
			message.metadata = {
				...(message.metadata ?? {}),
				hiddenFromModel: true
			};

			return message;
		} catch (error) {
			return this.createErrorMessage(target.modelTag!, error, {
				taskDescription: target.taskDescription,
				executionIndex: target.executionIndex,
				parallelGroupId: target.parallelGroupId
			});
		}
	}

	private async resolveCompareModelTags(): Promise<string[]> {
		const state = this.chatService.getState();
		if (state.activeCompareGroupId) {
			const groups = await this.configService.loadCompareGroups();
			const group = groups.find((item) => item.id === state.activeCompareGroupId);
			if (group?.modelTags.length) {
				return group.modelTags;
			}
		}

		return this.chatService.getSelectedModels();
	}

	private async filterAvailableCompareModels(
		modelTags: string[],
		prepared: PreparedChatRequest
	): Promise<string[]> {
		const uniqueTags = Array.from(new Set(modelTags.filter(Boolean)));
		if (uniqueTags.length === 0) {
			return [];
		}

		if (uniqueTags.length > MultiModelChatService.MAX_COMPARE_CONCURRENCY) {
			new Notice(`已选择 ${uniqueTags.length} 个模型。系统会最多并发 ${MultiModelChatService.MAX_COMPARE_CONCURRENCY} 个请求，建议使用对比组管理常用组合。`, 6000);
		}

		const validTags: string[] = [];
		const missingModels: string[] = [];
		const excludedImageModels: string[] = [];
		const disabledReasoningModels: string[] = [];

		for (const modelTag of uniqueTags) {
			const provider = this.chatService.findProviderByTagExact(modelTag);
			if (!provider) {
				console.warn('[MultiModelChatService] 模型配置不存在，已跳过:', modelTag);
				missingModels.push(modelTag);
				continue;
			}

			if (prepared.isImageGenerationIntent && !this.chatService.isProviderSupportImageGenerationByTag(modelTag)) {
				excludedImageModels.push(this.getModelDisplayName(modelTag));
				continue;
			}

			const ollamaCapabilities = await this.chatService.getOllamaCapabilitiesForModel(modelTag);
			if (ollamaCapabilities && !ollamaCapabilities.supported && ollamaCapabilities.shouldWarn) {
				disabledReasoningModels.push(ollamaCapabilities.modelName);
			}

			validTags.push(modelTag);
		}

		if (missingModels.length > 0) {
			new Notice(`以下模型配置不存在，已跳过: ${missingModels.join(', ')}`, 5000);
		}

		if (excludedImageModels.length > 0) {
			if (excludedImageModels.length === uniqueTags.length) {
				new Notice(localInstance.all_models_excluded || '所有选中的模型都不支持此功能', 5000);
			} else {
				new Notice(
					(localInstance.models_excluded_image || '以下模型不支持图片生成，已排除: {models}')
						.replace('{models}', excludedImageModels.join(', ')),
					7000
				);
			}
		}

		if (disabledReasoningModels.length > 0) {
			new Notice(`以下 Ollama 模型不支持推理，已自动关闭推理能力: ${disabledReasoningModels.join(', ')}`, 5000);
		}

		if (validTags.length === 0 && missingModels.length === uniqueTags.length) {
			new Notice('所有选中的模型都不存在或已失效，已取消发送。', 5000);
		}

		return validTags;
	}

	private async resolveActiveCollaborationTemplate(): Promise<CollaborationTemplate | null> {
		const state = this.chatService.getState();
		if (!state.activeCollaborationTemplateId) {
			return null;
		}
		const templates = await this.configService.loadCollaborationTemplates();
		return templates.find((item) => item.id === state.activeCollaborationTemplateId) ?? null;
	}

	private queueParallelResponseUpdate(groupId: string, modelTag: string, patch: Partial<ParallelResponseEntry>): void {
		const groupBuffer = this.pendingResponsePatches.get(groupId) ?? new Map<string, Partial<ParallelResponseEntry>>();
		const previousPatch = groupBuffer.get(modelTag) ?? {};
		groupBuffer.set(modelTag, {
			...previousPatch,
			...patch
		});
		this.pendingResponsePatches.set(groupId, groupBuffer);

		if (this.pendingFlushTimers.has(groupId)) {
			return;
		}

		const timer = window.setTimeout(() => {
			this.pendingFlushTimers.delete(groupId);
			this.flushQueuedParallelResponseUpdates(groupId);
		}, MultiModelChatService.STREAM_UPDATE_INTERVAL);
		this.pendingFlushTimers.set(groupId, timer);
	}

	private flushQueuedParallelResponseUpdates(groupId: string): void {
		const timer = this.pendingFlushTimers.get(groupId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.pendingFlushTimers.delete(groupId);
		}

		const buffer = this.pendingResponsePatches.get(groupId);
		if (!buffer || buffer.size === 0) {
			return;
		}

		const state = this.chatService.getState();
		const current = state.parallelResponses;
		if (!current || current.groupId !== groupId) {
			this.pendingResponsePatches.delete(groupId);
			return;
		}

		const nextGroup: ParallelResponseGroup = {
			...current,
			responses: current.responses.map((response) => {
				const patch = buffer.get(response.modelTag);
				if (!patch) {
					return response;
				}
				return {
					...response,
					...patch
				};
			})
		};
		this.pendingResponsePatches.delete(groupId);
		this.chatService.setParallelResponses(nextGroup);
	}

	private applyParallelResponsePatch(groupId: string, modelTag: string, patch: Partial<ParallelResponseEntry>): void {
		const state = this.chatService.getState();
		const current = state.parallelResponses;
		if (!current || current.groupId !== groupId) {
			return;
		}

		const nextGroup: ParallelResponseGroup = {
			...current,
			responses: current.responses.map((response) => {
				if (response.modelTag !== modelTag) {
					return response;
				}
				return {
					...response,
					...patch
				};
			})
		};
		this.chatService.setParallelResponses(nextGroup);
	}

	private clearPendingParallelUpdates(groupId: string): void {
		const timer = this.pendingFlushTimers.get(groupId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.pendingFlushTimers.delete(groupId);
		}
		this.pendingResponsePatches.delete(groupId);
	}

	private clearAllPendingParallelUpdates(): void {
		for (const timer of this.pendingFlushTimers.values()) {
			window.clearTimeout(timer);
		}
		this.pendingFlushTimers.clear();
		this.pendingResponsePatches.clear();
	}

	private async runWithConcurrency<TInput, TResult>(
		items: TInput[],
		concurrency: number,
		worker: (item: TInput, index: number) => Promise<TResult | null>,
		shouldStop?: () => boolean
	): Promise<TResult[]> {
		const results = new Array<TResult | null>(items.length).fill(null);
		let cursor = 0;
		const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (cursor < items.length) {
				if (shouldStop?.()) {
					return;
				}
				const currentIndex = cursor;
				cursor += 1;
				if (shouldStop?.()) {
					return;
				}
				results[currentIndex] = await worker(items[currentIndex], currentIndex);
			}
		});
		await Promise.all(runners);
		return results.filter((item): item is TResult => item !== null);
	}

	private isAbortError(error: unknown): boolean {
		if (error instanceof DOMException && error.name === 'AbortError') {
			return true;
		}
		if (error instanceof Error) {
			return error.name === 'AbortError';
		}
		return false;
	}

	private createErrorMessage(
		modelTag: string,
		error: unknown,
		extras?: {
			taskDescription?: string;
			executionIndex?: number;
			parallelGroupId?: string;
		}
	): ChatMessage {
		const errorMessage = error instanceof Error ? error.message : `生成过程中发生未知错误: ${String(error)}`;
		return {
			id: `chat-${uuidv4()}`,
			role: 'assistant',
			content: errorMessage,
			timestamp: Date.now(),
			isError: true,
			modelTag,
			modelName: this.getModelDisplayName(modelTag),
			taskDescription: extras?.taskDescription,
			executionIndex: extras?.executionIndex,
			parallelGroupId: extras?.parallelGroupId,
			metadata: {
				hiddenFromModel: true
			}
		};
	}

	private getModelDisplayName(modelTag: string): string {
		const provider = this.chatService.findProviderByTagExact(modelTag);
		return provider?.options.model || provider?.tag || modelTag;
	}
}
