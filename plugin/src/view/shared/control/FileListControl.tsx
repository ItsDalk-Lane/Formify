import { Popover as RadixPopover } from "radix-ui";
import { useState, useRef, useMemo, useEffect } from "react";
import "./FileListControl.css";

import { ChevronDown, X } from "lucide-react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { IFileListField } from "src/model/field/IFileListField";
import { IFormField } from "src/model/field/IFormField";
import { Strings } from "src/utils/Strings";

// 用于编码文件路径和内容的特殊分隔符
const FILE_PATH_SEPARATOR = "<<<FILE_PATH>>>";
const CONTENT_SEPARATOR = "<<<CONTENT>>>";

// 编码：将路径和内容组合成一个字符串
function encodePathAndContent(path: string, content: string): string {
	return `${FILE_PATH_SEPARATOR}${path}${CONTENT_SEPARATOR}${content}`;
}

// 解码：从编码的字符串中提取路径和内容
function decodePathAndContent(encoded: string): { path: string; content: string } | null {
	if (!encoded.includes(FILE_PATH_SEPARATOR) || !encoded.includes(CONTENT_SEPARATOR)) {
		return null;
	}
	const pathStart = encoded.indexOf(FILE_PATH_SEPARATOR) + FILE_PATH_SEPARATOR.length;
	const contentStart = encoded.indexOf(CONTENT_SEPARATOR);
	const path = encoded.substring(pathStart, contentStart);
	const content = encoded.substring(contentStart + CONTENT_SEPARATOR.length);
	return { path, content };
}

// 导出函数用于从编码的值中提取纯内容（用于表单提交等场景）
export function extractContentFromEncodedValue(value: any): any {
	if (typeof value === 'string') {
		const decoded = decodePathAndContent(value);
		return decoded ? decoded.content : value;
	}
	if (Array.isArray(value)) {
		return value.map(v => {
			if (typeof v === 'string') {
				const decoded = decodePathAndContent(v);
				return decoded ? decoded.content : v;
			}
			return v;
		});
	}
	return value;
}

