import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { File } from 'lucide-react';
import { App, TFile } from 'obsidian';

interface FileSelectorProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (files: TFile[]) => void;
	app: App;
	buttonRef: React.RefObject<HTMLElement>;
}

export const FileSelector = ({ isOpen, onClose, onSelect, app, buttonRef }: FileSelectorProps) => {
	const popupRef = useRef<HTMLDivElement>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

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

	// 获取过滤后的文件列表
	const getFilteredFiles = () => {
		const allFiles = app.vault.getFiles()
			.filter(file => !file.path.startsWith('.obsidian'))
			.filter(file => {
				if (!searchQuery) return true;
				const query = searchQuery.toLowerCase();
				return file.name.toLowerCase().includes(query) ||
					   file.path.toLowerCase().includes(query);
			})
			.sort((a, b) => a.path.localeCompare(b.path));
		return allFiles;
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

	const filteredFiles = getFilteredFiles();

	return createPortal(
		<>
			{/* 模态覆盖层 */}
			<div
				className="tw-fixed tw-inset-0 tw-bg-black tw-opacity-50 tw-z-[1001]"
				onClick={onClose}
			/>
			{/* 文件选择器弹出层 */}
			<div ref={popupRef} className="file-selector-popup" style={{ ...popupStyle, zIndex: 1002 }}>
				<div className="tw-bg-background tw-border tw-border-border tw-rounded-lg tw-shadow-lg tw-flex tw-flex-col">
					{/* 搜索框 */}
					<div className="tw-p-4 tw-border-b tw-border-border">
						<div className="tw-relative">
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="搜索文件名..."
								className="tw-w-full tw-pl-4 tw-pr-4 tw-py-2 tw-text-sm tw-border tw-border-border tw-rounded-md focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary"
								autoFocus
							/>
						</div>
					</div>

					{/* 文件列表 */}
					<div className="tw-flex-1 tw-overflow-y-auto" style={{ maxHeight: '400px' }}>
						{filteredFiles.length === 0 ? (
							<div className="tw-text-center tw-py-8 tw-text-muted-foreground tw-text-sm">
								{searchQuery ? '未找到匹配的文件' : '没有可选择的文件'}
							</div>
						) : (
							<div className="tw-p-2">
								{filteredFiles.map(file => (
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
				</div>
			</div>
		</>,
		document.body
	);
};