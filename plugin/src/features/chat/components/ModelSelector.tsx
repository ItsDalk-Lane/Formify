import type { ProviderSettings, Vendor } from 'src/features/tars/providers';
import { getCapabilityDisplayText } from 'src/features/tars/providers/utils';
import { availableVendors } from 'src/features/tars/settings';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ModelSelectorProps {
	providers: ProviderSettings[];
	value: string;
	onChange: (tag: string) => void;
}

// 提供商分组
interface VendorGroup {
	vendorName: string;
	vendor: Vendor;
	providers: ProviderSettings[];
}

export const ModelSelector = ({ providers, value, onChange }: ModelSelectorProps) => {
	const VIEWPORT_PADDING = 8;
	const PROVIDER_LIST_MIN_WIDTH = 200;
	const PROVIDER_LIST_MAX_WIDTH = 250;
	const PROVIDER_LIST_MAX_HEIGHT = 400;
	const PROVIDER_ITEM_ESTIMATED_HEIGHT = 40;
	const SUBMENU_MIN_WIDTH = 250;
	const SUBMENU_MAX_WIDTH = 350;
	const SUBMENU_MAX_HEIGHT = 400;
	const SUBMENU_TITLE_HEIGHT = 45;
	const SUBMENU_ITEM_ESTIMATED_HEIGHT = 38;

	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const providerListRef = useRef<HTMLDivElement>(null);
	const submenuRef = useRef<HTMLDivElement>(null);
	const vendorItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('down');
	const [, forcePositionUpdate] = useState(0);

	// 当前悬停的提供商
	const [hoveredVendor, setHoveredVendor] = useState<string | null>(null);

	// 用于延迟清除悬停状态的定时器
	const clearHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 将 providers 按 vendor 分组
	const [vendorGroups, setVendorGroups] = useState<VendorGroup[]>([]);

	useEffect(() => {
		const grouped = new Map<string, VendorGroup>();

		providers.forEach(provider => {
			const vendor = availableVendors.find(v => v.name === provider.vendor);
			if (vendor && !grouped.has(vendor.name)) {
				grouped.set(vendor.name, {
					vendorName: vendor.name,
					vendor,
					providers: []
				});
			}
			if (vendor) {
				grouped.get(vendor.name)!.providers.push(provider);
			}
		});

		setVendorGroups(Array.from(grouped.values()));
	}, [providers]);

	// 清除悬停状态
	const clearHoveredVendor = useCallback(() => {
		if (clearHoverTimerRef.current) {
			clearTimeout(clearHoverTimerRef.current);
		}
		clearHoverTimerRef.current = setTimeout(() => {
			setHoveredVendor(null);
		}, 100); // 100ms 延迟，给用户时间移动鼠标
	}, []);

	// 设置悬停状态（取消清除定时器）
	const setHoveredVendorWithCancel = useCallback((vendorName: string | null) => {
		if (clearHoverTimerRef.current) {
			clearTimeout(clearHoverTimerRef.current);
			clearHoverTimerRef.current = null;
		}
		setHoveredVendor(vendorName);
	}, []);

	// 处理模型选择
	const handleModelSelect = useCallback((tag: string) => {
		onChange(tag);
		setIsOpen(false);
		setHoveredVendor(null);
	}, [onChange]);

	const clampToViewport = useCallback((value: number, min: number, max: number) => {
		if (max < min) {
			return min;
		}
		return Math.min(Math.max(value, min), max);
	}, []);

	const getProviderListEstimatedHeight = useCallback(() => {
		const estimated = vendorGroups.length * PROVIDER_ITEM_ESTIMATED_HEIGHT + 8;
		return Math.min(PROVIDER_LIST_MAX_HEIGHT, Math.max(PROVIDER_ITEM_ESTIMATED_HEIGHT, estimated));
	}, [vendorGroups]);

	const updateDropdownDirection = useCallback(() => {
		if (!dropdownRef.current) return;
		const rect = dropdownRef.current.getBoundingClientRect();
		const listHeight = getProviderListEstimatedHeight();
		const spaceBelow = window.innerHeight - rect.bottom;
		const spaceAbove = rect.top;
		const shouldOpenUp = spaceBelow < listHeight && spaceAbove > spaceBelow;
		setDropdownDirection(shouldOpenUp ? 'up' : 'down');
	}, [getProviderListEstimatedHeight]);

	// Get button position for portal dropdown
	const getButtonPosition = useCallback(() => {
		if (!dropdownRef.current) return { left: 0, top: 0 };
		const rect = dropdownRef.current.getBoundingClientRect();
		const renderedListHeight = providerListRef.current?.getBoundingClientRect().height;
		const listHeight = renderedListHeight ?? getProviderListEstimatedHeight();
		const left = clampToViewport(
			rect.left,
			VIEWPORT_PADDING,
			window.innerWidth - PROVIDER_LIST_MAX_WIDTH - VIEWPORT_PADDING
		);

		if (dropdownDirection === 'up') {
			const preferredTop = rect.top - 2 - listHeight;
			const top = clampToViewport(
				preferredTop,
				VIEWPORT_PADDING,
				window.innerHeight - listHeight - VIEWPORT_PADDING
			);
			return { left, top };
		}

		const preferredTop = rect.bottom + 2;
		const top = clampToViewport(
			preferredTop,
			VIEWPORT_PADDING,
			window.innerHeight - listHeight - VIEWPORT_PADDING
		);
		return { left, top };
	}, [dropdownDirection, getProviderListEstimatedHeight, clampToViewport]);

	// 获取侧边弹窗位置（在当前提供商列表项的右侧）
	const getSubmenuPosition = useCallback(() => {
		if (!hoveredVendor) return { left: 0, top: 0 };
		const vendorEl = vendorItemRefs.current.get(hoveredVendor);
		if (!vendorEl) return { left: 0, top: 0 };
		const rect = vendorEl.getBoundingClientRect();
		const group = vendorGroups.find((item) => item.vendorName === hoveredVendor);
		const providerCount = group?.providers.length ?? 0;
		const estimatedSubmenuHeight = Math.min(
			SUBMENU_MAX_HEIGHT,
			SUBMENU_TITLE_HEIGHT + providerCount * SUBMENU_ITEM_ESTIMATED_HEIGHT + 8
		);
		const renderedSubmenuHeight = submenuRef.current?.getBoundingClientRect().height;
		const submenuHeight = renderedSubmenuHeight ?? estimatedSubmenuHeight;

		const spaceRight = window.innerWidth - rect.right;
		const spaceLeft = rect.left;
		const shouldOpenLeft = spaceRight < SUBMENU_MIN_WIDTH && spaceLeft > spaceRight;
		const preferredLeft = shouldOpenLeft ? rect.left - SUBMENU_MAX_WIDTH - 4 : rect.right + 4;
		const left = clampToViewport(
			preferredLeft,
			VIEWPORT_PADDING,
			window.innerWidth - SUBMENU_MAX_WIDTH - VIEWPORT_PADDING
		);
		const top = clampToViewport(
			rect.top,
			VIEWPORT_PADDING,
			window.innerHeight - submenuHeight - VIEWPORT_PADDING
		);

		return {
			left,
			top
		};
	}, [hoveredVendor, vendorGroups, clampToViewport]);

	useEffect(() => {
		if (!isOpen) return;
		updateDropdownDirection();
		const handleResize = () => updateDropdownDirection();
		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('resize', handleResize);
		};
	}, [isOpen, updateDropdownDirection]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const isInDropdown = dropdownRef.current?.contains(target);
			const isInProviderList = providerListRef.current?.contains(target);
			const isInSubmenu = submenuRef.current?.contains(target);

			if (!isInDropdown && !isInProviderList && !isInSubmenu) {
				setIsOpen(false);
				setHoveredVendor(null);
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
		const handleScroll = () => {
			setIsOpen(false);
			setHoveredVendor(null);
		};
		if (isOpen) {
			document.addEventListener('scroll', handleScroll);
			window.addEventListener('scroll', handleScroll);
			return () => {
				document.removeEventListener('scroll', handleScroll);
				window.removeEventListener('scroll', handleScroll);
			};
		}
	}, [isOpen]);

	// 清理定时器
	useEffect(() => {
		return () => {
			if (clearHoverTimerRef.current) {
				clearTimeout(clearHoverTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!isOpen) {
			vendorItemRefs.current.clear();
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			forcePositionUpdate((previous) => previous + 1);
		});
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [isOpen, hoveredVendor, vendorGroups.length]);

	if (!providers.length) {
		return <div className="tw-text-sm tw-text-error">尚未配置AI模型</div>;
	}

	const currentProvider = providers.find(p => p.tag === value);
	const vendor = currentProvider ? availableVendors.find(v => v.name === currentProvider.vendor) : null;
	const capabilityIcons = currentProvider && vendor ? getCapabilityDisplayText(vendor, currentProvider.options) : '';
	const displayText = currentProvider ? currentProvider.tag : 'Select model';

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
				<>
					{/* 主下拉列表：提供商列表 */}
					<div
						ref={providerListRef}
						style={{
							position: 'fixed',
							...getButtonPosition(),
							minWidth: `${PROVIDER_LIST_MIN_WIDTH}px`,
							maxWidth: `${PROVIDER_LIST_MAX_WIDTH}px`,
							zIndex: 1305,
							pointerEvents: 'auto'
						}}
						onMouseLeave={clearHoveredVendor}
					>
						<div
							role="menu"
							aria-orientation="vertical"
							style={{
								outline: 'none',
								borderRadius: 'var(--radius-m)',
								border: '1px solid var(--background-modifier-border)',
								background: 'var(--background-primary)',
								padding: '0.25rem',
								color: 'var(--text-normal)',
								boxShadow: 'var(--shadow-s)',
								maxHeight: `${PROVIDER_LIST_MAX_HEIGHT}px`,
								overflowY: 'auto'
							}}
							tabIndex={-1}
						>
							{vendorGroups.map((group) => {
								return (
									<div
										key={group.vendorName}
										role="menuitem"
										ref={(el) => {
											if (el) {
												vendorItemRefs.current.set(group.vendorName, el);
											} else {
												vendorItemRefs.current.delete(group.vendorName);
											}
										}}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '0.5rem',
											padding: '10px 12px',
											fontSize: 'var(--font-ui-small)',
											fontWeight: 500,
											cursor: 'pointer',
											userSelect: 'none',
											borderRadius: 'var(--radius-s)',
											transition: 'background-color 0.15s ease',
											backgroundColor: hoveredVendor === group.vendorName ? 'var(--background-modifier-hover)' : 'transparent'
										}}
										onMouseEnter={() => setHoveredVendorWithCancel(group.vendorName)}
									>
										<span>{group.vendorName}</span>
										<span style={{
											marginLeft: 'auto',
											fontSize: 'var(--font-ui-smaller)',
											color: 'var(--text-muted)',
											opacity: 0.7
										}}>
											({group.providers.length})
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* 侧边弹窗：当前悬停提供商的模型列表 */}
					{hoveredVendor && createPortal(
						<div
							ref={submenuRef}
							style={{
								position: 'fixed',
								...getSubmenuPosition(),
								minWidth: `${SUBMENU_MIN_WIDTH}px`,
								maxWidth: `${SUBMENU_MAX_WIDTH}px`,
								maxHeight: `${SUBMENU_MAX_HEIGHT}px`,
								overflowY: 'auto',
								zIndex: 1306,
								pointerEvents: 'auto'
							}}
							onMouseEnter={() => {
								// 鼠标进入弹窗时，取消清除定时器
								if (clearHoverTimerRef.current) {
									clearTimeout(clearHoverTimerRef.current);
									clearHoverTimerRef.current = null;
								}
							}}
							onMouseLeave={clearHoveredVendor}
						>
							<div
								role="menu"
								aria-orientation="vertical"
								style={{
									outline: 'none',
									borderRadius: 'var(--radius-m)',
									border: '1px solid var(--background-modifier-border)',
									background: 'var(--background-primary)',
									padding: '0.25rem',
									color: 'var(--text-normal)',
									boxShadow: 'var(--shadow-s)'
								}}
								tabIndex={-1}
							>
								{/* 弹窗标题：提供商名称 */}
								<div style={{
									padding: '8px 12px',
									fontSize: 'var(--font-ui-smaller)',
									fontWeight: 600,
									color: 'var(--text-muted)',
									borderBottom: '1px solid var(--background-modifier-border)',
									marginBottom: '4px'
								}}>
									{hoveredVendor}
								</div>

								{/* 模型列表 */}
								{vendorGroups
									.find(g => g.vendorName === hoveredVendor)
									?.providers.map((provider) => {
										const vendor = availableVendors.find(v => v.name === provider.vendor);
										const capabilityIcons = vendor ? getCapabilityDisplayText(vendor, provider.options) : '';
										const isSelected = provider.tag === value;

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
													marginBottom: '2px',
													backgroundColor: isSelected ? 'var(--background-modifier-hover)' : 'transparent'
													}}
													tabIndex={-1}
													onClick={() => {
														handleModelSelect(provider.tag);
													}}
												onMouseEnter={(e) => {
													e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
												}}
												onMouseLeave={(e) => {
													if (!isSelected) {
														e.currentTarget.style.backgroundColor = 'transparent';
													}
												}}
											>
												<div style={{display: 'flex', minWidth: 0, alignItems: 'center', gap: '0.25rem', flex: 1}}>
													<span style={{
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
														fontSize: 'var(--font-ui-small)'
													}}>
														{provider.tag}
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
				</>,
				document.body
			)}
		</div>
	);
};
