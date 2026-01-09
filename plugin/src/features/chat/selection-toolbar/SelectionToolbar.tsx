import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
	useFloating,
	flip,
	shift,
	offset,
	autoUpdate,
	useDismiss,
	useInteractions
} from '@floating-ui/react';
import { EditorView } from '@codemirror/view';
import { TFile, Notice } from 'obsidian';
import { MessageSquare, ChevronDown } from 'lucide-react';
import type { Skill, ChatSettings } from '../types/chat';
import type { SelectionInfo } from './SelectionToolbarExtension';
import { localInstance } from 'src/i18n/locals';
import './SelectionToolbar.css';

interface SelectionToolbarProps {
	visible: boolean;
	selectionInfo: SelectionInfo | null;
	settings: ChatSettings;
	onOpenChat: (selection: string) => void;
	onExecuteSkill: (skill: Skill, selection: string) => void;
	onClose: () => void;
}

export const SelectionToolbar = ({
	visible,
	selectionInfo,
	settings,
	onOpenChat,
	onExecuteSkill,
	onClose
}: SelectionToolbarProps) => {
	const [openMenu, setOpenMenu] = useState<
		| { type: 'more' }
		| { type: 'group'; groupId: string }
		| null
	>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const toolbarRootRef = useRef<HTMLDivElement>(null);
	const moreButtonRef = useRef<HTMLButtonElement>(null);
	const dropdownMenuRef = useRef<HTMLDivElement>(null);
	const groupButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const groupMenuRefs = useRef(new Map<string, HTMLDivElement>());
	const groupSubmenuAnchorRefs = useRef(new Map<string, HTMLDivElement>());
	const groupSubmenuMenuRefs = useRef(new Map<string, HTMLDivElement>());
	const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
	const [groupSubmenuPath, setGroupSubmenuPath] = useState<string[]>([]);

	// 截断按钮名称，最多显示4个字符
	const truncateName = (name: string): string => {
		return name.length > 4 ? name.slice(0, 4) : name;
	};

	// 每次工具栏重新显示时，重置下拉菜单为折叠状态并清除定时器
	useEffect(() => {
		if (visible) {
			setOpenMenu(null);
			// 清除可能存在的定时器
			if (closeTimerRef.current) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
		}
	}, [visible, selectionInfo]);

	const { toolbarItems, dropdownItems, skillsById } = useMemo(() => {
		const allSkills = (settings.skills || []).map(s => ({
			...s,
			isSkillGroup: s.isSkillGroup ?? false,
			children: s.children ?? []
		}));
		const byId = new Map(allSkills.map(s => [s.id, s] as const));
		const referenced = new Set<string>();
		for (const s of allSkills) {
			if (s.isSkillGroup) {
				for (const childId of (s.children ?? [])) {
					referenced.add(childId);
				}
			}
		}
		const topLevel = allSkills
			.filter(s => !referenced.has(s.id))
			.sort((a, b) => a.order - b.order);
		const topLevelVisible = topLevel.filter(s => {
			if (!(s.showInToolbar ?? true)) {
				return false;
			}
			if (s.isSkillGroup) {
				// 空组不显示在工具栏/更多里（允许存在，但不展示入口）
				return (s.children ?? []).length > 0;
			}
			return true;
		});

		const maxButtons = settings.maxToolbarButtons || 4;
		return {
			skillsById: byId,
			toolbarItems: topLevelVisible.slice(0, maxButtons),
			dropdownItems: topLevelVisible.slice(maxButtons)
		};
	}, [settings.skills, settings.maxToolbarButtons]);

	const isMoreDropdownOpen = openMenu?.type === 'more';
	const openGroupId = openMenu?.type === 'group' ? openMenu.groupId : null;

	const groupHasVisibleSkill = useMemo(() => {
		const cache = new Map<string, boolean>();
		const compute = (groupId: string): boolean => {
			if (cache.has(groupId)) {
				return cache.get(groupId)!;
			}
			const group = skillsById.get(groupId);
			if (!group || !group.isSkillGroup) {
				cache.set(groupId, false);
				return false;
			}
			const stack: string[] = [groupId];
			const visited = new Set<string>();
			while (stack.length > 0) {
				const id = stack.pop()!;
				if (visited.has(id)) {
					continue;
				}
				visited.add(id);
				const g = skillsById.get(id);
				if (!g || !g.isSkillGroup) {
					continue;
				}
				for (const childId of (g.children ?? [])) {
					const child = skillsById.get(childId);
					if (!child) {
						continue;
					}
					if (child.isSkillGroup) {
						stack.push(child.id);
					} else if (child.showInToolbar) {
						cache.set(groupId, true);
						return true;
					}
				}
			}
			cache.set(groupId, false);
			return false;
		};
		return compute;
	}, [skillsById]);

	const getMenuChildren = useCallback((groupId: string) => {
		const group = skillsById.get(groupId);
		if (!group || !group.isSkillGroup) {
			return [] as Skill[];
		}
		const result: Skill[] = [];
		for (const childId of (group.children ?? [])) {
			const child = skillsById.get(childId);
			if (!child) {
				continue;
			}
			if (child.isSkillGroup) {
				if (groupHasVisibleSkill(child.id)) {
					result.push(child);
				}
				continue;
			}
			if (child.showInToolbar) {
				result.push(child);
			}
		}
		return result;
	}, [skillsById, groupHasVisibleSkill]);

	useEffect(() => {
		setGroupSubmenuPath([]);
	}, [openMenu?.type, openGroupId]);

	// 虚拟参考元素（基于选区坐标）
	const virtualReference = useMemo(() => {
		if (!selectionInfo) {
			return {
				getBoundingClientRect: () => ({
					x: 0,
					y: 0,
					top: 0,
					left: 0,
					bottom: 0,
					right: 0,
					width: 0,
					height: 0
				}),
				getClientRects: () => []
			};
		}

		const { coords } = selectionInfo;
		return {
			getBoundingClientRect: () => ({
				x: coords.left,
				y: coords.top,
				top: coords.top,
				left: coords.left,
				bottom: coords.bottom,
				right: coords.right,
				width: coords.right - coords.left,
				height: coords.bottom - coords.top
			}),
			getClientRects: () => [
				{
					x: coords.left,
					y: coords.top,
					top: coords.top,
					left: coords.left,
					bottom: coords.bottom,
					right: coords.right,
					width: coords.right - coords.left,
					height: coords.bottom - coords.top
				}
			]
		};
	}, [selectionInfo]);

	// 使用 floating-ui 进行定位
	const { refs, floatingStyles, context } = useFloating({
		open: visible,
		onOpenChange: (open) => {
			if (!open) {
				onClose();
			}
		},
		placement: 'top',
		middleware: [
			offset(8),
			flip({
				fallbackPlacements: ['bottom', 'top-start', 'top-end', 'bottom-start', 'bottom-end']
			}),
			shift({
				padding: 8
			})
		],
		whileElementsMounted: autoUpdate
	});

	// 设置虚拟参考元素
	useEffect(() => {
		refs.setReference(virtualReference as any);
	}, [refs, virtualReference]);

	// 处理点击外部关闭
	const dismiss = useDismiss(context, {
		outsidePressEvent: 'mousedown'
	});
	const { getFloatingProps } = useInteractions([dismiss]);

	// 处理点击 AI Chat 按钮
	const handleChatClick = useCallback(() => {
		if (selectionInfo) {
			onOpenChat(selectionInfo.text);
		}
	}, [selectionInfo, onOpenChat]);

	// 处理点击技能按钮
	const handleSkillClick = useCallback((skill: Skill) => {
		if (selectionInfo) {
			onExecuteSkill(skill, selectionInfo.text);
		}
	}, [selectionInfo, onExecuteSkill]);

	// 处理下拉菜单切换
	const toggleDropdown = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setOpenMenu(prev => (prev?.type === 'more' ? null : { type: 'more' }));
	}, []);

	// 处理下拉菜单项点击
	const handleDropdownSkillClick = useCallback((skill: Skill, e: React.MouseEvent) => {
		e.stopPropagation();
		setOpenMenu(null);
		if (selectionInfo) {
			onExecuteSkill(skill, selectionInfo.text);
		}
	}, [selectionInfo, onExecuteSkill]);

	// 清除关闭定时器
	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current) {
			clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	const scheduleClose = useCallback(() => {
		if (closeTimerRef.current) {
			return;
		}
		closeTimerRef.current = setTimeout(() => {
			setOpenMenu(null);
			setGroupSubmenuPath([]);
		}, 100);
	}, []);

	// 鼠标悬停在"更多"按钮上时打开下拉菜单
	const handleMoreButtonMouseEnter = useCallback(() => {
		clearCloseTimer();
		setOpenMenu({ type: 'more' });
	}, [clearCloseTimer]);

	// 鼠标悬停在下拉菜单列表上时取消关闭
	const handleDropdownMenuMouseEnter = useCallback(() => {
		clearCloseTimer();
	}, [clearCloseTimer]);

	// 鼠标离开联合区域时延迟关闭下拉菜单
	const handleDropdownMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		const relatedTarget = e.relatedTarget as Node;

		// 检查鼠标移动的目标是否在"更多"按钮或下拉菜单列表内
		const isMovingToButton = moreButtonRef.current?.contains(relatedTarget);
		const isMovingToMenu = dropdownMenuRef.current?.contains(relatedTarget);

		// 只有当鼠标移动到这两个区域之外时才延迟关闭下拉菜单
		if (!isMovingToButton && !isMovingToMenu) {
			scheduleClose();
		}
	}, [scheduleClose]);

	// 悬停关闭（更稳：鼠标从菜单移到非按钮区域时也关闭）
	useEffect(() => {
		if (!openMenu) {
			return;
		}
		const onPointerMove = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) {
				return;
			}

			const isInEl = (el: HTMLElement | null | undefined) => {
				return !!el && el.contains(target);
			};

			if (openMenu.type === 'more') {
				if (isInEl(moreButtonRef.current) || isInEl(dropdownMenuRef.current)) {
					clearCloseTimer();
					return;
				}
				for (const submenuGroupId of groupSubmenuPath) {
					const submenuEl = groupSubmenuMenuRefs.current.get(submenuGroupId) ?? null;
					if (isInEl(submenuEl)) {
						clearCloseTimer();
						return;
					}
				}
				scheduleClose();
				return;
			}

			const groupId = openMenu.groupId;
			const btn = groupButtonRefs.current.get(groupId) ?? null;
			const menu = groupMenuRefs.current.get(groupId) ?? null;
			if (isInEl(btn) || isInEl(menu)) {
				clearCloseTimer();
				return;
			}
			for (const submenuGroupId of groupSubmenuPath) {
				const submenuEl = groupSubmenuMenuRefs.current.get(submenuGroupId) ?? null;
				if (isInEl(submenuEl)) {
					clearCloseTimer();
					return;
				}
			}
			scheduleClose();
		};

		window.addEventListener('pointermove', onPointerMove, true);
		return () => window.removeEventListener('pointermove', onPointerMove, true);
	}, [openMenu, groupSubmenuPath, clearCloseTimer, scheduleClose]);

	// 点击外部关闭下拉菜单
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (toolbarRootRef.current && !toolbarRootRef.current.contains(e.target as Node)) {
				setOpenMenu(null);
			}
		};

		if (openMenu) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [openMenu]);

	// 如果不可见，不渲染
	if (!visible || !selectionInfo) {
		return null;
	}

	const toolbarContent = (
		<div
			ref={(node) => {
				refs.setFloating(node);
				toolbarRootRef.current = node;
			}}
			className="selection-toolbar"
			style={{ ...floatingStyles, gap: '1px' }}
			{...getFloatingProps()}
		>
			{/* AI Chat 按钮（固定） */}
			<button
				className="selection-toolbar-btn selection-toolbar-btn-primary"
				onClick={handleChatClick}
				title={localInstance.selection_toolbar_ai_chat || 'AI Chat'}
			>
				<MessageSquare size={14} />
			</button>

			{/* 技能按钮 */}
			{toolbarItems.map((item) => {
				if (!item.isSkillGroup) {
					return (
						<button
							key={item.id}
							className="selection-toolbar-btn"
							onClick={() => handleSkillClick(item)}
							title={item.name}
						>
							<span>{truncateName(item.name)}</span>
						</button>
					);
				}

				const group = item;
				return (
					<div
						key={group.id}
						className="selection-toolbar-dropdown selection-toolbar-skill-group"
					>
						<button
							ref={(el) => {
								if (el) {
									groupButtonRefs.current.set(group.id, el);
								} else {
									groupButtonRefs.current.delete(group.id);
								}
							}}
							className="selection-toolbar-btn selection-toolbar-btn-group"
							onClick={(e) => {
								e.stopPropagation();
								clearCloseTimer();
								setOpenMenu(prev =>
									(prev?.type === 'group' && prev.groupId === group.id)
										? null
										: { type: 'group', groupId: group.id }
								);
							}}
							onMouseEnter={() => {
								clearCloseTimer();
								setGroupSubmenuPath([]);
								setOpenMenu({ type: 'group', groupId: group.id });
							}}
							title={group.name}
						>
							<span>{truncateName(group.name)}⇣</span>
						</button>

						{openGroupId === group.id && (
							<div
								className="selection-toolbar-dropdown-menu"
								ref={(el) => {
									if (el) {
										groupMenuRefs.current.set(group.id, el);
									} else {
										groupMenuRefs.current.delete(group.id);
									}
								}}
								onMouseEnter={handleDropdownMenuMouseEnter}
							>
								{(() => {
									const children = openGroupId ? getMenuChildren(openGroupId) : [];
									if (children.length === 0) {
										return (
											<div className="selection-toolbar-dropdown-empty">
												{localInstance.selection_toolbar_no_more_skills || '暂无技能'}
											</div>
										);
									}
									return children.map((child) => {
										if (child.isSkillGroup) {
											return (
												<div
													key={child.id}
													className="selection-toolbar-dropdown-item selection-toolbar-dropdown-item-group selection-toolbar-dropdown-item-submenu"
													ref={(el) => {
														if (el) {
															groupSubmenuAnchorRefs.current.set(child.id, el);
														} else {
															groupSubmenuAnchorRefs.current.delete(child.id);
														}
													}}
													onMouseEnter={() => {
													clearCloseTimer();
													setGroupSubmenuPath([child.id]);
												}}
												>
													<span>{child.name}</span>
													<span className="selection-toolbar-dropdown-item-submenu-arrow">
														<ChevronDown size={12} />
													</span>
												</div>
											);
										}
										return (
											<div
												key={child.id}
												className="selection-toolbar-dropdown-item"
												onMouseEnter={() => setGroupSubmenuPath([])}
												onClick={(e) => handleDropdownSkillClick(child, e)}
											>
												{child.name}
											</div>
										);
									});
								})()}
							</div>
						)}
					</div>
				);
			})}

			{/* 技能组子菜单（级联浮层，独立出现） */}
			{openMenu && groupSubmenuPath.length > 0 && (
				<>
					{groupSubmenuPath.map((submenuGroupId, levelIndex) => {
						const anchorEl = groupSubmenuAnchorRefs.current.get(submenuGroupId);
						if (!anchorEl) {
							return null;
						}
						const rect = anchorEl.getBoundingClientRect();
						const estimatedWidth = 220;
						const estimatedHeight = 260;
						const gap = 2;
						let left = rect.right + gap;
						let top = rect.top;
						left = Math.min(left, window.innerWidth - estimatedWidth - 8);
						top = Math.min(top, window.innerHeight - estimatedHeight - 8);
						left = Math.max(8, left);
						top = Math.max(8, top);

						const submenuChildren = getMenuChildren(submenuGroupId);
						const panel = (
							<div
								className="selection-toolbar-dropdown-menu selection-toolbar-dropdown-menu-submenu"
								style={{ left, top }}
								ref={(el) => {
									if (el) {
										groupSubmenuMenuRefs.current.set(submenuGroupId, el);
									} else {
										groupSubmenuMenuRefs.current.delete(submenuGroupId);
									}
								}}
								onMouseEnter={() => {
									clearCloseTimer();
								}}
							>
								{submenuChildren.length > 0 ? (
									submenuChildren.map((child) => {
										if (child.isSkillGroup) {
											return (
												<div
													key={child.id}
													className="selection-toolbar-dropdown-item selection-toolbar-dropdown-item-group selection-toolbar-dropdown-item-submenu"
													ref={(el) => {
														if (el) {
															groupSubmenuAnchorRefs.current.set(child.id, el);
														} else {
															groupSubmenuAnchorRefs.current.delete(child.id);
														}
													}}
													onMouseEnter={() => {
														clearCloseTimer();
														setGroupSubmenuPath((prev) => {
															const next = prev.slice(0, levelIndex + 1);
															next[levelIndex + 1] = child.id;
															return next;
														});
													}}
												>
													<span>{child.name}</span>
													<span className="selection-toolbar-dropdown-item-submenu-arrow">
														<ChevronDown size={12} />
													</span>
												</div>
											);
										}
										return (
											<div
												key={child.id}
												className="selection-toolbar-dropdown-item"
												onMouseEnter={() => {
													setGroupSubmenuPath((prev) => prev.slice(0, levelIndex + 1));
												}}
												onClick={(e) => handleDropdownSkillClick(child, e)}
											>
												{child.name}
											</div>
										);
									})
								) : (
									<div className="selection-toolbar-dropdown-empty">
										{localInstance.selection_toolbar_no_more_skills || '暂无技能'}
									</div>
								)}
							</div>
						);

						return createPortal(panel, document.body);
					})}
				</>
			)}

			{/* 下拉菜单按钮 */}
			{(dropdownItems.length > 0 || toolbarItems.length === 0) && (
				<div
					className="selection-toolbar-dropdown"
					ref={dropdownRef}
					onMouseLeave={handleDropdownMouseLeave}
				>
					<button
						ref={moreButtonRef}
						className="selection-toolbar-btn selection-toolbar-btn-more"
						onClick={toggleDropdown}
						onMouseEnter={handleMoreButtonMouseEnter}
						title={localInstance.selection_toolbar_more || '更多'}
					>
						<ChevronDown size={14} />
					</button>

					{isMoreDropdownOpen && (
						<div
							className="selection-toolbar-dropdown-menu"
							ref={dropdownMenuRef}
							onMouseEnter={handleDropdownMenuMouseEnter}
						>
							{dropdownItems.length > 0 ? (
								dropdownItems.map((item) => {
									if (item.isSkillGroup) {
										return (
											<div
												key={item.id}
												className="selection-toolbar-dropdown-item selection-toolbar-dropdown-item-group selection-toolbar-dropdown-item-submenu"
												ref={(el) => {
													if (el) {
														groupSubmenuAnchorRefs.current.set(item.id, el);
													} else {
														groupSubmenuAnchorRefs.current.delete(item.id);
													}
												}}
												onMouseEnter={() => {
													clearCloseTimer();
													setGroupSubmenuPath([item.id]);
												}}
											>
												<span>{item.name}</span>
												<span className="selection-toolbar-dropdown-item-submenu-arrow">
													<ChevronDown size={12} />
												</span>
											</div>
										);
									}
									return (
										<div
											key={item.id}
											className="selection-toolbar-dropdown-item"
											onMouseEnter={() => setGroupSubmenuPath([])}
											onClick={(e) => handleDropdownSkillClick(item, e)}
									>
										{item.name}
									</div>
									);
								})
							) : (
								<div className="selection-toolbar-dropdown-empty">
									{localInstance.selection_toolbar_no_more_skills || '暂无更多技能'}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);

	// 使用 Portal 渲染到 document.body
	return createPortal(toolbarContent, document.body);
};

export default SelectionToolbar;
