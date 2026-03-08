import {
	CheckCircle2,
	ChevronDown,
	CircleDashed,
	CircleSlash2,
	LoaderCircle,
	Pause,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
	PlanSnapshot,
	PlanTaskStatus,
} from 'src/builtin-mcp/runtime/plan-state';
import { localInstance } from 'src/i18n/locals';

type PlanFilter = 'all' | PlanTaskStatus;

interface ChatPlanPanelProps {
	plan?: PlanSnapshot | null;
	sessionId: string;
	isGenerating: boolean;
}

interface PlanTaskViewModel {
	index: number;
	key: string;
	name: string;
	status: PlanTaskStatus;
	acceptanceCriteria: string[];
}

const getStatusMeta = (status: PlanTaskStatus) => {
	switch (status) {
		case 'in_progress':
			return {
				label:
					localInstance.chat_plan_status_in_progress ?? '进行中',
				icon: LoaderCircle,
				badgeClass:
					'chat-plan-panel__badge chat-plan-panel__badge--in-progress',
				cardClass:
					'chat-plan-panel__task chat-plan-panel__task--in-progress',
			};
		case 'done':
			return {
				label: localInstance.chat_plan_status_done ?? '已完成',
				icon: CheckCircle2,
				badgeClass: 'chat-plan-panel__badge chat-plan-panel__badge--done',
				cardClass: 'chat-plan-panel__task chat-plan-panel__task--done',
			};
		case 'skipped':
			return {
				label: localInstance.chat_plan_status_skipped ?? '已跳过',
				icon: CircleSlash2,
				badgeClass:
					'chat-plan-panel__badge chat-plan-panel__badge--skipped',
				cardClass: 'chat-plan-panel__task chat-plan-panel__task--skipped',
			};
		case 'todo':
		default:
			return {
				label: localInstance.chat_plan_status_todo ?? '待处理',
				icon: CircleDashed,
				badgeClass: 'chat-plan-panel__badge chat-plan-panel__badge--todo',
				cardClass: 'chat-plan-panel__task chat-plan-panel__task--todo',
			};
	}
};

