import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ProviderSettings, Vendor } from 'src/features/tars/providers';
import { getCapabilityDisplayText } from 'src/features/tars/providers/utils';
import { availableVendors } from 'src/features/tars/settings';
import type { CompareGroup } from '../types/multiModel';
import { localInstance } from 'src/i18n/locals';

interface CompareModelSelectorProps {
	providers: ProviderSettings[];
	selectedModels: string[];
	compareGroups: CompareGroup[];
	activeCompareGroupId?: string;
	onModelToggle: (tag: string) => void;
	onCompareGroupSelect: (groupId?: string) => void;
	onOpenGroupManager: () => void;
}

interface VendorGrouped {
	vendorName: string;
	vendor: Vendor;
	providers: ProviderSettings[];
}

export const CompareModelSelector = ({
	providers,
	selectedModels,
	compareGroups,
	activeCompareGroupId,
	onModelToggle,
	onCompareGroupSelect,
	onOpenGroupManager,
}: CompareModelSelectorProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const vendorGroups: VendorGrouped[] = (() => {
		const grouped = new Map<string, VendorGrouped>();
		providers.forEach((p) => {
			const vendor = availableVendors.find((v) => v.name === p.vendor);
			if (!vendor) return;
			if (!grouped.has(vendor.name)) {
				grouped.set(vendor.name, { vendorName: vendor.name, vendor, providers: [] });
			}
			grouped.get(vendor.name)!.providers.push(p);
		});
		return Array.from(grouped.values());
	})();

	const handleClickOutside = useCallback((e: MouseEvent) => {
		const target = e.target as Node;
		if (!dropdownRef.current?.contains(target) && !listRef.current?.contains(target)) {
			setIsOpen(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [isOpen, handleClickOutside]);

	const getDropdownPosition = useCallback(() => {
		if (!dropdownRef.current) return { left: 0, top: 0 };
		const rect = dropdownRef.current.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		const maxH = 360;
		if (spaceBelow < maxH && rect.top > spaceBelow) {
			return { left: rect.left, top: rect.top - Math.min(maxH, rect.top - 8) };
		}
		return { left: rect.left, top: rect.bottom + 2 };
	}, []);

	return (
		<div ref={dropdownRef} style={{ position: 'relative' }}>
			<button
				type="button"
				onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
				style={{
					display: 'flex', alignItems: 'center', gap: '0.5rem',
					padding: '6px 10px', borderRadius: 'var(--radius-s)',
					backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
					fontSize: 'var(--font-ui-small)', minWidth: '160px', justifyContent: 'space-between',
				}}
			>
				<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{selectedModels.length > 0
						? (localInstance.selected_models || '已选择 {count} 个模型').replace('{count}', String(selectedModels.length))
						: (localInstance.select_compare_models || '选择对比模型')}
				</span>
				<ChevronDown style={{ width: 14, height: 14, flexShrink: 0 }} />
			</button>

			{isOpen && createPortal(
				<div
					ref={listRef}
					style={{
						position: 'fixed', ...getDropdownPosition(),
						minWidth: '280px', maxWidth: '360px', maxHeight: '360px',
						zIndex: 1305, overflowY: 'auto',
						borderRadius: 'var(--radius-m)',
						border: '1px solid var(--background-modifier-border)',
						background: 'var(--background-primary)',
						boxShadow: 'var(--shadow-s)', padding: '0.25rem',
					}}
				>
					{/* 对比组快捷选择 */}
					{compareGroups.length > 0 && (
						<div style={{
							padding: '6px 10px', borderBottom: '1px solid var(--background-modifier-border)',
							marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px',
						}}>
							<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
								{localInstance.compare_group || '对比组'}:
							</span>
							<select
								value={activeCompareGroupId ?? ''}
								onChange={(e) => onCompareGroupSelect(e.target.value || undefined)}
								style={{
									flex: 1, padding: '2px 6px', fontSize: 'var(--font-ui-smaller)',
									borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
									background: 'var(--background-primary)', color: 'var(--text-normal)',
								}}
							>
								<option value="">自定义选择</option>
								{compareGroups.map((g) => (
									<option key={g.id} value={g.id}>{g.name} ({g.modelTags.length})</option>
								))}
							</select>
							<button
								type="button" onClick={onOpenGroupManager}
								style={{
									padding: '2px', background: 'transparent', border: 'none',
									cursor: 'pointer', color: 'var(--text-muted)', display: 'flex',
								}}
								title={localInstance.manage_compare_group || '管理对比组'}
							>
								<Settings style={{ width: 14, height: 14 }} />
							</button>
						</div>
					)}

					{/* 按供应商分组的模型列表 */}
					{vendorGroups.map((group) => (
						<div key={group.vendorName}>
							<div style={{
								padding: '6px 10px', fontSize: 'var(--font-ui-smaller)',
								fontWeight: 600, color: 'var(--text-muted)',
							}}>
								{group.vendorName}
							</div>
							{group.providers.map((provider) => {
								const checked = selectedModels.includes(provider.tag);
								const caps = getCapabilityDisplayText(group.vendor, provider.options);
								return (
									<label
										key={provider.tag}
										style={{
											display: 'flex', alignItems: 'center', gap: '8px',
											padding: '6px 10px 6px 18px', cursor: 'pointer',
											borderRadius: 'var(--radius-s)', fontSize: 'var(--font-ui-small)',
											backgroundColor: checked ? 'var(--background-modifier-hover)' : 'transparent',
										}}
										onMouseEnter={(e) => {
											if (!checked) e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
										}}
										onMouseLeave={(e) => {
											if (!checked) e.currentTarget.style.backgroundColor = 'transparent';
										}}
									>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => onModelToggle(provider.tag)}
											style={{ margin: 0, cursor: 'pointer' }}
										/>
										<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{provider.tag}
										</span>
										{caps && (
											<span style={{ fontSize: 'var(--font-ui-smaller)', opacity: 0.7 }}>{caps}</span>
										)}
									</label>
								);
							})}
						</div>
					))}

					{/* 底部管理按钮 */}
					{compareGroups.length === 0 && (
						<div style={{
							padding: '8px 10px', borderTop: '1px solid var(--background-modifier-border)',
							marginTop: '4px',
						}}>
							<button
								type="button" onClick={onOpenGroupManager}
								style={{
									width: '100%', padding: '4px 8px', fontSize: 'var(--font-ui-smaller)',
									background: 'transparent', border: '1px solid var(--background-modifier-border)',
									borderRadius: 'var(--radius-s)', cursor: 'pointer', color: 'var(--text-muted)',
								}}
							>
								{localInstance.no_compare_configs || '暂无配置，点击新建'}
							</button>
						</div>
					)}
				</div>,
				document.body
			)}
		</div>
	);
};
