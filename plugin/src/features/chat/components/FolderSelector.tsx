import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { App, TFolder } from 'obsidian';

interface FolderItem {
	folder: TFolder;
	level: number;
	isExpanded: boolean;
}

interface FolderSelectorProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (folders: TFolder[]) => void;
	app: App;
	buttonRef: React.RefObject<HTMLElement>;
}

export const FolderSelector = ({ isOpen, onClose, onSelect, app, buttonRef }: FolderSelectorProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/']));

	// 点击外部关闭
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (popupRef.current && !popupRef.current.contains(event.target as Node) &&
				buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
				onClose();
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose, buttonRef]);

	// 获取文件夹树结构
	const getFolderTree = (): FolderItem[] => {
		const items: FolderItem[] = [];
		const query = searchQuery.toLowerCase().trim();

		const collectFolders = (folder: TFolder, level: number = 0) => {
			// 使用原始文件夹名进行搜索匹配（与菜单栏搜索保持一致）
			const originalFolderName = folder.name.toLowerCase();
			const isMatched = !query || originalFolderName.includes(query);

			// 如果当前文件夹匹配，或者没有搜索条件，则显示
			if (isMatched) {
				items.push({
					folder,
					level,
					isExpanded: expandedFolders.has(folder.path) || (query ? true : false)
				});
			}

			// 处理子文件夹：
			// 1. 没有搜索条件时，只处理已展开的文件夹的子项
			// 2. 有搜索条件时，搜索所有文件夹层级
			if (!query) {
				// 没有搜索条件，只处理已展开的文件夹
				if (expandedFolders.has(folder.path)) {
					const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
					subfolders.sort((a, b) => a.name.localeCompare(b.name));
					subfolders.forEach(subfolder => collectFolders(subfolder, level + 1));
				}
			} else {
				// 有搜索条件，处理所有子文件夹进行递归搜索
				const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
				subfolders.sort((a, b) => a.name.localeCompare(b.name));
				subfolders.forEach(subfolder => collectFolders(subfolder, level + 1));
			}
		};

		const rootFolder = app.vault.getRoot();
		collectFolders(rootFolder);

		return items;
	};

	const toggleFolder = (folderPath: string) => {
		const newExpanded = new Set(expandedFolders);
		if (newExpanded.has(folderPath)) {
			newExpanded.delete(folderPath);
		} else {
			newExpanded.add(folderPath);
		}
		setExpandedFolders(newExpanded);
	};

	const handleFolderToggle = (folder: TFolder) => {
		const newSelected = new Set(selectedFolders);
		if (newSelected.has(folder.path)) {
			newSelected.delete(folder.path);
		} else {
			newSelected.add(folder.path);
		}
		setSelectedFolders(newSelected);
	};

	
	if (!isOpen) return null;

	// 计算弹出菜单位置
	const buttonRect = buttonRef.current?.getBoundingClientRect();
	const popupStyle: React.CSSProperties = {
		position: 'fixed',
		bottom: buttonRect ? `${window.innerHeight - buttonRect.top + 8}px` : 'auto',
		left: buttonRect ? `${buttonRect.left}px` : 'auto',
		zIndex: 1000,
		minWidth: '400px',
		maxWidth: '500px',
		maxHeight: '500px',
		overflow: 'hidden'
	};

	const folderTree = getFolderTree();

	return createPortal(
		<>
			{/* 模态覆盖层 */}
			<div
				className="tw-fixed tw-inset-0 tw-bg-black tw-opacity-50 tw-z-[1001]"
				onClick={onClose}
			/>
			{/* 文件夹选择器弹出层 */}
			<div ref={popupRef} className="folder-selector-popup" style={{ ...popupStyle, zIndex: 1002 }}>
				<div className="tw-bg-background tw-border tw-border-border tw-rounded-lg tw-shadow-lg tw-flex tw-flex-col">
					{/* 搜索框 */}
					<div className="tw-p-4 tw-border-b tw-border-border">
						<div className="tw-relative">
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="搜索文件夹..."
								className="tw-w-full tw-pl-4 tw-pr-4 tw-py-2 tw-text-sm tw-border tw-border-border tw-rounded-md focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary"
								autoFocus
							/>
						</div>
					</div>

					{/* 文件夹列表 */}
					<div className="tw-flex-1 tw-overflow-y-auto" style={{ maxHeight: '400px' }}>
						{folderTree.length === 0 ? (
							<div className="tw-text-center tw-py-8 tw-text-muted-foreground tw-text-sm">
								{searchQuery ? '未找到匹配的文件夹' : '没有可选择的文件夹'}
							</div>
						) : (
							<div className="tw-p-2">
								{folderTree.map(({ folder, level, isExpanded }) => (
									<div key={folder.path}>
										<div
											onClick={() => {
												// 切换展开状态
												if (folder.children.some(child => child instanceof TFolder)) {
													toggleFolder(folder.path);
												}
												// 选择/取消选择
												handleFolderToggle(folder);
											}}
											className={`tw-flex tw-items-center tw-gap-2 tw-py-2 tw-px-3 tw-rounded-lg tw-cursor-pointer transition-colors ${
												selectedFolders.has(folder.path)
													? 'tw-bg-primary tw-text-primary-foreground'
													: 'hover:tw-bg-accent hover:tw-text-accent-foreground'
											}`}
											style={{ paddingLeft: `${8 + level * 16}px` }}
										>
											{folder.children.some(child => child instanceof TFolder) && (
												<div className="tw-flex-shrink-0">
													{isExpanded ? (
														<ChevronDown className="tw-size-3" />
													) : (
														<ChevronRight className="tw-size-3" />
													)}
												</div>
											)}
											<Folder className="tw-size-4 tw-flex-shrink-0" />
											<div className="tw-flex-1 tw-min-w-0">
												<div className="tw-font-medium tw-truncate">{folder.name === '' ? '根目录' : folder.name}</div>
												<div className="tw-text-xs tw-opacity-70 tw-truncate">{folder.path}</div>
											</div>
											{selectedFolders.has(folder.path) && (
												<div className="tw-w-4 tw-h-4 tw-rounded-full tw-bg-current tw-flex tw-items-center tw-justify-center">
													<span className="tw-text-xs">✓</span>
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</>,
		document.body
	);
};