import { Columns3, Layers, Rows3, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { LayoutMode } from '../types/multiModel';
import { localInstance } from 'src/i18n/locals';

interface LayoutSelectorProps {
	layoutMode: LayoutMode;
	onLayoutChange: (mode: LayoutMode) => void;
}

export const LayoutSelector = ({ layoutMode, onLayoutChange }: LayoutSelectorProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLSpanElement>(null);

	const layoutOptions: { mode: LayoutMode; icon: typeof Columns3; label: string }[] = [
		{ mode: 'horizontal', icon: Columns3, label: localInstance.layout_horizontal || '并排' },
		{ mode: 'tabs', icon: Layers, label: localInstance.layout_tabs || '标签页' },
		{ mode: 'vertical', icon: Rows3, label: localInstance.layout_vertical || '垂直' },
	];

	const currentLayout = layoutOptions.find((l) => l.mode === layoutMode) || layoutOptions[0];
	const CurrentIcon = currentLayout.icon;

	// 点击外部关闭
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (dropdownRef.current?.contains(target)) {
				return;
			}
			if (buttonRef.current?.contains(target)) {
				return;
			}
			setIsOpen(false);
		};

		setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside);
		}, 100);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	const handleLayoutSelect = (selectedMode: LayoutMode) => {
		onLayoutChange(selectedMode);
		setIsOpen(false);
	};

	return (
		<div className="layout-selector-wrapper" style={{ position: 'relative' }}>
			<span
				ref={buttonRef}
				onClick={() => setIsOpen(!isOpen)}
				aria-label={currentLayout.label}
				title={currentLayout.label}
				className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center tw-gap-1"
			>
				<CurrentIcon className="tw-size-4" />
				<ChevronDown className="tw-size-3" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
			</span>

			{isOpen && (
				<div
					ref={dropdownRef}
					className="layout-selector-dropdown"
					style={{
						position: 'absolute',
						top: '100%',
						left: 0,
						marginTop: '4px',
						background: 'var(--background-primary)',
						border: '1px solid var(--background-modifier-border)',
						borderRadius: 'var(--radius-m)',
						boxShadow: 'var(--shadow-s)',
						padding: '4px',
						zIndex: 1000,
						minWidth: '120px',
					}}
				>
					{layoutOptions.map(({ mode, icon: Icon, label }) => {
						const isActive = layoutMode === mode;
						return (
							<div
								key={mode}
								onClick={() => handleLayoutSelect(mode)}
								className="tw-flex tw-items-center tw-gap-2 tw-px-2 tw-py-1.5 tw-rounded tw-cursor-pointer"
								style={{
									backgroundColor: isActive ? 'var(--interactive-accent)' : 'transparent',
									color: isActive ? 'var(--text-on-accent, #fff)' : 'var(--text-normal)',
								}}
								onMouseEnter={(e) => {
									if (!isActive) {
										e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									}
								}}
								onMouseLeave={(e) => {
									if (!isActive) {
										e.currentTarget.style.backgroundColor = 'transparent';
									}
								}}
							>
								<Icon className="tw-size-4" />
								<span className="tw-text-sm">{label}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