export const ChatPlanPanel = ({
	plan,
	sessionId,
	isGenerating,
}: ChatPlanPanelProps) => {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [activeFilter, setActiveFilter] = useState<PlanFilter>('all');
	const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

	useEffect(() => {
		setIsCollapsed(false);
		setActiveFilter('all');
		setExpandedTasks({});
	}, [sessionId]);

	const taskItems = useMemo<PlanTaskViewModel[]>(
		() =>
			(plan?.tasks ?? []).map((task, index) => ({
				index,
				key: `${index}-${task.name}`,
				name: task.name,
				status: task.status,
				acceptanceCriteria: task.acceptance_criteria,
			})),
		[plan?.tasks]
	);

	const visibleTasks = useMemo(
		() =>
			taskItems.filter((task) =>
				activeFilter === 'all' ? true : task.status === activeFilter
			),
		[activeFilter, taskItems]
	);

	const summaryItems = useMemo(
		() => [
			{
				key: 'all' as const,
				label: localInstance.chat_plan_total ?? '总任务',
				value: plan?.summary.total ?? 0,
			},
			{
				key: 'todo' as const,
				label: localInstance.chat_plan_status_todo ?? '待处理',
				value: plan?.summary.todo ?? 0,
			},
			{
				key: 'in_progress' as const,
				label:
					localInstance.chat_plan_status_in_progress ?? '进行中',
				value: plan?.summary.inProgress ?? 0,
			},
			{
				key: 'done' as const,
				label: localInstance.chat_plan_status_done ?? '已完成',
				value: plan?.summary.done ?? 0,
			},
			{
				key: 'skipped' as const,
				label: localInstance.chat_plan_status_skipped ?? '已跳过',
				value: plan?.summary.skipped ?? 0,
			},
		],
		[plan?.summary.done, plan?.summary.inProgress, plan?.summary.skipped, plan?.summary.todo, plan?.summary.total]
	);

	if (!plan) {
		return null;
	}

	const toggleTask = (taskKey: string) => {
		setExpandedTasks((current) => ({
			...current,
			[taskKey]: !current[taskKey],
		}));
	};

	return (
		<section className="chat-plan-panel tw-mx-2">
			<button
				type="button"
				className="chat-plan-panel__bar"
				onClick={() => setIsCollapsed((current) => !current)}
				aria-expanded={!isCollapsed}
			>
				<div className="chat-plan-panel__bar-main">
					<ChevronDown
						className={`chat-plan-panel__bar-chevron ${
							isCollapsed ? 'chat-plan-panel__bar-chevron--collapsed' : ''
						}`}
					/>
					<span className="chat-plan-panel__bar-title">{plan.title}</span>
				</div>
				<div className="chat-plan-panel__bar-progress">
					<span className="chat-plan-panel__bar-progress-label">
						{localInstance.chat_plan_status_done ?? '已完成'}
					</span>
					<span className="chat-plan-panel__bar-progress-value">
						{plan.summary.done}/{plan.summary.total}
					</span>
				</div>
			</button>

			{!isCollapsed && (
				<div className="chat-plan-panel__content">
					{plan.description && (
						<p className="chat-plan-panel__description">{plan.description}</p>
					)}

					<div className="chat-plan-panel__summary">
						{summaryItems.map((item) => (
							<button
								key={item.key}
								type="button"
								className={`chat-plan-panel__summary-item ${
									activeFilter === item.key
										? 'chat-plan-panel__summary-item--active'
										: ''
								}`}
								onClick={() => setActiveFilter(item.key)}
							>
								<div className="chat-plan-panel__summary-value">
									{item.value}
								</div>
								<div className="chat-plan-panel__summary-label">
									{item.label}
								</div>
							</button>
						))}
					</div>

					<div className="chat-plan-panel__tasks">
						{visibleTasks.length > 0 ? (
							visibleTasks.map((task) => {
								const isTaskRunning =
									task.status === 'in_progress' && isGenerating;
								const statusMeta =
									task.status === 'in_progress' && !isTaskRunning
										? {
												label:
													localInstance.chat_plan_status_paused ?? '已暂停',
												icon: Pause,
												badgeClass:
													'chat-plan-panel__badge chat-plan-panel__badge--paused',
												cardClass:
													'chat-plan-panel__task chat-plan-panel__task--paused',
											}
										: getStatusMeta(task.status);
								const StatusIcon = statusMeta.icon;
								const isExpanded = expandedTasks[task.key] ?? false;

								return (
									<article
										key={task.key}
										className={statusMeta.cardClass}
									>
										<button
											type="button"
											className="chat-plan-panel__task-toggle"
											onClick={() => toggleTask(task.key)}
											aria-expanded={isExpanded}
										>
											<div className="chat-plan-panel__task-main">
												<span className="chat-plan-panel__task-index">
													{task.index + 1}
												</span>
												<span
													className={`chat-plan-panel__task-title ${
														task.status === 'done'
															? 'chat-plan-panel__task-title--done'
															: ''
													}`}
												>
													{task.name}
												</span>
											</div>

											<div className="chat-plan-panel__task-trailing">
												<span className={statusMeta.badgeClass}>
													<StatusIcon
														className={`tw-size-3.5 tw-flex-shrink-0 ${
															isTaskRunning
																? 'chat-plan-panel__badge-icon--spin'
																: ''
														}`}
													/>
													<span>{statusMeta.label}</span>
												</span>
												<ChevronDown
													className={`chat-plan-panel__task-chevron ${
														isExpanded
															? 'chat-plan-panel__task-chevron--expanded'
															: ''
													}`}
												/>
											</div>
										</button>

										{isExpanded && (
											<div className="chat-plan-panel__task-details">
												<div className="chat-plan-panel__criteria-title">
													{localInstance.chat_plan_acceptance_criteria ?? '验收标准'}
												</div>
												{task.acceptanceCriteria.length > 0 ? (
													<ul className="chat-plan-panel__criteria-list">
														{task.acceptanceCriteria.map((criteria, criteriaIndex) => (
															<li
																key={`${task.key}-criteria-${criteriaIndex}`}
																className="chat-plan-panel__criteria-item"
															>
																{criteria}
															</li>
														))}
													</ul>
												) : (
													<div className="chat-plan-panel__criteria-empty">
														{localInstance.chat_plan_no_acceptance_criteria
															?? '暂无验收标准'}
													</div>
												)}
											</div>
										)}
									</article>
								);
							})
						) : (
							<div className="chat-plan-panel__filtered-empty">
								{localInstance.chat_plan_filtered_empty ?? '当前筛选下暂无任务'}
							</div>
						)}
					</div>
				</div>
			)}
		</section>
	);
};
