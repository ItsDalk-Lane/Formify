import { CheckCircle, Clock, XCircle } from 'lucide-react';
import type { ToolCall } from '../types/tools';

interface ToolCallBadgeProps {
	call: ToolCall;
}

export const ToolCallBadge = ({ call }: ToolCallBadgeProps) => {
	const icon =
		call.status === 'completed' ? (
			<CheckCircle className="tw-size-3" />
		) : call.status === 'failed' ? (
			<XCircle className="tw-size-3" />
		) : (
			<Clock className="tw-size-3" />
		);

	const bgClass =
		call.status === 'completed'
			? 'tw-bg-green-100 tw-text-green-700'
			: call.status === 'failed'
				? 'tw-bg-red-100 tw-text-red-700'
				: 'tw-bg-yellow-100 tw-text-yellow-700';

	return (
		<span className={`tw-inline-flex tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1 tw-text-[10px] ${bgClass}`}>
			{icon}
			<span className="tw-max-w-40 tw-truncate" title={call.name}>
				{call.name}
			</span>
		</span>
	);
};
