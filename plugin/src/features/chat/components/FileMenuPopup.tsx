import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { File, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { App, TFile, TFolder, CachedMetadata } from 'obsidian';

interface FileMenuPopupProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectFile: (file: TFile) => void;
	onSelectFolder: (folder: TFolder) => void;
	app: App;
	buttonRef: React.RefObject<HTMLSpanElement>;
}

type ViewType = 'menu' | 'fileSelector' | 'folderSelector';

interface FolderItem {
	folder: TFolder;
	level: number;
	isExpanded: boolean;
}

export const FileMenuPopup = ({ isOpen, onClose, onSelectFile, onSelectFolder, app, buttonRef }: FileMenuPopupProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [currentView, setCurrentView] = useState<ViewType>('menu');

	// 主菜单搜索状态
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<Array<{
		type: 'file' | 'folder';
		file?: TFile;
		folder?: TFolder;
		matches: string[]
	}>>();
	const [isSearching, setIsSearching] = useState(false);

	// 文件选择器状态
	const [fileSearchQuery, setFileSearchQuery] = useState('');
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

	// 文件夹选择器状态
	const [folderSearchQuery, setFolderSearchQuery] = useState('');
	const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/']));

	// 点击外部关闭弹出菜单
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

	// 重置视图状态的useEffect
	useEffect(() => {
		if (isOpen) {
			setCurrentView('menu');
			setSearchQuery('');
			setSearchResults([]);
			setFileSearchQuery('');
			setSelectedFiles(new Set());
			setFolderSearchQuery('');
			setSelectedFolders(new Set());
		}
	}, [isOpen]);

	// 搜索文件和文件夹功能
	useEffect(() => {
		if (currentView !== 'menu' || searchQuery.trim() === '') {
			setSearchResults([]);
			return;
		}

		const performSearch = async () => {
			setIsSearching(true);
			try {
				const query = searchQuery.toLowerCase();
				const results: Array<{ type: 'file' | 'folder'; file?: TFile; folder?: TFolder; matches: string[] }> = [];

				// 搜索文件夹
				const allFolders = app.vault.getAllLoadedFiles().filter(item =>
					item instanceof TFolder
				) as TFolder[];

				for (const folder of allFolders) {
					if (folder.name.toLowerCase().includes(query)) {
						results.push({
							type: 'folder',
							folder,
							matches: [`文件夹: ${folder.name}`]
						});
					}
				}

				// 搜索文件
				const files = app.vault.getFiles();
				for (const file of files) {
					// 只搜索文件，跳过文件夹
					if (file.extension === undefined) {
						continue;
					}

					const cache = app.metadataCache.getFileCache(file);
					if (cache) {
						const matches = searchInFile(file, cache, query);
						if (matches.length > 0) {
							results.push({
								type: 'file',
								file,
								matches
							});
						}
					}
				}

				// 文件夹在前，文件在后
				setSearchResults(results.slice(0, 10));
			} catch (error) {
				console.error('搜索时出错:', error);
			} finally {
				setIsSearching(false);
			}
		};

		const timeoutId = setTimeout(performSearch, 300);
		return () => clearTimeout(timeoutId);
	}, [searchQuery, app, currentView]);

	// 在文件内容中搜索
	const searchInFile = (file: TFile, cache: CachedMetadata, query: string): string[] => {
		const matches: string[] = [];

		// 搜索文件名
		if (file.name.toLowerCase().includes(query)) {
			matches.push(`文件名: ${file.name}`);
		}

		// 搜索标题
		if (cache.headings) {
			for (const heading of cache.headings) {
				if (heading.heading.toLowerCase().includes(query)) {
					matches.push(`标题: ${heading.heading}`);
				}
			}
		}

		// 搜索标签
		if (cache.tags) {
			for (const tag of cache.tags) {
				if (tag.tag.toLowerCase().includes(query)) {
					matches.push(`标签: ${tag.tag}`);
				}
			}
		}

		// 搜索链接
		if (cache.links) {
			for (const link of cache.links) {
				if (link.displayText && link.displayText.toLowerCase().includes(query)) {
					matches.push(`链接: ${link.displayText}`);
				}
			}
		}

		return matches;
	};

	// 获取过滤后的文件列表
	const getFilteredFiles = () => {
		const allFiles = app.vault.getFiles()
			.filter(file => !file.path.startsWith('.obsidian'))
			.filter(file => {
				if (!fileSearchQuery) return true;
				const query = fileSearchQuery.toLowerCase();
				return file.name.toLowerCase().includes(query) ||
					   file.path.toLowerCase().includes(query);
			})
			.sort((a, b) => {
				// 按照最近修改时间排序，最近修改的在前
				const timeA = a.stat?.mtime || 0;
				const timeB = b.stat?.mtime || 0;
				return timeB - timeA;
			});
		return allFiles;
	};

	// 获取文件夹树结构
	const getFolderTree = (): FolderItem[] => {
		const items: FolderItem[] = [];
		const query = folderSearchQuery.toLowerCase().trim();

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

	const handleFileToggle = (file: TFile) => {
		const newSelected = new Set(selectedFiles);
		if (newSelected.has(file.path)) {
			newSelected.delete(file.path);
		} else {
			newSelected.add(file.path);
		}
		setSelectedFiles(newSelected);
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

	const handleFileSelect = () => {
		const files = getFilteredFiles().filter(file => selectedFiles.has(file.path));
		files.forEach(file => onSelectFile(file)); // 支持多文件选择
		onClose();
	};

	const handleFolderSelect = () => {
		const allFolders = app.vault.getAllLoadedFiles().filter(item => item instanceof TFolder) as TFolder[];
		const folders = allFolders.filter(folder => selectedFolders.has(folder.path));
		folders.forEach(folder => onSelectFolder(folder)); // 支持多文件夹选择
		onClose();
	};

	const goBackToMenu = () => {
		setCurrentView('menu');
	};

	if (!isOpen) return null;

	// 计算弹出菜单位置
	const buttonRect = buttonRef.current?.getBoundingClientRect();
	const popupStyle: React.CSSProperties = {
		position: 'fixed',
		bottom: buttonRect ? `${window.innerHeight - buttonRect.top + 8}px` : 'auto',
		left: buttonRect ? `${buttonRect.left}px` : 'auto',
		zIndex: 1000,
		minWidth: '320px',
		maxWidth: '500px',
		maxHeight: '500px',
		overflow: 'hidden'
	};

	return createPortal(
		<div ref={popupRef} className="file-menu-popup" style={popupStyle}>
			<div className="tw-bg-background tw-border tw-border-border tw-rounded-lg tw-shadow-lg tw-flex tw-flex-col">
				{currentView === 'menu' && (
					<>
						{/* 菜单选项 */}
						<div className="tw-flex tw-flex-col tw-gap-1 tw-p-2">
							<div
								onClick={() => setCurrentView('fileSelector')}
								className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-text-sm tw-rounded hover:tw-bg-accent hover:tw-text-accent-foreground tw-cursor-pointer tw-text-left"
							>
								<File className="tw-size-4" />
								<span>选择文件</span>
							</div>
							<div
								onClick={() => setCurrentView('folderSelector')}
								className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-text-sm tw-rounded hover:tw-bg-accent hover:tw-text-accent-foreground tw-cursor-pointer tw-text-left"
							>
								<Folder className="tw-size-4" />
								<span>选择文件夹</span>
							</div>
						</div>

						{/* 分隔线 */}
						<div className="tw-border-t tw-border-border tw-my-2"></div>

						{/* 搜索框 */}
						<div className="tw-px-3 tw-pb-2">
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="搜索仓库中的文件和文件夹..."
								className="tw-w-full tw-pl-4 tw-pr-4 tw-py-2 tw-text-sm tw-border tw-border-border tw-rounded-md focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary"
								autoFocus
							/>
						</div>

						{/* 搜索结果 */}
						{searchQuery && (
							<div className="tw-max-h-48 tw-overflow-y-auto tw-px-2 tw-pb-2">
								{isSearching ? (
									<div className="tw-text-center tw-py-4 tw-text-muted-foreground tw-text-sm">
										搜索中...
									</div>
								) : searchResults && searchResults.length > 0 ? (
									<div className="tw-flex tw-flex-col tw-gap-1">
										{searchResults.map((result) => (
											<div
												key={result.type === 'folder' ? result.folder?.path : result.file?.path}
												onClick={() => {
													if (result.type === 'folder' && result.folder) {
														onSelectFolder(result.folder);
													} else if (result.file) {
														onSelectFile(result.file);
													}
													onClose();
												}}
												className="tw-p-2 tw-text-sm tw-rounded hover:tw-bg-accent hover:tw-text-accent-foreground tw-cursor-pointer"
											>
												<div className="tw-font-medium tw-text-foreground">
													{result.type === 'folder'
														? `📁 ${result.folder?.name}`
														: `📄 ${result.file?.basename}`
													}
												</div>
												<div className="tw-text-xs tw-text-muted-foreground tw-mt-1">
													{result.matches.slice(0, 2).map((match, index) => (
														<div key={index} className="tw-truncate">{match}</div>
													))}
													{result.matches.length > 2 && (
														<div className="tw-text-muted-foreground">还有 {result.matches.length - 2} 个匹配...</div>
													)}
												</div>
											</div>
										))}
									</div>
								) : (
									<div className="tw-text-center tw-py-4 tw-text-muted-foreground tw-text-sm">
										未找到匹配的文件或文件夹
									</div>
								)}
							</div>
						)}
					</>
				)}

				{currentView === 'fileSelector' && (
					<>
						{/* 返回按钮和标题 */}
						<div className="tw-flex tw-items-center tw-justify-between tw-p-3 tw-border-b tw-border-border">
							<div className="tw-flex tw-items-center tw-gap-2">
								<button
									onClick={goBackToMenu}
									className="tw-text-muted-foreground hover:tw-text-foreground tw-cursor-pointer"
								>
									← 返回
								</button>
								<span className="tw-text-sm tw-font-medium">选择文件</span>
							</div>
							{selectedFiles.size > 0 && (
								<div className="tw-flex tw-items-center tw-gap-2">
									<button
										onClick={() => setSelectedFiles(new Set())}
										className="tw-px-3 tw-py-1 tw-text-xs tw-border tw-border-border tw-rounded hover:tw-bg-accent tw-text-muted-foreground hover:tw-text-foreground"
									>
										取消
									</button>
									<button
										onClick={handleFileSelect}
										className="tw-px-3 tw-py-1 tw-text-xs tw-bg-primary tw-text-primary-foreground tw-rounded hover:tw-bg-primary/90"
									>
										确认 ({selectedFiles.size})
									</button>
								</div>
							)}
						</div>

						{/* 搜索框 */}
						<div className="tw-px-3 tw-pb-2 tw-pt-2 tw-border-b tw-border-border">
							<input
								type="text"
								value={fileSearchQuery}
								onChange={(e) => setFileSearchQuery(e.target.value)}
								placeholder="搜索文件名..."
								className="tw-w-full tw-pl-4 tw-pr-4 tw-py-2 tw-text-sm tw-border tw-border-border tw-rounded-md focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary"
								autoFocus
							/>
						</div>

						{/* 文件列表 */}
						<div className="tw-flex-1 tw-overflow-y-auto" style={{ maxHeight: '400px' }}>
							{getFilteredFiles().length === 0 ? (
								<div className="tw-text-center tw-py-8 tw-text-muted-foreground tw-text-sm">
									{fileSearchQuery ? '未找到匹配的文件' : '没有可选择的文件'}
								</div>
							) : (
								<div className="tw-p-2">
									{getFilteredFiles().map(file => (
										<div
											key={file.path}
											onClick={() => handleFileToggle(file)}
											className={`tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-cursor-pointer transition-colors ${
												selectedFiles.has(file.path)
													? 'tw-bg-primary tw-text-primary-foreground'
													: 'hover:tw-bg-accent hover:tw-text-accent-foreground'
											}`}
										>
											<File className="tw-size-4 tw-flex-shrink-0" />
											<div className="tw-flex-1 tw-min-w-0">
												<div className="tw-font-medium tw-truncate">{file.name}</div>
												<div className="tw-text-xs tw-opacity-70 tw-truncate">{file.path}</div>
											</div>
											{selectedFiles.has(file.path) && (
												<div className="tw-w-4 tw-h-4 tw-rounded-full tw-bg-current tw-flex tw-items-center tw-justify-center">
													<span className="tw-text-xs">✓</span>
												</div>
											)}
										</div>
									))}
								</div>
							)}
						</div>

						{/* 底部操作按钮 */}
						{selectedFiles.size === 0 && (
							<div className="tw-p-3 tw-border-t tw-border-border">
								<div className="tw-text-center tw-text-xs tw-text-muted-foreground">
									请选择要上传的文件
								</div>
							</div>
						)}
					</>
				)}

				{currentView === 'folderSelector' && (
					<>
						{/* 返回按钮和标题 */}
						<div className="tw-flex tw-items-center tw-justify-between tw-p-3 tw-border-b tw-border-border">
							<div className="tw-flex tw-items-center tw-gap-2">
								<button
									onClick={goBackToMenu}
									className="tw-text-muted-foreground hover:tw-text-foreground tw-cursor-pointer"
								>
									← 返回
								</button>
								<span className="tw-text-sm tw-font-medium">选择文件夹</span>
							</div>
							{selectedFolders.size > 0 && (
								<div className="tw-flex tw-items-center tw-gap-2">
									<button
										onClick={() => setSelectedFolders(new Set())}
										className="tw-px-3 tw-py-1 tw-text-xs tw-border tw-border-border tw-rounded hover:tw-bg-accent tw-text-muted-foreground hover:tw-text-foreground"
									>
										取消
									</button>
									<button
										onClick={handleFolderSelect}
										className="tw-px-3 tw-py-1 tw-text-xs tw-bg-primary tw-text-primary-foreground tw-rounded hover:tw-bg-primary/90"
									>
										确认 ({selectedFolders.size})
									</button>
								</div>
							)}
						</div>

						{/* 搜索框 */}
						<div className="tw-px-3 tw-pb-2 tw-pt-2 tw-border-b tw-border-border">
							<input
								type="text"
								value={folderSearchQuery}
								onChange={(e) => setFolderSearchQuery(e.target.value)}
								placeholder="搜索文件夹..."
								className="tw-w-full tw-pl-4 tw-pr-4 tw-py-2 tw-text-sm tw-border tw-border-border tw-rounded-md focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary"
								autoFocus
							/>
						</div>

						{/* 文件夹列表 */}
						<div className="tw-flex-1 tw-overflow-y-auto" style={{ maxHeight: '400px' }}>
							{getFolderTree().length === 0 ? (
								<div className="tw-text-center tw-py-8 tw-text-muted-foreground tw-text-sm">
									{folderSearchQuery ? '未找到匹配的文件夹' : '没有可选择的文件夹'}
								</div>
							) : (
								<div className="tw-p-2">
									{getFolderTree().map(({ folder, level, isExpanded }) => (
										<div key={folder.path}>
											<div className={`tw-flex tw-items-center tw-py-2 tw-px-3 tw-rounded-lg transition-colors ${
												selectedFolders.has(folder.path)
													? 'tw-bg-primary tw-text-primary-foreground'
													: 'hover:tw-bg-accent hover:tw-text-accent-foreground'
											}`} style={{ paddingLeft: `${8 + level * 16}px` }}>
												{/* 展开/折叠按钮区域 */}
												<div className="tw-flex-shrink-0 tw-w-4 tw-h-4 tw-flex tw-items-center tw-justify-center">
													{folder.children.some(child => child instanceof TFolder) ? (
														<button
															onClick={(e) => {
																e.stopPropagation();
																toggleFolder(folder.path);
															}}
															className="tw-p-1 tw-rounded hover:tw-bg-accent/50 tw-cursor-pointer tw-text-current"
														>
															{isExpanded ? (
																<ChevronDown className="tw-size-3" />
															) : (
																<ChevronRight className="tw-size-3" />
															)}
														</button>
													) : (
														<div className="tw-w-4 tw-h-4" />
													)}
												</div>

												{/* 文件夹图标 */}
												<Folder className="tw-size-4 tw-flex-shrink-0 tw-mx-2" />

												{/* 选择区域 */}
												<div
													onClick={() => handleFolderToggle(folder)}
													className="tw-flex-1 tw-min-w-0 tw-cursor-pointer tw-py-1 tw-px-2 tw-rounded hover:tw-bg-accent/30"
												>
													<div className="tw-font-medium tw-truncate">{folder.name === '' ? '根目录' : folder.name}</div>
													<div className="tw-text-xs tw-opacity-70 tw-truncate">{folder.path}</div>
												</div>

												{/* 选中状态指示器 */}
												<div className="tw-flex-shrink-0 tw-w-6 tw-h-6 tw-flex tw-items-center tw-justify-center">
													{selectedFolders.has(folder.path) && (
														<div className="tw-w-4 tw-h-4 tw-rounded-full tw-bg-current tw-flex tw-items-center tw-justify-center">
															<span className="tw-text-xs">✓</span>
														</div>
													)}
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* 底部操作按钮 */}
						{selectedFolders.size === 0 && (
							<div className="tw-p-3 tw-border-t tw-border-border">
								<div className="tw-text-center tw-text-xs tw-text-muted-foreground">
									请选择要上传的文件夹
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>,
		document.body
	);
};