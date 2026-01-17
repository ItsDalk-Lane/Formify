import type { ToolDefinition } from '../types/tools';

interface TaskItem {
	name: string;
	status: 'todo' | 'in_progress' | 'done';
	acceptance_criteria: string[];
	outcome?: string;
}

interface WritePlanArgs {
	tasks: TaskItem[];
}

interface WritePlanResult {
	planTitle: string;
	tasks: TaskItem[];
	summary: {
		total: number;
		todo: number;
		inProgress: number;
		done: number;
	};
	message: string;
}

let currentPlan: { planTitle: string; tasks: TaskItem[] } | null = null;

const validateTask = (task: TaskItem, index: number) => {
	if (!task || typeof task !== 'object') {
		throw new Error(`第 ${index + 1} 个任务无效`);
	}
	if (!String(task.name ?? '').trim()) {
		throw new Error(`第 ${index + 1} 个任务缺少 name`);
	}
	if (!['todo', 'in_progress', 'done'].includes(task.status)) {
		throw new Error(`第 ${index + 1} 个任务 status 非法，仅支持 todo/in_progress/done`);
	}
	if (!Array.isArray(task.acceptance_criteria)) {
		throw new Error(`第 ${index + 1} 个任务 acceptance_criteria 需为数组`);
	}
	if (task.status === 'done' && !String(task.outcome ?? '').trim()) {
		throw new Error(`第 ${index + 1} 个任务 status 为 done 时必须填写 outcome`);
	}
};

const buildPlanMessage = (title: string, tasks: TaskItem[], hasEmptyCriteria: boolean): string => {
	const lines: string[] = [];
	lines.push(`Plan "${title}" updated successfully, Keep track of your progress!`);
	lines.push('');
	lines.push('| # | name | status |');
	lines.push('|---|------|--------|');
	tasks.forEach((task, index) => {
		const criteria = task.acceptance_criteria.length > 0
			? `AC:<br/>- ${task.acceptance_criteria.join('<br/>- ')}`
			: 'AC:<br/>（空）';
		lines.push(`| ${index + 1} | ${task.name}<br/>${criteria} | ${task.status} |`);
	});
	if (hasEmptyCriteria) {
		lines.push('');
		lines.push('提示：部分任务的验收标准为空，建议补充。');
	}
	return lines.join('\n');
};

export const createWritePlanTool = (): ToolDefinition => {
	const now = Date.now();
	return {
		id: 'write_plan',
		name: 'write_plan',
		description: '创建或更新任务执行计划（会完全覆盖现有计划）。',
		enabled: true,
		executionMode: 'auto',
		category: 'planning',
		icon: 'LayoutList',
		parameters: {
			type: 'object',
			properties: {
				tasks: {
					type: 'array',
					description: '任务列表，每个任务包含 name/status/acceptance_criteria/outcome'
				}
			},
			required: ['tasks']
		},
		handler: (rawArgs: Record<string, any>) => {
			const args = rawArgs as WritePlanArgs;
			if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
				throw new Error('tasks 不能为空，且至少包含一个任务');
			}

			args.tasks.forEach(validateTask);

			const planTitle = currentPlan?.planTitle ?? '任务计划';
			currentPlan = {
				planTitle,
				tasks: args.tasks
			};

			const summary = {
				total: args.tasks.length,
				todo: args.tasks.filter((task) => task.status === 'todo').length,
				inProgress: args.tasks.filter((task) => task.status === 'in_progress').length,
				done: args.tasks.filter((task) => task.status === 'done').length
			};

			const hasEmptyCriteria = args.tasks.some((task) => task.acceptance_criteria.length === 0);
			const message = buildPlanMessage(planTitle, args.tasks, hasEmptyCriteria);

			const result: WritePlanResult = {
				planTitle,
				tasks: args.tasks,
				summary,
				message
			};
			return result;
		},
		createdAt: now,
		updatedAt: now
	};
};
