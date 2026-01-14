import type { ToolExecution } from '../types/tools';

interface ToolApprovalNotificationProps {
	pending: ToolExecution[];
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
}

export const ToolApprovalNotification = ({ pending, onApprove, onReject }: ToolApprovalNotificationProps) => {
	if (!pending.length) return null;

	const head = pending[0];

	return (
		<div className="tw-mx-2 tw-mb-2 tw-rounded tw-border tw-border-yellow-300 tw-bg-yellow-50 tw-p-2">
			<div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
				<div className="tw-text-xs tw-font-semibold tw-text-yellow-900">
					待审批工具调用（{pending.length}）
				</div>
				<div className="tw-flex tw-items-center tw-gap-2">
					<button
						type="button"
						className="tw-rounded tw-border tw-border-border tw-bg-white tw-px-2 tw-py-1 tw-text-xs"
						onClick={() => onReject(head.id)}
					>
						拒绝
					</button>
					<button
						type="button"
						className="tw-rounded tw-border tw-border-border tw-bg-accent tw-text-on-accent tw-px-2 tw-py-1 tw-text-xs"
						onClick={() => onApprove(head.id)}
					>
						批准执行
					</button>
				</div>
			</div>
			<div className="tw-mt-2 tw-text-xs tw-text-yellow-900">
				<div className="tw-mb-1">
					<span className="tw-font-semibold">工具：</span>
					{head.toolId}
				</div>
				<pre className="tw-max-h-40 tw-overflow-auto tw-rounded tw-border tw-border-yellow-200 tw-bg-white/70 tw-p-2 tw-text-[11px]">
					{JSON.stringify(head.arguments, null, 2)}
				</pre>
			</div>
		</div>
	);
};
