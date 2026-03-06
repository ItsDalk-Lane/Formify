import { Columns3, Layers, Rows3 } from 'lucide-react';
import type { LayoutMode } from '../types/multiModel';
import { localInstance } from 'src/i18n/locals';

interface LayoutSwitcherProps {
	layoutMode: LayoutMode;
	onLayoutChange: (mode: LayoutMode) => void;
}

export const LayoutSwitcher = ({ layoutMode, onLayoutChange }: LayoutSwitcherProps) => {
	const layouts: { mode: LayoutMode; icon: typeof Columns3; label: string }[] = [
		{ mode: 'horizontal', icon: Columns3, label: localInstance.layout_horizontal || '并排' },
		{ mode: 'tabs', icon: Layers, label: localInstance.layout_tabs || '标签页' },
		{ mode: 'vertical', icon: Rows3, label: localInstance.layout_vertical || '垂直' },
	];

	return (
		<div className="layout-switcher tw-flex tw-items-center tw-gap-0.5">
			{layouts.map(({ mode, icon: Icon, label }) => {
				const isActive = layoutMode === mode;
				return (
					<button
						key={mode}
						type="button"
						aria-label={label}
						title={label}
						onClick={() => onLayoutChange(mode)}
						className="tw-inline-flex tw-items-center tw-justify-center tw-border tw-border-transparent tw-p-1 tw-cursor-pointer tw-rounded"
						style={{
							backgroundColor: isActive ? 'var(--interactive-accent)' : 'transparent',
							color: isActive ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)',
						}}
						onMouseEnter={(e) => {
							if (!isActive) e.currentTarget.style.color = 'var(--interactive-accent)';
						}}
						onMouseLeave={(e) => {
							if (!isActive) e.currentTarget.style.color = 'var(--text-muted)';
						}}
					>
						<Icon style={{ width: 14, height: 14 }} />
					</button>
				);
			})}
		</div>
	);
};
