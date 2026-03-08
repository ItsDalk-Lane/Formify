import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanSnapshot } from 'src/builtin-mcp/runtime/plan-state';
import { ChatPlanPanel } from './ChatPlanPanel';

describe('ChatPlanPanel', () => {
	const planSnapshot: PlanSnapshot = {
		title: '实现任务面板',
		description: '展示任务列表和统计信息',
		tasks: [
			{
				name: '完成测试',
				status: 'done',
				acceptance_criteria: ['测试可运行'],
				outcome: '已完成',
			},
			{
				name: '实现状态同步',
				status: 'in_progress',
				acceptance_criteria: ['write_plan 自动刷新'],
			},
			{
				name: '补空状态',
				status: 'todo',
				acceptance_criteria: [],
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

	it('should not render when plan is absent', () => {
		const html = renderToStaticMarkup(
			<ChatPlanPanel sessionId="session-1" plan={null} isGenerating={false} />
		);

		expect(html).toBe('');
	});

	it('should preserve task order and keep details collapsed by default', () => {
		const html = renderToStaticMarkup(
			<ChatPlanPanel
				sessionId="session-1"
				plan={planSnapshot}
				isGenerating={true}
			/>
		);

		expect(html).toContain('实现任务面板');
		expect(html).toContain('展示任务列表和统计信息');
		expect(html).toContain('1/3');
		expect(html).not.toContain('验收标准');
		expect(html.indexOf('完成测试')).toBeLessThan(html.indexOf('实现状态同步'));
		expect(html.indexOf('实现状态同步')).toBeLessThan(html.indexOf('补空状态'));
		expect(html).toContain('chat-plan-panel__task-title--done');
	});

	it('should show paused state for in-progress tasks when generation stops', () => {
		const html = renderToStaticMarkup(
			<ChatPlanPanel
				sessionId="session-1"
				plan={planSnapshot}
				isGenerating={false}
			/>
		);

		expect(html).toContain('已暂停');
		expect(html).not.toContain('chat-plan-panel__badge-icon--spin');
	});
});
