import { useMemo, useState, useCallback } from 'react';
import {
	CheckCircle2,
	Circle,
	XCircle,
	Loader2,
	ChevronDown,
	ChevronRight,
	Play,
	Pause,
	X,
	SkipForward,
	AlertCircle
} from 'lucide-react';
import type { MultiStepTask, TaskStep, TaskStepStatus, MultiStepTaskStatus } from '../types/multiStepTask';

interface MultiStepTaskProgressProps {
	task: MultiStepTask;
	onConfirm?: () => void;
	onCancel?: () => void;
	onPause?: () => void;
	onResume?: () => void;
}

/**
 * 获取步骤状态图标
 */
const StepStatusIcon = ({ status }: { status: TaskStepStatus }) => {
	switch (status) {
		case 'completed':
			return <CheckCircle2 className="tw-size-4 tw-text-green-500" />;
		case 'running':
			return <Loader2 className="tw-size-4 tw-text-blue-500 tw-animate-spin" />;
		case 'failed':
			return <XCircle className="tw-size-4 tw-text-red-500" />;
		case 'skipped':
			return <SkipForward className="tw-size-4 tw-text-gray-400" />;
		case 'pending':
		default:
			return <Circle className="tw-size-4 tw-text-gray-300" />;
	}
};

/**
 * 获取任务状态描述
 */
const getTaskStatusText = (status: MultiStepTaskStatus): string => {
	switch (status) {
		case 'analyzing':
			return '正在分析任务...';
		case 'planning':
			return '正在制定计划...';
		case 'confirming':
			return '等待确认执行';
		case 'executing':
			return '正在执行...';
		case 'paused':
			return '已暂停';
		case 'completed':
			return '执行完成';
		case 'failed':
			return '执行失败';
		case 'cancelled':
			return '已取消';
		default:
			return '空闲';
	}
};

/**
 * 获取任务状态颜色
 */
const getTaskStatusColor = (status: MultiStepTaskStatus): string => {
	switch (status) {
		case 'analyzing':
		case 'planning':
		case 'executing':
			return 'tw-text-blue-600';
		case 'confirming':
			return 'tw-text-orange-600';
		case 'paused':
			return 'tw-text-yellow-600';
		case 'completed':
			return 'tw-text-green-600';
		case 'failed':
			return 'tw-text-red-600';
		case 'cancelled':
			return 'tw-text-gray-600';
		default:
			return 'tw-text-gray-400';
	}
};

/**
 * 步骤列表项
 */
const StepItem = ({ step, isExpanded, onToggle }: {
	step: TaskStep;
	isExpanded: boolean;
	onToggle: () => void;
}) => {
	const hasDetails = step.description || step.toolName || step.result || step.error;

	return (
		<div className="tw-border-l-2 tw-border-gray-200 tw-pl-3 tw-py-1">
			<div
				className={`tw-flex tw-items-center tw-gap-2 ${hasDetails ? 'tw-cursor-pointer hover:tw-bg-gray-50' : ''} tw-rounded tw-p-1`}
				onClick={hasDetails ? onToggle : undefined}
			>
				<StepStatusIcon status={step.status} />
				{hasDetails && (
					<span className="tw-text-gray-400">
						{isExpanded ? <ChevronDown className="tw-size-3" /> : <ChevronRight className="tw-size-3" />}
					</span>
				)}
				<span className={`tw-flex-1 tw-text-sm ${step.status === 'completed' ? 'tw-text-gray-500' : ''}`}>
					{step.title}
				</span>
				{step.status === 'running' && (
					<span className="tw-text-xs tw-text-blue-500">执行中</span>
				)}
			</div>

			{isExpanded && hasDetails && (
				<div className="tw-ml-6 tw-mt-1 tw-space-y-1 tw-text-xs tw-text-gray-500">
					{step.description && (
						<div className="tw-bg-gray-50 tw-rounded tw-p-2">
							{step.description}
						</div>
					)}
					{step.toolName && (
						<div className="tw-flex tw-items-center tw-gap-1">
							<span className="tw-font-medium">工具:</span>
							<code className="tw-bg-gray-100 tw-px-1 tw-rounded">{step.toolName}</code>
						</div>
					)}
					{step.toolArgs && Object.keys(step.toolArgs).length > 0 && (
						<div>
							<span className="tw-font-medium">参数:</span>
							<pre className="tw-bg-gray-100 tw-p-2 tw-rounded tw-mt-1 tw-overflow-x-auto tw-text-[10px]">
								{JSON.stringify(step.toolArgs, null, 2)}
							</pre>
						</div>
					)}
					{step.result && (
						<div className="tw-text-green-600">
							<span className="tw-font-medium">结果:</span> {step.result}
						</div>
					)}
					{step.error && (
						<div className="tw-text-red-600">
							<span className="tw-font-medium">错误:</span> {step.error}
						</div>
					)}
				</div>
			)}
		</div>
	);
};

