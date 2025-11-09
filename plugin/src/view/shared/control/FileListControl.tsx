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

// 导出函数用于从编码的值中提取内容（支持动态元数据设置）
export function extractContentFromEncodedValue(value: any, includeMetadata: boolean = true): any {
	if (typeof value === 'string') {
		const decoded = decodePathAndContent(value);
		if (decoded) {
			// 使用增强的元数据处理函数
			return processContentWithMetadata(decoded.content, includeMetadata);
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(v => {
			if (typeof v === 'string') {
				const decoded = decodePathAndContent(v);
				if (decoded) {
					// 使用增强的元数据处理函数
					return processContentWithMetadata(decoded.content, includeMetadata);
				}
				return v;
			}
			return v;
		});
	}
	return value;
}

// 兼容性函数：保持向后兼容，默认包含元数据
export function extractContentFromEncodedValueLegacy(value: any): any {
	return extractContentFromEncodedValue(value, true);
}

// 增强的元数据处理函数：支持多种元数据格式和选项
export function processContentWithMetadata(
	content: string,
	includeMetadata: boolean,
	options: {
		stripFrontmatter?: boolean;
		preserveFormatting?: boolean;
	} = {}
): string {
	const { stripFrontmatter = !includeMetadata, preserveFormatting = true } = options;

	if (!stripFrontmatter) {
		return content;
	}

	// 处理多种 YAML frontmatter 格式
	const frontmatterPatterns = [
		// 标准 YAML 格式：---\n...\n---
		/^---\s*\n([\s\S]*?)\n---\s*\n?/,
		// 替代格式：---\r\n...\r\n---
		/^---\s*\r\n([\s\S]*?)\r\n---\s*\r\n?/,
		// 简化格式：---\n...（用于没有结束标记的情况）
		/^---\s*\n([\s\S]*?)$/m
	];

	let processedContent = content;

	for (const pattern of frontmatterPatterns) {
		if (pattern.test(processedContent)) {
			processedContent = processedContent.replace(pattern, '');
			break; // 只移除第一个匹配的 frontmatter
		}
	}

	// 根据格式化选项处理内容
	if (preserveFormatting) {
		return processedContent.trim();
	} else {
		// 移除多余的空行和空白字符
		return processedContent.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
	}
}

// 提取文件的元数据（如果需要单独处理元数据）
export function extractFrontmatter(content: string): string | null {
	const frontmatterPattern = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
	const match = content.match(frontmatterPattern);

	if (match && match[1]) {
		return match[1].trim();
	}

	return null;
}

// 检查内容是否包含 frontmatter
export function hasFrontmatter(content: string): boolean {
	const frontmatterPattern = /^---\s*\n/;
	return frontmatterPattern.test(content);
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

	// 处理初始默认值：如果启用了内容提取，且当前值是普通文件路径（非编码格式），则进行内容提取
	useEffect(() => {
		const processInitialValue = async () => {
			if (!fileListField.extractContent) {
				return;
			}

			const currentValues = Array.isArray(value) ? value : (value ? [value] : []);
			if (currentValues.length === 0) {
				return;
			}

			// 检查是否需要处理
			const needsProcessing = currentValues.some((v: string) => {
				const str = String(v);
				// 如果不包含编码标记，说明是普通路径，需要处理
				return !str.includes('<<<FILE_PATH>>>');
			});

			if (!needsProcessing) {
				return;
			}

			// 处理每个值
			const processedValues = await Promise.all(
				currentValues.map(async (v: string) => {
					const filePath = String(v);
					
					// 如果已经是编码格式，直接返回
					if (filePath.includes('<<<FILE_PATH>>>')) {
						return filePath;
					}

					// 否则进行内容提取
					const file = app.vault.getFileByPath(filePath);
					if (!file) {
						return filePath;
					}

					try {
						const content = await app.vault.read(file);

						// 使用增强的元数据处理函数
						const processedContent = processContentWithMetadata(
							content,
							fileListField.includeMetadata || false
						);

						const encoded = encodePathAndContent(filePath, processedContent);
						return encoded;
					} catch (error) {
						return filePath;
					}
				})
			);

			// 更新值
			if (fileListField.multiple) {
				onValueChange(processedValues);
			} else {
				onValueChange(processedValues[0]);
			}
		};

		processInitialValue();
	}, []); // 只在组件挂载时执行一次

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

				// 使用增强的元数据处理函数
				return processContentWithMetadata(
					content,
					fileListField.includeMetadata || false
				);
			} catch (error) {
				return filePath; // 读取失败时返回路径
			}
		};

		const formatOne = async (origin: string, internalLink?: boolean, extractContent?: boolean) => {
			// 如果启用了内容提取
			if (extractContent) {
				const content = await extractFileContent(origin);
				const encoded = encodePathAndContent(origin, content);
				return encoded;
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
