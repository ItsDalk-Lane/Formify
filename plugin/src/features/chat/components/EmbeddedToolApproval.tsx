import type { ToolCall, ToolExecution } from '../types/tools';

interface EmbeddedToolApprovalProps {
	toolCalls: ToolCall[];
	pendingExecutions: ToolExecution[];
	onApprove: (executionId: string) => void;
	onReject: (executionId: string) => void;
}

/**
 * 嵌入在消息中的工具审批界面组件
 * 在AI消息流中显示待审批的工具调用，用户可直接在消息中操作
 */
export const EmbeddedToolApproval = ({
	toolCalls,
	pendingExecutions,
	onApprove,
	onReject
}: EmbeddedToolApprovalProps) => {
	// 通过toolCallId匹配待审批的执行记录
	const pendingItems = toolCalls
		.map((call) => ({
			call,
			execution: pendingExecutions.find(
				(exec) => exec.toolCallId === call.id && exec.status === 'pending'
			)
		}))
		.filter((item) => item.execution !== undefined);

	if (pendingItems.length === 0) return null;

	return (
		<div className="tw-mb-2 tw-space-y-2">
			{pendingItems.map(({ call, execution }) => (
				<div
					key={execution!.id}
					className="tw-rounded-md tw-border tw-border-gray-300 tw-bg-white tw-p-3"
				>
					{/* 标题 */}
					<div className="tw-mb-2 tw-text-sm tw-font-medium tw-text-gray-900">
						AI 请求使用工具 {call.name}，是否允许？
					</div>

					{/* 参数显示 */}
					<div className="tw-mb-3 tw-max-h-40 tw-overflow-auto tw-rounded tw-border tw-border-gray-200 tw-bg-gray-50 tw-p-2">
						<pre className="tw-text-xs tw-text-gray-600">
							{JSON.stringify(execution!.arguments, null, 2)}
						</pre>
					</div>

					{/* 操作按钮 */}
					<div className="tw-flex tw-items-center tw-gap-2">
						<button
							type="button"
							className="tw-rounded tw-border tw-border-gray-300 tw-bg-white tw-px-3 tw-py-1.5 tw-text-sm tw-text-gray-700 tw-transition-colors hover:tw-bg-gray-50"
							onClick={() => onApprove(execution!.id)}
						>
							允许一次
						</button>
						<button
							type="button"
							className="tw-rounded tw-bg-green-600 tw-px-3 tw-py-1.5 tw-text-sm tw-text-white tw-transition-colors hover:tw-bg-green-700"
							onClick={() => onApprove(execution!.id)}
						>
							始终允许
						</button>
						<button
							type="button"
							className="tw-rounded tw-bg-red-600 tw-px-3 tw-py-1.5 tw-text-sm tw-text-white tw-transition-colors hover:tw-bg-red-700"
							onClick={() => onReject(execution!.id)}
						>
							拒绝
						</button>
					</div>
				</div>
			))}
		</div>
	);
};
