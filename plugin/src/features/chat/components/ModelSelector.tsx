import type { ProviderSettings, Vendor } from 'src/features/tars/providers';
import { getCapabilityDisplayText } from 'src/features/tars/providers/utils';
import { availableVendors } from 'src/features/tars/settings';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModelSelectorProps {
	providers: ProviderSettings[];
	value: string;
	onChange: (tag: string) => void;
}

export const ModelSelector = ({ providers, value, onChange }: ModelSelectorProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const [forceUpdate, setForceUpdate] = useState(0);

	
	// Get button position for portal dropdown
	const getButtonPosition = () => {
		if (!dropdownRef.current) return { left: 0, top: 0 };
		const rect = dropdownRef.current.getBoundingClientRect();
		const dropdownHeight = Math.min(providers.length * 40, 256); // Estimate dropdown height
		return {
			left: rect.left,
			top: rect.top - dropdownHeight - 2 // Position above button
		};
	};

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => {
				document.removeEventListener('mousedown', handleClickOutside);
			};
		}
	}, [isOpen]);

	// Close dropdown on scroll
	useEffect(() => {
		const handleScroll = () => setIsOpen(false);
		if (isOpen) {
			document.addEventListener('scroll', handleScroll);
			window.addEventListener('scroll', handleScroll);
			return () => {
				document.removeEventListener('scroll', handleScroll);
				window.removeEventListener('scroll', handleScroll);
			};
		}
	}, [isOpen]);

	if (!providers.length) {
		return <div className="tw-text-sm tw-text-error">尚未配置AI模型</div>;
	}

	const currentProvider = providers.find(p => p.tag === value);
	const vendor = currentProvider ? availableVendors.find(v => v.name === currentProvider.vendor) : null;
	const capabilityIcons = currentProvider && vendor ? getCapabilityDisplayText(vendor, currentProvider.options) : '';
	const displayText = currentProvider ? `${currentProvider.tag} · ${currentProvider.options.model}` : 'Select model';

	return (
		<div className="relative" ref={dropdownRef} style={{position: 'relative'}}>
			<button
				type="button"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					setIsOpen(!isOpen);
				}}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					padding: '6px 10px',
					borderRadius: 'var(--radius-s)',
					backgroundColor: 'transparent',
					border: 'none',
					cursor: 'pointer',
					fontSize: 'var(--font-ui-small)',
					minWidth: '200px',
					justifyContent: 'space-between'
				}}
			>
				<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{displayText}
				</span>
				{capabilityIcons && (
					<span style={{ fontSize: 'var(--font-ui-smaller)', opacity: 0.8 }}>
						{capabilityIcons}
					</span>
				)}
				<ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
			</button>

			{isOpen && createPortal(
				<div
					style={{
						position: 'fixed',
						left: 0,
						top: 0,
						transform: `translate(${getButtonPosition().left}px, ${getButtonPosition().top}px)`,
						minWidth: 'max-content',
						zIndex: 50,
						pointerEvents: 'auto'
					}}
				>
					<div
						role="menu"
						aria-orientation="vertical"
						style={{
							outline: 'none',
							minWidth: '200px',
							maxWidth: '300px',
							maxHeight: '240px',
							overflowY: 'auto',
							borderRadius: 'var(--radius-m)',
							border: '1px solid var(--background-modifier-border)',
							background: 'var(--background-primary)',
							padding: '0.25rem',
							color: 'var(--text-normal)',
							boxShadow: 'var(--shadow-s)'
						}}
						tabIndex={-1}
					>
						{providers.map((provider) => {
							const vendor = availableVendors.find(v => v.name === provider.vendor);
							const capabilityIcons = vendor ? getCapabilityDisplayText(vendor, provider.options) : '';
							
							return (
								<div
									key={provider.tag}
									role="menuitem"
									style={{
										position: 'relative',
										display: 'flex',
										cursor: 'pointer',
										userSelect: 'none',
										alignItems: 'center',
										gap: '0.5rem',
										borderRadius: 'var(--radius-s)',
										padding: '8px 12px',
										fontSize: 'var(--font-ui-small)',
										outline: 'none',
										transition: 'color 0.15s ease-in-out, background-color 0.15s ease-in-out',
										marginBottom: '2px'
									}}
									tabIndex={-1}
									onMouseDown={(e) => {
										e.preventDefault();
										e.stopPropagation();
										onChange(provider.tag);
										setIsOpen(false);
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
										e.currentTarget.style.color = 'var(--text-normal)';
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.backgroundColor = 'transparent';
										e.currentTarget.style.color = 'var(--text-normal)';
									}}
								>
									<div style={{display: 'flex', minWidth: 0, alignItems: 'center', gap: '0.25rem', flex: 1}}>
										<span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-ui-small)'}} className="hover:tw-text-normal">
											{provider.tag} · {provider.options.model}
										</span>
									</div>
									{capabilityIcons && (
										<span style={{ fontSize: 'var(--font-ui-smaller)', opacity: 0.7 }}>
											{capabilityIcons}
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>,
				document.body
			)}
		</div>
	);
};

