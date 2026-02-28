import './ExpiryNoticePopup.css';

interface MiniFloatingIconProps {
	/** 过期文件数量 */
	count: number;
	/** 点击恢复弹窗 */
	onClick: () => void;
}

/**
 * 迷你浮动图标
 * 弹窗最小化后显示，显示过期文件数量角标
 */
export function MiniFloatingIcon(props: MiniFloatingIconProps) {
	const { count, onClick } = props;

	return (
		<button
			className="fem-mini-icon"
			onClick={onClick}
			title={`${count} expired files`}
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			{count > 0 && (
				<span className="fem-mini-icon__badge">
					{count > 99 ? '99+' : count}
				</span>
			)}
		</button>
	);
}
