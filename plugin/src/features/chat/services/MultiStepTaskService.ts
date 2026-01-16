import { v4 as uuidv4 } from 'uuid';
import { Notice } from 'obsidian';
import type {
	MultiStepTask,
	MultiStepTaskStatus,
	MultiStepTaskSettings,
	TaskPlan,
	TaskStep,
	TaskStepStatus,
	TaskStatusUpdateEvent
} from '../types/multiStepTask';
import { DEFAULT_MULTI_STEP_TASK_SETTINGS, TASK_ANALYSIS_PROMPT } from '../types/multiStepTask';
import type { ToolDefinition } from '../types/tools';
import { ToolRegistryService } from './ToolRegistryService';

type TaskSubscriber = (task: MultiStepTask | null) => void;
type StatusUpdateSubscriber = (event: TaskStatusUpdateEvent) => void;

/**
 * AI发送请求的函数类型
 */
export type SendAIRequestFunc = (
	prompt: string,
	systemPrompt?: string
) => Promise<string>;

/**
 * 多步骤任务服务
 * 负责任务分析、计划生成和执行管理
 */
export class MultiStepTaskService {
	private settings: MultiStepTaskSettings = DEFAULT_MULTI_STEP_TASK_SETTINGS;
	private currentTask: MultiStepTask | null = null;
	private subscribers: Set<TaskSubscriber> = new Set();
	private statusUpdateSubscribers: Set<StatusUpdateSubscriber> = new Set();
	private abortController: AbortController | null = null;

	constructor(
		private readonly toolRegistry: ToolRegistryService,
		private readonly sendAIRequest: SendAIRequestFunc
	) {}

	/**
	 * 更新设置
	 */
	updateSettings(settings: Partial<MultiStepTaskSettings>) {
		this.settings = { ...this.settings, ...settings };
	}

	/**
	 * 获取当前设置
	 */
	getSettings(): MultiStepTaskSettings {
		return { ...this.settings };
	}

	/**
	 * 订阅任务状态变化
	 */
	subscribe(callback: TaskSubscriber): () => void {
		this.subscribers.add(callback);
		callback(this.currentTask);
		return () => {
			this.subscribers.delete(callback);
		};
	}

	/**
	 * 订阅状态更新事件
	 */
	subscribeStatusUpdate(callback: StatusUpdateSubscriber): () => void {
		this.statusUpdateSubscribers.add(callback);
		return () => {
			this.statusUpdateSubscribers.delete(callback);
		};
	}

	/**
	 * 获取当前任务
	 */
	getCurrentTask(): MultiStepTask | null {
		return this.currentTask ? { ...this.currentTask } : null;
	}

	/**
	 * 判断是否有正在执行的任务
	 */
	isExecuting(): boolean {
		return this.currentTask?.status === 'executing' ||
			this.currentTask?.status === 'analyzing' ||
			this.currentTask?.status === 'planning';
	}

	/**
	 * 开始新的多步骤任务
	 */
	async startTask(
		sessionId: string,
		messageId: string,
		taskDescription: string
	): Promise<MultiStepTask> {
		// 如果有正在执行的任务，先取消
		if (this.isExecuting()) {
			this.cancelTask();
		}

		const taskId = `task-${uuidv4()}`;
		this.currentTask = {
			id: taskId,
			sessionId,
			messageId,
			status: 'analyzing',
			currentStepIndex: -1,
			completedSteps: 0,
			failedSteps: 0,
			startedAt: Date.now()
		};

		this.emitTask();
		this.emitStatusUpdate({
			taskId,
			status: 'analyzing'
		});

		try {
			// 分析任务并生成计划
			const plan = await this.analyzeTask(taskDescription);

			if (!this.currentTask || this.currentTask.id !== taskId) {
				throw new Error('任务已被取消');
			}

			this.currentTask.plan = plan;
			this.currentTask.status = 'confirming';
			this.emitTask();
			this.emitStatusUpdate({
				taskId,
				status: 'confirming'
			});

			return { ...this.currentTask };
		} catch (error) {
			if (this.currentTask?.id === taskId) {
				this.currentTask.status = 'failed';
				this.currentTask.error = error instanceof Error ? error.message : String(error);
				this.currentTask.completedAt = Date.now();
				this.emitTask();
				this.emitStatusUpdate({
					taskId,
					status: 'failed'
				});
			}
			throw error;
		}
	}

