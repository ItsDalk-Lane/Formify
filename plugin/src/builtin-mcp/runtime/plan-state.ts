export type PlanTaskStatus = 'todo' | 'in_progress' | 'done' | 'skipped';

export interface PlanTaskInput {
	name: string;
	status: PlanTaskStatus;
	acceptance_criteria?: string[];
	outcome?: string;
}

export interface PlanTask {
	name: string;
	status: PlanTaskStatus;
	acceptance_criteria: string[];
	outcome?: string;
}

export interface PlanSnapshot {
	title: string;
	description?: string;
	tasks: PlanTask[];
	summary: {
		total: number;
		todo: number;
		inProgress: number;
		done: number;
		skipped: number;
	};
}

export interface PlanUpdateInput {
	title?: string;
	description?: string;
	tasks: PlanTaskInput[];
}

export type PlanStateListener = (snapshot: PlanSnapshot | null) => void;

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const normalizeTask = (task: PlanTaskInput, index: number): PlanTask => {
	const name = normalizeText(task.name);
	if (!name) {
		throw new Error(`第 ${index + 1} 个任务缺少 name`);
	}

	const status = task.status;
	if (!['todo', 'in_progress', 'done', 'skipped'].includes(status)) {
		throw new Error(`第 ${index + 1} 个任务 status 非法`);
	}

	const acceptance_criteria = Array.isArray(task.acceptance_criteria)
		? task.acceptance_criteria
				.map((item) => normalizeText(item))
				.filter((item) => !!item)
		: [];

	const outcome = normalizeText(task.outcome);
	if ((status === 'done' || status === 'skipped') && !outcome) {
		throw new Error(`第 ${index + 1} 个任务 status 为 ${status} 时 outcome 必填`);
	}

	return {
		name,
		status,
		acceptance_criteria,
		...(outcome ? { outcome } : {}),
	};
};

const createSummary = (tasks: PlanTask[]): PlanSnapshot['summary'] => {
	const summary = {
		total: tasks.length,
		todo: 0,
		inProgress: 0,
		done: 0,
		skipped: 0,
	};

	for (const task of tasks) {
		if (task.status === 'todo') summary.todo += 1;
		if (task.status === 'in_progress') summary.inProgress += 1;
		if (task.status === 'done') summary.done += 1;
		if (task.status === 'skipped') summary.skipped += 1;
	}

	return summary;
};

export const clonePlanSnapshot = (
	snapshot: PlanSnapshot | null
): PlanSnapshot | null => {
	if (!snapshot) {
		return null;
	}

	return {
		...snapshot,
		tasks: snapshot.tasks.map((task) => ({
			...task,
			acceptance_criteria: [...task.acceptance_criteria],
		})),
		summary: { ...snapshot.summary },
	};
};

export class PlanState {
	private snapshot: PlanSnapshot | null = null;
	private listeners = new Set<PlanStateListener>();

	get(): PlanSnapshot | null {
		return clonePlanSnapshot(this.snapshot);
	}

	update(input: PlanUpdateInput): PlanSnapshot {
		if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
			throw new Error('tasks 不能为空');
		}

		const normalizedTasks = input.tasks.map((task, index) => normalizeTask(task, index));
		const inProgressCount = normalizedTasks.filter(
			(task) => task.status === 'in_progress'
		).length;

		if (inProgressCount > 1) {
			throw new Error('同一时间只能有一个 in_progress 任务');
		}

		const title = normalizeText(input.title) || this.snapshot?.title || '';
		if (!title) {
			throw new Error('创建计划时 title 必填');
		}

		const nextTasks = normalizedTasks;
		const description = normalizeText(input.description) || this.snapshot?.description;

		this.snapshot = {
			title,
			...(description ? { description } : {}),
			tasks: nextTasks,
			summary: createSummary(nextTasks),
		};

		const snapshot = this.get() as PlanSnapshot;
		this.emit(snapshot);
		return snapshot;
	}

	reset(): void {
		this.snapshot = null;
		this.emit(null);
	}

	restore(snapshot: PlanSnapshot | null): PlanSnapshot | null {
		if (!snapshot) {
			this.reset();
			return null;
		}

		return this.update({
			title: snapshot.title,
			description: snapshot.description,
			tasks: snapshot.tasks.map((task) => ({
				name: task.name,
				status: task.status,
				acceptance_criteria: [...task.acceptance_criteria],
				outcome: task.outcome,
			})),
		});
	}

	subscribe(listener: PlanStateListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(snapshot: PlanSnapshot | null): void {
		for (const listener of this.listeners) {
			listener(clonePlanSnapshot(snapshot));
		}
	}
}
