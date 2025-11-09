import { Popover as RadixPopover } from "radix-ui";
import "./FilePathFormItem.css";
import { FileEdit, Folder, File } from "lucide-react";
import { TFile, TFolder, Notice } from "obsidian";
import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { debounce } from "obsidian";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { openFilePathDirectly } from "src/utils/openFilePathDirectly";
import { Strings } from "src/utils/Strings";
import { PathMatcher, PathMatchResult } from "src/utils/PathMatcher";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { useTriggerSideOffset } from "src/hooks/useTriggerSideOffset";

export function FilePathFormItem(props: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	const { value, onChange } = props;

	const app = useObsidianApp();
	const exists = useMemo(() => {
		if (Strings.isBlank(value)) {
			return false;
		}
		const file = app.vault.getAbstractFileByPath(value);
		return file !== null; // 支持文件和文件夹
	}, [value]);

	const openFile = useCallback((filePath: string) => {
		if (!filePath) {
			new Notice(localInstance.file_not_found);
			return;
		}
		const file = app.vault.getAbstractFileByPath(filePath);
		if (!file) {
			new Notice(localInstance.file_not_found + ": " + filePath);
			return;
		}

		// 使用统一的文件打开方式（支持文件和文件夹）
		openFilePathDirectly(app, filePath, "modal");
	}, []);

	return (
		<CpsFormItem label={props.label}>
			<MarkdownFileList
				value={value}
				onChange={(value) => {
					onChange(value);
				}}
			/>
			{exists && (
				<button
					onClick={() => {
						openFile(value);
					}}
				>
					<FileEdit size={16} />
				</button>
			)}
		</CpsFormItem>
	);
}

function MarkdownFileList(props: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	const { value, onChange } = props;
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [searchValue, setSearchValue] = useState(value);
	const [isLoading, setIsLoading] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLSpanElement>(null);
	const app = useObsidianApp();

	// 同步外部value变化到内部searchValue
	useEffect(() => {
		setSearchValue(value);
	}, [value]);

	// 防抖搜索函数
	const debouncedSearch = useMemo(
		() => debounce((newValue: string) => {
			setSearchValue(newValue);
			setIsLoading(false);
		}, 150),
		[]
	);
	const items = useMemo(() => {
		try {
			// 获取所有文件和文件夹
			const allFiles = PathMatcher.getAllFilesAndFolders(app.vault);

			// 使用智能路径匹配算法
			const matchResults = PathMatcher.matchPaths(searchValue, allFiles);

			// 限制结果数量并转换为组件所需格式
			const options = matchResults
				.slice(0, 100)
				.map((result: PathMatchResult) => {
					return {
						id: result.path,
						value: result.path,
						label: result.path,
						type: result.type,
						name: result.name,
						extension: result.extension,
						score: result.score
					};
				});

			return options;
		} catch (error) {
			console.error("路径匹配失败:", error);
			new Notice("路径检索失败，请重试");
			return [];
		}
	}, [searchValue]);

	// 滚动到活跃项
	useEffect(() => {
		if (activeIndex >= 0 && activeIndex < items.length && listRef.current) {
			const activeItemId = items[activeIndex].id;
			const activeItem = listRef.current.querySelector(
				`[data-id="${activeItemId}"]`
			);

			if (activeItem) {
				activeItem.scrollIntoView({
					block: "nearest",
					inline: "nearest",
				});
			}
		}
	}, [activeIndex, items]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		// is composing
		if (event.nativeEvent.isComposing) {
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((prevIndex) =>
				prevIndex < items.length - 1 ? prevIndex + 1 : 0
			);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((prevIndex) =>
				prevIndex > 0 ? prevIndex - 1 : items.length - 1
			);
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (activeIndex >= 0 && activeIndex < items.length) {
				onChange(items[activeIndex].value);
			}
			setOpen(false);
		}
	};

	const sideOffset = useTriggerSideOffset(triggerRef);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<span
					className="form--FormFilePathSuggestTrigger"
					ref={triggerRef}
				>
					{value}
				</span>
			</RadixPopover.Trigger>
			<RadixPopover.Portal
				container={window.activeWindow.activeDocument.body}
			>
				<RadixPopover.Content
					className="form--FormFilePathSuggestContent"
					sideOffset={-sideOffset}
					collisionPadding={{
						left: 16,
						right: 16,
						top: 8,
						bottom: 8,
					}}
					ref={contentRef}
				>
					<input
						type="text"
						className="form--FormFilePathSuggestInput"
						value={value}
						onChange={(e) => {
							const newValue = e.target.value;
							onChange(newValue);
							setIsLoading(true);
							debouncedSearch(newValue);
						}}
						placeholder={props.placeholder}
						onKeyDown={handleKeyDown}
					/>
					<div
						className="form--FormFilePathSuggestList"
						ref={listRef}
					>
						{isLoading && (
							<div className="form--FilePathLoading">
								搜索中...
							</div>
						)}
						{!isLoading && items.map((item, index) => {
							const icon = item.type === 'folder' ?
								<Folder size={14} className="form--FilePathIcon" /> :
								<File size={14} className="form--FilePathIcon" />;

							return (
								<div
									key={item.id}
									className="form--FormFilePathSuggestItem"
									data-highlighted={
										activeIndex === index ? "true" : "false"
									}
									data-id={item.id}
									onClick={() => {
										onChange(item.value);
										setOpen(false);
									}}
								>
									<div className="form--FilePathItemContent">
										{icon}
										<div className="form--FilePathText">
											<div className="form--FilePathName">{item.name}</div>
											{item.type === 'file' && item.extension && (
												<div className="form--FilePathExtension">.{item.extension}</div>
											)}
											<div className="form--FilePathPath">{item.value}</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
