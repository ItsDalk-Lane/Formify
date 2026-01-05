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
import { MessageSquare, ChevronDown, MoreHorizontal } from 'lucide-react';
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
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// 每次工具栏重新显示时，重置下拉菜单为折叠状态
	useEffect(() => {
		if (visible) {
			setIsDropdownOpen(false);
		}
	}, [visible, selectionInfo]);

	// 获取要显示的技能
	const { toolbarSkills, dropdownSkills } = useMemo(() => {
		const enabledSkills = (settings.skills || [])
			.filter(skill => skill.showInToolbar)
			.sort((a, b) => a.order - b.order);

		const maxButtons = settings.maxToolbarButtons || 4;

		return {
			toolbarSkills: enabledSkills.slice(0, maxButtons),
			dropdownSkills: enabledSkills.slice(maxButtons)
		};
	}, [settings.skills, settings.maxToolbarButtons]);

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
		setIsDropdownOpen(prev => !prev);
	}, []);

	// 处理下拉菜单项点击
	const handleDropdownSkillClick = useCallback((skill: Skill, e: React.MouseEvent) => {
		e.stopPropagation();
		setIsDropdownOpen(false);
		if (selectionInfo) {
			onExecuteSkill(skill, selectionInfo.text);
		}
	}, [selectionInfo, onExecuteSkill]);

	// 点击外部关闭下拉菜单
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setIsDropdownOpen(false);
			}
		};

		if (isDropdownOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [isDropdownOpen]);

	// 如果不可见，不渲染
	if (!visible || !selectionInfo) {
		return null;
	}

	const toolbarContent = (
		<div
			ref={refs.setFloating}
			className="selection-toolbar"
			style={floatingStyles}
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
			{toolbarSkills.map((skill) => (
				<button
					key={skill.id}
					className="selection-toolbar-btn"
					onClick={() => handleSkillClick(skill)}
					title={skill.name}
				>
					<span>{skill.name}</span>
				</button>
			))}

			{/* 下拉菜单按钮 */}
			{(dropdownSkills.length > 0 || toolbarSkills.length === 0) && (
				<div className="selection-toolbar-dropdown" ref={dropdownRef}>
					<button
						className="selection-toolbar-btn selection-toolbar-btn-more"
						onClick={toggleDropdown}
						title={localInstance.selection_toolbar_more || '更多'}
					>
						<ChevronDown size={14} />
					</button>
					
					{isDropdownOpen && (
						<div className="selection-toolbar-dropdown-menu">
							{dropdownSkills.length > 0 ? (
								dropdownSkills.map((skill) => (
									<div
										key={skill.id}
										className="selection-toolbar-dropdown-item"
										onClick={(e) => handleDropdownSkillClick(skill, e)}
									>
										{skill.name}
									</div>
								))
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