	/**
	 * 确认并开始执行任务
	 */
	async confirmAndExecute(): Promise<void> {
		if (!this.currentTask || this.currentTask.status !== 'confirming') {
			throw new Error('没有待确认的任务');
		}

		if (!this.currentTask.plan) {
			throw new Error('任务计划不存在');
		}

		const taskId = this.currentTask.id;
		this.currentTask.status = 'executing';
		this.currentTask.currentStepIndex = 0;
		this.abortController = new AbortController();

		this.emitTask();
		this.emitStatusUpdate({
			taskId,
			status: 'executing',
			currentStepIndex: 0
		});

		try {
			await this.executeSteps();
		} catch (error) {
			if (this.currentTask?.id === taskId && this.currentTask.status !== 'cancelled') {
				this.currentTask.status = 'failed';
				this.currentTask.error = error instanceof Error ? error.message : String(error);
				this.currentTask.completedAt = Date.now();
				this.emitTask();
				this.emitStatusUpdate({
					taskId,
					status: 'failed'
				});
			}
		}
	}

	/**
	 * 取消当前任务
	 */
	cancelTask(): void {
		if (!this.currentTask) return;

		const taskId = this.currentTask.id;
		this.abortController?.abort();
		this.abortController = null;

		this.currentTask.status = 'cancelled';
		this.currentTask.completedAt = Date.now();

		this.emitTask();
		this.emitStatusUpdate({
			taskId,
			status: 'cancelled'
		});
	}

	/**
	 * 暂停任务执行
	 */
	pauseTask(): void {
		if (!this.currentTask || this.currentTask.status !== 'executing') return;

		const taskId = this.currentTask.id;
		this.currentTask.status = 'paused';

		this.emitTask();
		this.emitStatusUpdate({
			taskId,
			status: 'paused'
		});
	}

	/**
	 * 恢复任务执行
	 */
	async resumeTask(): Promise<void> {
		if (!this.currentTask || this.currentTask.status !== 'paused') return;

		const taskId = this.currentTask.id;
		this.currentTask.status = 'executing';
		this.abortController = new AbortController();

		this.emitTask();
		this.emitStatusUpdate({
			taskId,
			status: 'executing',
			currentStepIndex: this.currentTask.currentStepIndex
		});

		try {
			await this.executeSteps();
		} catch (error) {
			if (this.currentTask?.id === taskId && this.currentTask.status !== 'cancelled') {
				this.currentTask.status = 'failed';
				this.currentTask.error = error instanceof Error ? error.message : String(error);
				this.currentTask.completedAt = Date.now();
				this.emitTask();
				this.emitStatusUpdate({
					taskId,
					status: 'failed'
				});
			}
		}
	}

	/**
	 * 清除当前任务
	 */
	clearTask(): void {
		this.currentTask = null;
		this.abortController = null;
		this.emitTask();
	}

	/**
	 * 分析任务并生成计划
	 */
	private async analyzeTask(taskDescription: string): Promise<TaskPlan> {
		const availableTools = this.toolRegistry.listEnabled();
		const toolsDescription = this.formatToolsDescription(availableTools);

		const prompt = TASK_ANALYSIS_PROMPT
			.replace('{{AVAILABLE_TOOLS}}', toolsDescription)
			.replace('{{USER_TASK}}', taskDescription);

		const systemPrompt = '你是一个任务规划专家。请分析用户的任务并生成详细的执行计划。只返回JSON格式的计划，不要包含其他文字。';

		const response = await this.sendAIRequest(prompt, systemPrompt);

		// 解析AI响应
		const plan = this.parsePlanResponse(response, taskDescription);

		return plan;
	}

	/**
	 * 格式化工具描述
	 */
	private formatToolsDescription(tools: ToolDefinition[]): string {
		if (tools.length === 0) {
			return '（暂无可用工具）';
		}

		return tools.map(tool => {
			const params = Object.entries(tool.parameters.properties)
				.map(([name, prop]) => `    - ${name} (${prop.type}): ${prop.description}`)
				.join('\n');
			const required = tool.parameters.required.length > 0
				? `\n  必需参数: ${tool.parameters.required.join(', ')}`
				: '';
			return `- ${tool.name}: ${tool.description}\n  参数:\n${params}${required}`;
		}).join('\n\n');
	}

	/**
	 * 解析AI响应为任务计划
	 */
	private parsePlanResponse(response: string, originalTask: string): TaskPlan {
		// 尝试提取JSON块
		let jsonStr = response;

		// 尝试从代码块中提取
		const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (codeBlockMatch) {
			jsonStr = codeBlockMatch[1].trim();
		} else {
			// 尝试找到JSON对象
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				jsonStr = jsonMatch[0];
			}
		}

