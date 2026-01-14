import { Wrench } from 'lucide-react';
import { useMemo } from 'react';

interface ToolToggleProps {
	enabled: boolean;
	pendingCount: number;
	onClick: () => void;
}

export const ToolToggle = ({ enabled, pendingCount, onClick }: ToolToggleProps) => {
	const badgeText = useMemo(() => {
		if (pendingCount <= 0) return '';
		return pendingCount > 99 ? '99+' : String(pendingCount);
	}, [pendingCount]);

	return (
		<button
			type="button"
			aria-label="工具管理"
			onClick={onClick}
			className={`tw-relative tw-inline-flex tw-items-center tw-justify-center tw-border tw-border-transparent tw-p-1 tw-cursor-pointer hover:tw-text-accent ${
				enabled ? 'tw-rounded' : ''
			} ${enabled ? '' : 'tw-text-muted'}`}
			style={
				enabled
					? { background: 'var(--interactive-accent)', color: 'var(--text-on-accent)' }
					: { background: 'transparent' }
			}
		>
			<Wrench className="tw-size-4" />
			{pendingCount > 0 && (
				<span
					className="tw-absolute tw--top-1 tw--right-1 tw-min-w-4 tw-h-4 tw-px-1 tw-rounded-full tw-bg-red-600 tw-text-white tw-text-[10px] tw-leading-4 tw-text-center"
					title="待审批工具调用"
				>
					{badgeText}
				</span>
			)}
		</button>
	);
};
