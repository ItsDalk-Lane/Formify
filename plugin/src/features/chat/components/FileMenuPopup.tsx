import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { File, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { App, TFile, TFolder, CachedMetadata } from 'obsidian';
import './FileMenuPopup.css';

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
	const menuSearchInputRef = useRef<HTMLInputElement>(null);
	const [currentView, setCurrentView] = useState<ViewType>('menu');

	const getFileSecondaryText = (file: TFile): string => {
		// 避免“文件名 + 含文件名的完整路径”导致的重复观感：第二行仅显示父目录
		return file.parent?.path ?? '/';
	};

	const getFolderSecondaryText = (folder: TFolder): string => {
		// 避免“文件夹名 + 顶层同名路径”重复：第二行显示父目录（根目录显示 /）
		if (folder.path === '/') return '/';
		return folder.parent?.path ?? '/';
	};

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

	// 点击外部关闭弹出菜单 - 恢复原始简单逻辑
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

	// 兜底：确保主菜单搜索框在 Obsidian 环境下稳定获得焦点
	useEffect(() => {
		if (!isOpen || currentView !== 'menu') return;
		const rafId = window.requestAnimationFrame(() => {
			menuSearchInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [isOpen, currentView]);

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
		<div ref={popupRef} className="file-menu-popup ff-native-style" style={popupStyle}>
			<div className="ff-popup-content">
				{currentView === 'menu' && (
					<>
						{/* 菜单选项 */}
						<div className="ff-menu-options">
							<div
								onClick={() => setCurrentView('fileSelector')}
								className="ff-menu-item"
							>
								<File className="ff-icon" />
								<span>选择文件</span>
							</div>
							<div
								onClick={() => setCurrentView('folderSelector')}
								className="ff-menu-item"
							>
								<Folder className="ff-icon" />
								<span>选择文件夹</span>
							</div>
						</div>

						{/* 分隔线 */}
						<div className="ff-divider"></div>

						{/* 搜索框 */}
						<div className="ff-search-container">
							<input
								ref={menuSearchInputRef}
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onMouseDown={(e) => {
									// 某些 Obsidian/Workspace 全局监听会在 mousedown 阶段阻止默认聚焦，这里显式聚焦做兜底
									e.stopPropagation();
									menuSearchInputRef.current?.focus();
								}}
								onClick={(e) => {
									e.stopPropagation();
									menuSearchInputRef.current?.focus();
								}}
								placeholder="搜索文件和文件夹..."
								className="ff-search-input"
								autoFocus
							/>
						</div>

						{/* 搜索结果 */}
						{searchQuery && (
							<div className="ff-search-results">
								{isSearching ? (
									<div className="ff-empty-message">搜索中...</div>
								) : searchResults && searchResults.length > 0 ? (
									<div className="ff-results-list">
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
												className="ff-result-item"
											>
												{result.type === 'folder' ? (
													<>
														<Folder className="ff-icon" />
														<div className="ff-result-info">
															<div className="ff-result-name">{result.folder?.name}</div>
															{result.folder && (
																<div className="ff-result-path">{getFolderSecondaryText(result.folder)}</div>
															)}
														</div>
													</>
												) : (
													<>
														<File className="ff-icon" />
														<div className="ff-result-info">
															<div className="ff-result-name">{result.file?.basename}</div>
															<div className="ff-result-path">
																{(() => {
																	if (!result.file) return '';
																	if (!result.matches || result.matches.length === 0) return getFileSecondaryText(result.file);

																	// 顶部已展示 basename，避免第二行再显示“文件名: xxx”造成重复
																	const filteredMatches = result.matches.filter((m) => !m.startsWith('文件名:'));
																	return (filteredMatches.length > 0 ? filteredMatches : [getFileSecondaryText(result.file)]).join(' · ');
																})()}
															</div>
														</div>
													</>
												)}
											</div>
										))}
									</div>
								) : (
									<div className="ff-empty-message">未找到匹配的文件或文件夹</div>
								)}
							</div>
						)}
					</>
				)}

				{currentView === 'fileSelector' && (
					<>
						{/* 返回按钮和标题 */}
						<div className="ff-header">
							<div className="ff-header-left">
								<button onClick={goBackToMenu} className="ff-back-btn">← 返回</button>
								<span className="ff-title">选择文件</span>
							</div>
							{selectedFiles.size > 0 && (
								<div className="ff-header-actions">
									<button onClick={() => setSelectedFiles(new Set())} className="ff-btn-secondary">取消</button>
									<button onClick={handleFileSelect} className="ff-btn-primary">确认 ({selectedFiles.size})</button>
								</div>
							)}
						</div>

						{/* 搜索框 */}
						<div className="ff-search-container">
							<input
								type="text"
								value={fileSearchQuery}
								onChange={(e) => setFileSearchQuery(e.target.value)}
								placeholder="搜索文件名..."
								className="ff-search-input"
								autoFocus
							/>
						</div>

						{/* 文件列表 */}
						<div className="ff-list-container">
							{getFilteredFiles().length === 0 ? (
								<div className="ff-empty-message">
									{fileSearchQuery ? '未找到匹配的文件' : '没有可选择的文件'}
								</div>
							) : (
								<div className="ff-list">
									{getFilteredFiles().map(file => (
										<div
											key={file.path}
											onClick={() => handleFileToggle(file)}
											className={`ff-file-item ${selectedFiles.has(file.path) ? 'ff-selected' : ''}`}
										>
											<File className="ff-icon" />
											<div className="ff-file-info">
												<div className="ff-file-name">{file.name}</div>
												<div className="ff-file-path">{getFileSecondaryText(file)}</div>
											</div>
											{selectedFiles.has(file.path) && <div className="ff-check-mark">✓</div>}
										</div>
									))}
								</div>
							)}
						</div>

						{/* 底部提示 */}
						{selectedFiles.size === 0 && (
							<div className="ff-footer">请选择要上传的文件</div>
						)}
					</>
				)}

				{currentView === 'folderSelector' && (
					<>
						{/* 返回按钮和标题 */}
						<div className="ff-header">
							<div className="ff-header-left">
								<button onClick={goBackToMenu} className="ff-back-btn">← 返回</button>
								<span className="ff-title">选择文件夹</span>
							</div>
							{selectedFolders.size > 0 && (
								<div className="ff-header-actions">
									<button onClick={() => setSelectedFolders(new Set())} className="ff-btn-secondary">取消</button>
									<button onClick={handleFolderSelect} className="ff-btn-primary">确认 ({selectedFolders.size})</button>
								</div>
							)}
						</div>

						{/* 搜索框 */}
						<div className="ff-search-container">
							<input
								type="text"
								value={folderSearchQuery}
								onChange={(e) => setFolderSearchQuery(e.target.value)}
								placeholder="搜索文件夹..."
								className="ff-search-input"
								autoFocus
							/>
						</div>

						{/* 文件夹列表 */}
						<div className="ff-list-container">
							{getFolderTree().length === 0 ? (
								<div className="ff-empty-message">
									{folderSearchQuery ? '未找到匹配的文件夹' : '没有可选择的文件夹'}
								</div>
							) : (
								<div className="ff-list">
									{getFolderTree().map(({ folder, level, isExpanded }) => (
										<div key={folder.path}>
											<div 
												className={`ff-folder-item ${selectedFolders.has(folder.path) ? 'ff-selected' : ''}`}
												style={{ paddingLeft: `${8 + level * 16}px` }}
											>
												{/* 展开/折叠按钮区域 */}
												<div className="ff-folder-toggle">
													{folder.children.some(child => child instanceof TFolder) ? (
														<button
															onClick={(e) => {
																e.stopPropagation();
																toggleFolder(folder.path);
															}}
															className="ff-toggle-btn"
														>
															{isExpanded ? (
																<ChevronDown className="ff-icon-xs" />
															) : (
																<ChevronRight className="ff-icon-xs" />
															)}
														</button>
													) : (
														<div className="ff-toggle-spacer" />
													)}
												</div>

												{/* 文件夹内容区域 */}
												<div className="ff-folder-content" onClick={() => handleFolderToggle(folder)}>
													<Folder className="ff-icon" />
													<div className="ff-folder-info">
														<div className="ff-folder-name">{folder.name === '' ? '根目录' : folder.name}</div>
														<div className="ff-folder-path">{getFolderSecondaryText(folder)}</div>
													</div>
												</div>

												{/* 选中状态指示器 */}
												<div className="ff-check-container">
													{selectedFolders.has(folder.path) && <div className="ff-check-mark">✓</div>}
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* 底部提示 */}
						{selectedFolders.size === 0 && (
							<div className="ff-footer">请选择要上传的文件夹</div>
						)}
					</>
				)}
			</div>
		</div>,
		document.body
	);
};