		try {
			const parsed = JSON.parse(jsonStr);

			const steps: TaskStep[] = (parsed.steps || []).map((step: any, index: number) => ({
				id: `step-${uuidv4()}`,
				index,
				title: step.title || `步骤 ${index + 1}`,
				description: step.description,
				toolName: step.toolName,
				toolArgs: step.toolArgs || {},
				status: 'pending' as TaskStepStatus,
				dependsOn: step.dependsOn || []
			}));

			// 验证步骤数量
			if (steps.length > this.settings.maxSteps) {
				throw new Error(`任务步骤数量(${steps.length})超过最大限制(${this.settings.maxSteps})`);
			}

			return {
				id: `plan-${uuidv4()}`,
				originalTask,
				analysisSummary: parsed.analysisSummary || '任务分析完成',
				complexity: Math.min(10, Math.max(1, parsed.complexity || 5)),
				estimatedSteps: steps.length,
				steps,
				createdAt: Date.now()
			};
		} catch (error) {
			console.error('[MultiStepTaskService] 解析计划响应失败:', error, '\n响应内容:', response);
			throw new Error(`无法解析任务计划: ${error instanceof Error ? error.message : '格式错误'}`);
		}
	}

	/**
	 * 执行任务步骤
	 */
	private async executeSteps(): Promise<void> {
		if (!this.currentTask?.plan) return;

		const { steps } = this.currentTask.plan;
		const taskId = this.currentTask.id;

		while (this.currentTask.currentStepIndex < steps.length) {
			// 检查是否被取消或暂停
			if (this.abortController?.signal.aborted) {
				break;
			}

			if (this.currentTask.status === 'paused' || this.currentTask.status === 'cancelled') {
				break;
			}

			const stepIndex = this.currentTask.currentStepIndex;
			const step = steps[stepIndex];

			// 更新步骤状态为运行中
			step.status = 'running';
			step.startedAt = Date.now();
			this.emitTask();
			this.emitStatusUpdate({
				taskId,
				status: 'executing',
				currentStepIndex: stepIndex,
				stepResult: {
					stepId: step.id,
					status: 'running'
				}
			});

			try {
				// 执行步骤
				const result = await this.executeStep(step);

				// 更新步骤状态
				step.status = 'completed';
				step.result = result;
				step.completedAt = Date.now();
				this.currentTask.completedSteps++;

				this.emitTask();
				this.emitStatusUpdate({
					taskId,
					status: 'executing',
					currentStepIndex: stepIndex,
					stepResult: {
						stepId: step.id,
						status: 'completed',
						result
					}
				});

			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);

				step.status = 'failed';
				step.error = errorMsg;
				step.completedAt = Date.now();
				this.currentTask.failedSteps++;

				this.emitTask();
				this.emitStatusUpdate({
					taskId,
					status: 'executing',
					currentStepIndex: stepIndex,
					stepResult: {
						stepId: step.id,
						status: 'failed',
						error: errorMsg
					}
				});

				// 如果不允许继续执行，则中断
				if (!this.settings.continueOnError) {
					throw new Error(`步骤 "${step.title}" 执行失败: ${errorMsg}`);
				}

				new Notice(`步骤 "${step.title}" 执行失败，继续执行下一步...`);
			}

			// 移动到下一步
			this.currentTask.currentStepIndex++;
		}

		// 所有步骤执行完成
		if (this.currentTask && this.currentTask.id === taskId &&
			this.currentTask.status === 'executing') {
			this.currentTask.status = 'completed';
			this.currentTask.completedAt = Date.now();
			this.currentTask.resultSummary = this.generateResultSummary();

			this.emitTask();
			this.emitStatusUpdate({
				taskId,
				status: 'completed'
			});
		}
	}

	/**
	 * 执行单个步骤
	 */
	private async executeStep(step: TaskStep): Promise<string> {
		if (!step.toolName) {
			return '步骤不需要执行工具';
		}

		// 创建带超时的Promise
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new Error(`步骤执行超时 (${this.settings.stepTimeout}ms)`));
			}, this.settings.stepTimeout);
		});

		const executePromise = this.toolRegistry.execute(step.toolName, step.toolArgs || {});

		return Promise.race([executePromise, timeoutPromise]);
	}

	/**
	 * 生成结果摘要
	 */
	private generateResultSummary(): string {
		if (!this.currentTask?.plan) return '';

		const { steps } = this.currentTask.plan;
		const completed = steps.filter(s => s.status === 'completed').length;
		const failed = steps.filter(s => s.status === 'failed').length;
		const skipped = steps.filter(s => s.status === 'skipped').length;

		let summary = `任务执行完成。`;
		summary += `\n- 总步骤: ${steps.length}`;
		summary += `\n- 成功: ${completed}`;
		if (failed > 0) summary += `\n- 失败: ${failed}`;
		if (skipped > 0) summary += `\n- 跳过: ${skipped}`;

		return summary;
	}

	/**
	 * 发送任务状态更新
	 */
	private emitTask(): void {
		const snapshot = this.currentTask ? { ...this.currentTask } : null;
		this.subscribers.forEach(callback => callback(snapshot));
	}

	/**
	 * 发送状态更新事件
	 */
	private emitStatusUpdate(event: TaskStatusUpdateEvent): void {
		this.statusUpdateSubscribers.forEach(callback => callback(event));
	}

	/**
	 * 销毁服务
	 */
	dispose(): void {
		this.cancelTask();
		this.subscribers.clear();
		this.statusUpdateSubscribers.clear();
	}
}