/**
 * 多步骤任务进度组件
 */
export const MultiStepTaskProgress = ({
	task,
	onConfirm,
	onCancel,
	onPause,
	onResume
}: MultiStepTaskProgressProps) => {
	const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
	const [showAllSteps, setShowAllSteps] = useState(true);

	const toggleStep = useCallback((stepId: string) => {
		setExpandedSteps(prev => {
			const next = new Set(prev);
			if (next.has(stepId)) {
				next.delete(stepId);
			} else {
				next.add(stepId);
			}
			return next;
		});
	}, []);

	const progress = useMemo(() => {
		if (!task.plan) return 0;
		const total = task.plan.steps.length;
		if (total === 0) return 0;
		return Math.round((task.completedSteps / total) * 100);
	}, [task.plan, task.completedSteps]);

	const statusText = useMemo(() => getTaskStatusText(task.status), [task.status]);
	const statusColor = useMemo(() => getTaskStatusColor(task.status), [task.status]);

	const isLoading = task.status === 'analyzing' || task.status === 'planning';
	const isConfirming = task.status === 'confirming';
	const isExecuting = task.status === 'executing';
	const isPaused = task.status === 'paused';
	const isFinished = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

	return (
		<div className="ff-multi-step-task tw-border tw-border-gray-200 tw-rounded-lg tw-bg-white tw-shadow-sm tw-overflow-hidden">
			{/* 头部状态栏 */}
			<div className="tw-flex tw-items-center tw-justify-between tw-px-3 tw-py-2 tw-bg-gray-50 tw-border-b tw-border-gray-200">
				<div className="tw-flex tw-items-center tw-gap-2">
					{isLoading && <Loader2 className="tw-size-4 tw-text-blue-500 tw-animate-spin" />}
					{isExecuting && <Loader2 className="tw-size-4 tw-text-blue-500 tw-animate-spin" />}
					{isPaused && <Pause className="tw-size-4 tw-text-yellow-500" />}
					{task.status === 'completed' && <CheckCircle2 className="tw-size-4 tw-text-green-500" />}
					{task.status === 'failed' && <XCircle className="tw-size-4 tw-text-red-500" />}
					{task.status === 'cancelled' && <X className="tw-size-4 tw-text-gray-500" />}
					{isConfirming && <AlertCircle className="tw-size-4 tw-text-orange-500" />}
					<span className={`tw-text-sm tw-font-medium ${statusColor}`}>{statusText}</span>
				</div>

				{/* 操作按钮 */}
				<div className="tw-flex tw-items-center tw-gap-1">
					{isConfirming && onConfirm && (
						<button
							onClick={onConfirm}
							className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-text-xs tw-bg-blue-500 tw-text-white tw-rounded hover:tw-bg-blue-600 tw-transition-colors"
						>
							<Play className="tw-size-3" />
							确认执行
						</button>
					)}
					{isExecuting && onPause && (
						<button
							onClick={onPause}
							className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-text-xs tw-bg-yellow-500 tw-text-white tw-rounded hover:tw-bg-yellow-600 tw-transition-colors"
						>
							<Pause className="tw-size-3" />
							暂停
						</button>
					)}
					{isPaused && onResume && (
						<button
							onClick={onResume}
							className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-text-xs tw-bg-blue-500 tw-text-white tw-rounded hover:tw-bg-blue-600 tw-transition-colors"
						>
							<Play className="tw-size-3" />
							继续
						</button>
					)}
					{(isConfirming || isExecuting || isPaused) && onCancel && (
						<button
							onClick={onCancel}
							className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-text-xs tw-bg-gray-200 tw-text-gray-700 tw-rounded hover:tw-bg-gray-300 tw-transition-colors"
						>
							<X className="tw-size-3" />
							取消
						</button>
					)}
				</div>
			</div>

			{/* 任务计划信息 */}
			{task.plan && (
				<div className="tw-p-3">
					{/* 分析摘要 */}
					<div className="tw-mb-3">
						<div className="tw-text-xs tw-text-gray-500 tw-mb-1">任务分析</div>
						<div className="tw-text-sm tw-text-gray-700">{task.plan.analysisSummary}</div>
					</div>

					{/* 进度条 */}
					{(isExecuting || isPaused || isFinished) && (
						<div className="tw-mb-3">
							<div className="tw-flex tw-items-center tw-justify-between tw-text-xs tw-text-gray-500 tw-mb-1">
								<span>执行进度</span>
								<span>{task.completedSteps} / {task.plan.steps.length} 步骤</span>
							</div>
							<div className="tw-w-full tw-h-2 tw-bg-gray-200 tw-rounded-full tw-overflow-hidden">
								<div
									className={`tw-h-full tw-transition-all tw-duration-300 ${task.status === 'failed' ? 'tw-bg-red-500' : 'tw-bg-blue-500'
										}`}
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					)}

					{/* 复杂度和步骤数 */}
					<div className="tw-flex tw-items-center tw-gap-4 tw-text-xs tw-text-gray-500 tw-mb-3">
						<span>复杂度: {task.plan.complexity}/10</span>
						<span>步骤数: {task.plan.steps.length}</span>
						{task.failedSteps > 0 && (
							<span className="tw-text-red-500">失败: {task.failedSteps}</span>
						)}
					</div>

					{/* 步骤列表 */}
					<div>
						<div
							className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-gray-500 tw-cursor-pointer tw-mb-2"
							onClick={() => setShowAllSteps(prev => !prev)}
						>
							{showAllSteps ? <ChevronDown className="tw-size-3" /> : <ChevronRight className="tw-size-3" />}
							<span>执行步骤</span>
						</div>

						{showAllSteps && (
							<div className="tw-space-y-1 tw-max-h-60 tw-overflow-y-auto">
								{task.plan.steps.map(step => (
									<StepItem
										key={step.id}
										step={step}
										isExpanded={expandedSteps.has(step.id)}
										onToggle={() => toggleStep(step.id)}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			)}

			{/* 错误信息 */}
			{task.error && (
				<div className="tw-px-3 tw-pb-3">
					<div className="tw-bg-red-50 tw-border tw-border-red-200 tw-rounded tw-p-2 tw-text-xs tw-text-red-600">
						<span className="tw-font-medium">错误:</span> {task.error}
					</div>
				</div>
			)}

			{/* 结果摘要 */}
			{task.resultSummary && task.status === 'completed' && (
				<div className="tw-px-3 tw-pb-3">
					<div className="tw-bg-green-50 tw-border tw-border-green-200 tw-rounded tw-p-2 tw-text-xs tw-text-green-700 tw-whitespace-pre-line">
						{task.resultSummary}
					</div>
				</div>
			)}

			{/* 加载中提示 */}
			{isLoading && !task.plan && (
				<div className="tw-p-4 tw-text-center tw-text-gray-500 tw-text-sm">
					<Loader2 className="tw-size-6 tw-mx-auto tw-mb-2 tw-animate-spin" />
					{task.status === 'analyzing' ? '正在分析任务，请稍候...' : '正在生成执行计划...'}
				</div>
			)}
		</div>
	);
};

export default MultiStepTaskProgress;
