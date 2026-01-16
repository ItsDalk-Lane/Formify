/**
 * 多步骤任务类型定义
 * 用于AI自动分析任务并逐步执行
 */

/**
 * 任务步骤状态
 */
export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 任务整体状态
 */
export type MultiStepTaskStatus =
	| 'idle'           // 空闲
	| 'analyzing'      // 正在分析任务
	| 'planning'       // 正在制定计划
	| 'confirming'     // 等待用户确认
	| 'executing'      // 正在执行
	| 'paused'         // 暂停
	| 'completed'      // 完成
	| 'failed'         // 失败
	| 'cancelled';     // 已取消

/**
 * 任务步骤定义
 */
export interface TaskStep {
	id: string;
	/** 步骤序号 */
	index: number;
	/** 步骤标题/描述 */
	title: string;
	/** 详细描述 */
	description?: string;
	/** 要执行的工具名称 */
	toolName?: string;
	/** 工具参数 */
	toolArgs?: Record<string, any>;
	/** 步骤状态 */
	status: TaskStepStatus;
	/** 执行结果 */
	result?: string;
	/** 错误信息 */
	error?: string;
	/** 开始时间 */
	startedAt?: number;
	/** 完成时间 */
	completedAt?: number;
	/** 依赖的步骤ID列表 */
	dependsOn?: string[];
}

/**
 * 任务计划
 */
export interface TaskPlan {
	/** 计划ID */
	id: string;
	/** 原始任务描述 */
	originalTask: string;
	/** 任务分析摘要 */
	analysisSummary: string;
	/** 任务复杂度评估 (1-10) */
	complexity: number;
	/** 预估总步骤数 */
	estimatedSteps: number;
	/** 步骤列表 */
	steps: TaskStep[];
	/** 创建时间 */
	createdAt: number;
}

/**
 * 多步骤任务
 */
export interface MultiStepTask {
	/** 任务ID */
	id: string;
	/** 会话ID */
	sessionId: string;
	/** 消息ID (关联到用户的请求消息) */
	messageId: string;
	/** 任务状态 */
	status: MultiStepTaskStatus;
	/** 任务计划 */
	plan?: TaskPlan;
	/** 当前执行的步骤索引 */
	currentStepIndex: number;
	/** 已完成的步骤数 */
	completedSteps: number;
	/** 失败的步骤数 */
	failedSteps: number;
	/** 开始时间 */
	startedAt: number;
	/** 完成时间 */
	completedAt?: number;
	/** 错误信息 */
	error?: string;
	/** 最终结果摘要 */
	resultSummary?: string;
}

/**
 * 多步骤任务模式设置
 */
export interface MultiStepTaskSettings {
	/** 是否启用多步骤任务模式 */
	enabled: boolean;
	/** 是否自动执行（不需要用户确认每个步骤） */
	autoExecute: boolean;
	/** 执行失败时是否继续 */
	continueOnError: boolean;
	/** 最大步骤数限制 */
	maxSteps: number;
	/** 单个步骤超时时间（毫秒） */
	stepTimeout: number;
}

/**
 * 默认多步骤任务设置
 */
export const DEFAULT_MULTI_STEP_TASK_SETTINGS: MultiStepTaskSettings = {
	enabled: false,
	autoExecute: true,
	continueOnError: false,
	maxSteps: 20,
	stepTimeout: 60000
};

/**
 * 任务分析提示词模板
 */
export const TASK_ANALYSIS_PROMPT = `你是一个任务分析助手。用户将给你一个任务描述，请分析这个任务并制定执行计划。

请严格按照以下JSON格式返回任务计划（不要包含任何其他文字）：

\`\`\`json
{
  "analysisSummary": "对任务的简短分析",
  "complexity": 5,
  "steps": [
    {
      "title": "步骤标题",
      "description": "详细描述",
      "toolName": "工具名称",
      "toolArgs": {
        "参数名": "参数值"
      }
    }
  ]
}
\`\`\`

可用的工具：
{{AVAILABLE_TOOLS}}

注意事项：
1. 复杂度评分范围是1-10，1表示最简单，10表示最复杂
2. 每个步骤都应该是可执行的具体操作
3. toolName必须是可用工具列表中的工具名称
4. toolArgs必须符合对应工具的参数要求
5. 步骤之间可以有依赖关系，但要确保依赖的步骤排在前面
6. 文件路径应该相对于vault根目录
7. 如果任务涉及创建文件夹，请使用 create_folder 工具
8. 如果任务涉及创建文件，请使用 write_file 工具

用户任务：
{{USER_TASK}}`;

/**
 * 任务执行状态更新事件
 */
export interface TaskStatusUpdateEvent {
	taskId: string;
	status: MultiStepTaskStatus;
	currentStepIndex?: number;
	stepResult?: {
		stepId: string;
		status: TaskStepStatus;
		result?: string;
		error?: string;
	};
}
