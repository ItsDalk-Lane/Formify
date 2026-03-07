import { User, GitCompareArrows, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { MultiModelMode } from '../types/multiModel';
import { localInstance } from 'src/i18n/locals';

interface ModeSelectorProps {
	mode: MultiModelMode;
	onModeChange: (mode: MultiModelMode) => void;
}

export const ModeSelector = ({ mode, onModeChange }: ModeSelectorProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLSpanElement>(null);

	const modeOptions: { mode: MultiModelMode; icon: typeof User; label: string }[] = [
		{ mode: 'single', icon: User, label: localInstance.multi_model_mode_single || '单模型' },
		{ mode: 'compare', icon: GitCompareArrows, label: localInstance.multi_model_mode_compare || '对比模式' },
	];

	const currentMode = modeOptions.find((m) => m.mode === mode) || modeOptions[0];
	const CurrentIcon = currentMode.icon;

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

	const handleModeSelect = (selectedMode: MultiModelMode) => {
		onModeChange(selectedMode);
		setIsOpen(false);
	};

	return (
		<div className="mode-selector-wrapper" style={{ position: 'relative' }}>
			<span
				ref={buttonRef}
				onClick={() => setIsOpen(!isOpen)}
				aria-label={currentMode.label}
				title={currentMode.label}
				className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center tw-gap-1"
			>
				<CurrentIcon className="tw-size-4" />
				<ChevronDown className="tw-size-3" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
			</span>

			{isOpen && (
				<div
					ref={dropdownRef}
					className="mode-selector-dropdown"
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
					{modeOptions.map(({ mode: m, icon: Icon, label }) => {
						const isActive = mode === m;
						return (
							<div
								key={m}
								onClick={() => handleModeSelect(m)}
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
