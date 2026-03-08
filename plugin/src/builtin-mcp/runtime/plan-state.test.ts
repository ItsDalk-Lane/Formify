import {
	clonePlanSnapshot,
	type PlanSnapshot,
	PlanState,
} from './plan-state';

describe('PlanState', () => {
	const snapshot: PlanSnapshot = {
		title: '实现任务面板',
		description: '把计划同步到 Chat 界面',
		tasks: [
			{
				name: '补 UI',
				status: 'todo',
				acceptance_criteria: ['显示任务列表'],
			},
			{
				name: '接桥接',
				status: 'in_progress',
				acceptance_criteria: ['write_plan 后自动刷新'],
			},
			{
				name: '写测试',
				status: 'done',
				acceptance_criteria: ['覆盖关键路径'],
				outcome: '已覆盖',
			},
		],
		summary: {
			total: 3,
			todo: 1,
			inProgress: 1,
			done: 1,
			skipped: 0,
		},
	};

	it('should restore snapshot and rebuild summary', () => {
		const state = new PlanState();

		const restored = state.restore(snapshot);

		expect(restored).toEqual({
			title: '实现任务面板',
			description: '把计划同步到 Chat 界面',
			tasks: [
				expect.objectContaining({ name: '补 UI', status: 'todo' }),
				expect.objectContaining({ name: '接桥接', status: 'in_progress' }),
				expect.objectContaining({ name: '写测试', status: 'done' }),
			],
			summary: {
				total: 3,
				todo: 1,
				inProgress: 1,
				done: 1,
				skipped: 0,
			},
		});
	});

	it('should preserve input order when updating task statuses', () => {
		const state = new PlanState();

		const updated = state.update({
			title: '实现任务面板',
			tasks: [
				{
					name: '任务 1',
					status: 'done',
					acceptance_criteria: ['完成第一步'],
					outcome: '已完成',
				},
				{
					name: '任务 2',
					status: 'in_progress',
					acceptance_criteria: ['继续第二步'],
				},
				{
					name: '任务 3',
					status: 'todo',
					acceptance_criteria: ['等待第三步'],
				},
			],
		});

		expect(updated.tasks.map((task) => task.name)).toEqual([
			'任务 1',
			'任务 2',
			'任务 3',
		]);
	});

	it('should clone nested arrays from snapshot', () => {
		const cloned = clonePlanSnapshot(snapshot);
		if (!cloned) {
			throw new Error('snapshot clone failed');
		}

		cloned.tasks[0].acceptance_criteria.push('不应污染原对象');

		expect(snapshot.tasks[0].acceptance_criteria).toEqual(['显示任务列表']);
	});

	it('should emit changes on restore and reset', () => {
		const state = new PlanState();
		const events: Array<PlanSnapshot | null> = [];

		const unsubscribe = state.subscribe((next) => {
			events.push(next);
		});

		state.restore(snapshot);
		state.reset();
		unsubscribe();

		expect(events).toHaveLength(2);
		expect(events[0]?.title).toBe('实现任务面板');
		expect(events[1]).toBeNull();
	});
});