export function FileListControl(props: {
	field: IFormField;
	value: any;
	onValueChange: (value: any) => void;
	autoFocus?: boolean;
}) {
	const { value, field, onValueChange, autoFocus } = props;
	const fileListField = field as IFileListField;

	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [path, setPath] = useState("");
	const contentRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const app = useObsidianApp();

	const items = useMemo(() => {
		// 获取所有文件，不再限制为仅Markdown文件
		const files = app.vault.getFiles();
		const options = files
			.filter((f) => {
				// 如果配置了folderPath，则仅显示该文件夹及其子文件夹中的文件
				if (fileListField.folderPath && Strings.isNotEmpty(fileListField.folderPath)) {
					const normalizedFolderPath = fileListField.folderPath.replace(/\\/g, '/').replace(/\/$/, '');
					const normalizedFilePath = f.path.replace(/\\/g, '/');
					if (!normalizedFilePath.startsWith(normalizedFolderPath)) {
						return false;
					}
				}
				
				// 根据搜索关键词过滤
				if (Strings.isEmpty(path)) {
					return true;
				}
				const filePath = Strings.safeToLowerCaseString(f.path);
				const searchValue = path.toLowerCase();
				return filePath.includes(searchValue);
			})
			.slice(0, 100)
			.map((f) => {
				return {
					id: f.path,
					value: f.path,
					label: f.path,
				};
			});
		return options;
	}, [path, fileListField.folderPath]);

	const values = useMemo(() => {
		if (Array.isArray(value)) {
			return value.map((v, i) => {
				return v.toString();
			});
		} else {
			if (!value) {
				return [];
			} else {
				return [value.toString()];
			}
		}
	}, [value]);

	const addValue = async (newValue: string, sourceValue: string[]) => {
		const toInternalLink = (origin: string): string => {
			const file = app.vault.getFileByPath(origin);
			let link;
			if (!file) {
				link = `[[${origin}]]`;
			} else {
				link = app.fileManager.generateMarkdownLink(file, "");
			}
			return link;
		};

		const extractFileContent = async (filePath: string): Promise<string> => {
			const file = app.vault.getFileByPath(filePath);
			if (!file) {
				return filePath; // 文件不存在时返回路径
			}
			
			try {
				const content = await app.vault.read(file);
				
				// 如果不包含元数据，则移除YAML Frontmatter
				if (!fileListField.includeMetadata) {
					// 移除YAML frontmatter
					const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
					return content.replace(frontmatterRegex, '').trim();
				}
				
				return content;
			} catch (error) {
				console.error(`读取文件内容失败: ${filePath}`, error);
				return filePath; // 读取失败时返回路径
			}
		};

		const formatOne = async (origin: string, internalLink?: boolean, extractContent?: boolean) => {
			// 如果启用了内容提取
			if (extractContent) {
				const content = await extractFileContent(origin);
				// 使用编码方式：将路径和内容组合在一起
				return encodePathAndContent(origin, content);
			}
			
			// 否则按原逻辑处理路径或内链
			if (internalLink) {
				return toInternalLink(origin);
			} else {
				return origin;
			}
		};

		if (fileListField.multiple) {
			const formated = await formatOne(newValue, fileListField.internalLink, fileListField.extractContent);
			if (sourceValue.includes(formated)) {
				return;
			}
			const v = [...sourceValue, formated].filter((f) =>
				Strings.isNotBlank(f)
			);
			onValueChange(v);
		} else {
			const v = await formatOne(newValue, fileListField.internalLink, fileListField.extractContent);
			onValueChange(v);
		}
		setPath("");
		setOpen(false);
	};

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
				addValue(items[activeIndex].value, values);
			} else {
				addValue(path, values);
			}
			setOpen(false);
		}
	};

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

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					className="form--FileListControlTrigger"
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setOpen(true);
						}
					}}
				>
					<TriggerItems 
						value={value} 
						onValueChange={onValueChange}
						extractContent={fileListField.extractContent}
					/>
					<ChevronDown
						size={16}
						className="form--FileListControlTriggerArrow"
					/>
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal
				container={window.activeWindow.activeDocument.body}
			>
				<RadixPopover.Content
					className="form--FileListControlContent"
					collisionPadding={{
						left: 16,
						right: 16,
						top: 8,
						bottom: 8,
					}}
					sideOffset={8}
					ref={contentRef}
				>
					<input
						type="text"
						className="form--FileListControlContentInput"
						value={path}
						onChange={(e) => {
							setPath(e.target.value);
						}}
						onKeyDown={handleKeyDown}
					/>
					<div
						className="form--FileListControlContentList"
						ref={listRef}
					>
						{items.map((item, index) => {
							return (
								<div
									key={item.id}
									className="form--FileListControlContentItem"
									data-highlighted={
										activeIndex === index ? "true" : "false"
									}
									data-id={item.id}
									onClick={() => {
										addValue(item.value, values);
									}}
								>
									{item.label}
								</div>
							);
						})}

						{items.length === 0 && (
							<span className="form--FileListControlContentTip">
								{localInstance.enter_to_create}:{" "}
								<span className="form--FileListControlContentTipInfo">
									{path}
								</span>
							</span>
						)}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function TriggerItems(props: {
	value: any;
	onValueChange: (value: any) => void;
	extractContent?: boolean;
}) {
	const { value, onValueChange, extractContent } = props;
	let arrayValue: string[];
	if (Array.isArray(value)) {
		arrayValue = value.map((v) => v?.toString());
	} else {
		arrayValue = [value?.toString()];
	}

	const removeValue = (v: string) => {
		if (arrayValue.length === 1) {
			onValueChange("");
		}
		const newValue = arrayValue.filter((item) => item !== v);
		if (newValue.length === 0) {
			onValueChange("");
		}
		onValueChange(newValue);
	};
	
	// 获取显示文本：如果启用了内容提取，尝试解码获取路径；否则显示原始值
	const getDisplayText = (v: string): string => {
		if (extractContent) {
			const decoded = decodePathAndContent(v);
			if (decoded) {
				return decoded.path;
			}
		}
		return v;
	};

	return (
		<div className="form--FileListControlTriggerItems">
			{arrayValue.map((v) => {
				const displayText = getDisplayText(v);
				return (
					<span
						className="form--FileListControlTriggerItem"
						key={v}
						aria-label={localInstance.remove_value}
					>
						{displayText}

						<span
							className="form--FileListControlTriggerItemClose"
							onClick={(e) => {
								e.stopPropagation();
								removeValue(v);
							}}
						>
							<X size={10} />
						</span>
					</span>
				);
			})}
		</div>
	);
}
