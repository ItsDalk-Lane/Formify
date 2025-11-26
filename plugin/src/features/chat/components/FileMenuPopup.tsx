import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { File, Folder } from 'lucide-react';
import { App, TFile, TFolder, CachedMetadata } from 'obsidian';
import { FileSelector } from './FileSelector';
import { FolderSelector } from './FolderSelector';

interface FileMenuPopupProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectFile: (file: TFile) => void;
	onSelectFolder: (folder: TFolder) => void;
	app: App;
	buttonRef: React.RefObject<HTMLSpanElement>;
}

export const FileMenuPopup = ({ isOpen, onClose, onSelectFile, onSelectFolder, app, buttonRef }: FileMenuPopupProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<Array<{
		type: 'file' | 'folder';
		file?: TFile;
		folder?: TFolder;
		matches: string[]
	}>>();
	const [isSearching, setIsSearching] = useState(false);
	const [showFileSelector, setShowFileSelector] = useState(false);
	const [showFolderSelector, setShowFolderSelector] = useState(false);

	// 点击外部关闭弹出菜单
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (popupRef.current && !popupRef.current.contains(event.target as Node) &&
				buttonRef.current && !buttonRef.current.contains(event.target as Node) &&
				!showFileSelector && !showFolderSelector) {
				onClose();
			}
		};

		if (isOpen && !showFileSelector && !showFolderSelector) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose, buttonRef, showFileSelector, showFolderSelector]);

	// 搜索文件和文件夹功能
	useEffect(() => {
		if (searchQuery.trim() === '') {
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
	}, [searchQuery, app]);

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

	const handleFileSelect = (files: TFile[]) => {
		if (files.length > 0) {
			onSelectFile(files[0]); // 目前只支持单文件选择
		}
		setShowFileSelector(false);
		onClose();
	};

	const handleFolderSelect = (folders: TFolder[]) => {
		if (folders.length > 0) {
			onSelectFolder(folders[0]); // 目前只支持单文件夹选择
		}
		setShowFolderSelector(false);
		onClose();
	};

	// 保存原始按钮位置，用于子选择器定位
	const originalButtonRect = buttonRef.current?.getBoundingClientRect();

	if (!isOpen) return null;

	// 计算弹出菜单位置
	const buttonRect = buttonRef.current?.getBoundingClientRect();
	const popupStyle: React.CSSProperties = {
		position: 'fixed',
		bottom: buttonRect ? `${window.innerHeight - buttonRect.top + 8}px` : 'auto',
		left: buttonRect ? `${buttonRect.left}px` : 'auto',
		zIndex: 1000,
		minWidth: '320px',
		maxWidth: '400px',
		maxHeight: '400px',
		overflow: 'auto'
	};

	return createPortal(
		<>
			<div ref={popupRef} className="file-menu-popup" style={popupStyle}>
				<div className="tw-bg-background tw-border tw-border-border tw-rounded-lg tw-shadow-lg tw-p-2">
					{/* 菜单选项 */}
					<div className="tw-flex tw-flex-col tw-gap-1 tw-mb-3">
						<div
							onClick={() => {
								setShowFileSelector(true);
							}}
							className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-text-sm tw-rounded hover:tw-bg-accent hover:tw-text-accent-foreground tw-cursor-pointer tw-text-left"
						>
							<File className="tw-size-4" />
							<span>选择文件</span>
						</div>
						<div
							onClick={() => {
								setShowFolderSelector(true);
							}}
							className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-text-sm tw-rounded hover:tw-bg-accent hover:tw-text-accent-foreground tw-cursor-pointer tw-text-left"
						>
							<Folder className="tw-size-4" />
							<span>选择文件夹</span>
						</div>
					</div>

					{/* 分隔线 */}
					<div className="tw-border-t tw-border-border tw-my-2"></div>

					{/* 搜索框 */}
					<div className="tw-mb-3">
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
						<div className="tw-max-h-48 tw-overflow-y-auto">
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
				</div>
			</div>

			{/* 文件选择器 */}
			<FileSelector
				isOpen={showFileSelector}
				onClose={() => setShowFileSelector(false)}
				onSelect={handleFileSelect}
				app={app}
				buttonRef={buttonRef} // 使用原始按钮引用
			/>

			{/* 文件夹选择器 */}
			<FolderSelector
				isOpen={showFolderSelector}
				onClose={() => setShowFolderSelector(false)}
				onSelect={handleFolderSelect}
				app={app}
				buttonRef={buttonRef} // 使用原始按钮引用
			/>
		</>,
		document.body
	);
};