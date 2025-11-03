import { Popover as RadixPopover } from "radix-ui";
import { FileEdit } from "lucide-react";
import { TFile, Notice } from "obsidian";
import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { openFilePathDirectly } from "src/utils/openFilePathDirectly";
import { Strings } from "src/utils/Strings";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { useTriggerSideOffset } from "src/hooks/useTriggerSideOffset";
import useFormConfig from "src/hooks/useFormConfig";
import { useVariables } from "src/hooks/useVariables";

export function FormFilePathFormItem(props: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
	actionId?: string;
}) {
	const { value, onChange } = props;

	const app = useObsidianApp();
	const exists = useMemo(() => {
		if (Strings.isBlank(value)) {
			return false;
		}
		const file = app.vault.getAbstractFileByPath(value);
		if (file instanceof TFile) {
			return true;
		}
		return false;
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
		openFilePathDirectly(app, filePath, "modal");
	}, []);

	return (
		<CpsFormItem label={props.label}>
			<FormFileList
				value={value}
				onChange={(value) => {
					onChange(value);
				}}
				actionId={props.actionId}
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

function FormFileList(props: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	actionId?: string;
}) {
	const { value, onChange } = props;
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [showVariables, setShowVariables] = useState(false);
	const [variableActiveIndex, setVariableActiveIndex] = useState(-1);
	const [atSymbolPos, setAtSymbolPos] = useState(-1);
	const contentRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLSpanElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const app = useObsidianApp();
	const formConfig = useFormConfig();
	const variables = props.actionId ? useVariables(props.actionId, formConfig) : [];
	
	const items = useMemo(() => {
		// 只获取 .cform 文件
		const allFiles = app.vault.getFiles();
		const formFiles = allFiles.filter(f => f.extension === 'cform');
		
		const options = formFiles
			.filter((f) => {
				if (value === "") {
					return true;
				}
				const path = Strings.safeToLowerCaseString(f.path);
				const searchValue = Strings.safeToLowerCaseString(value);
				return path.includes(searchValue);
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
	}, [value]);

	// 过滤变量列表
	const filteredVariables = useMemo(() => {
		if (atSymbolPos === -1) return variables;
		const searchText = value.slice(atSymbolPos + 1);
		if (!searchText) return variables;
		const lowerSearch = searchText.toLowerCase();
		return variables.filter(v => 
			v.label.toLowerCase().includes(lowerSearch)
		);
	}, [variables, value, atSymbolPos]);

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

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		const cursorPos = e.target.selectionStart || 0;
		
		// 检查是否包含 @ 符号
		const lastAtPos = newValue.lastIndexOf('@', cursorPos - 1);
		
		if (lastAtPos !== -1) {
			// 检查 @ 后面是否有空格
			const textAfterAt = newValue.slice(lastAtPos + 1, cursorPos);
			if (!textAfterAt.includes(' ')) {
				setAtSymbolPos(lastAtPos);
				setShowVariables(true);
				setVariableActiveIndex(0);
			} else {
				setShowVariables(false);
				setAtSymbolPos(-1);
			}
		} else {
			setShowVariables(false);
			setAtSymbolPos(-1);
		}
		
		onChange(newValue);
	};

	const insertVariable = (variableLabel: string) => {
		if (atSymbolPos === -1) return;
		
		const beforeAt = value.slice(0, atSymbolPos);
		const afterCursor = value.slice(inputRef.current?.selectionStart || value.length);
		const newValue = `${beforeAt}{{@${variableLabel}}}${afterCursor}`;
		
		onChange(newValue);
		setShowVariables(false);
		setAtSymbolPos(-1);
		
		// 恢复焦点
		setTimeout(() => {
			inputRef.current?.focus();
		}, 0);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		// is composing
		if (event.nativeEvent.isComposing) {
			return;
		}

		// 如果正在显示变量建议
		if (showVariables && filteredVariables.length > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setVariableActiveIndex((prevIndex) =>
					prevIndex < filteredVariables.length - 1 ? prevIndex + 1 : 0
				);
				return;
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setVariableActiveIndex((prevIndex) =>
					prevIndex > 0 ? prevIndex - 1 : filteredVariables.length - 1
				);
				return;
			} else if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				if (variableActiveIndex >= 0 && variableActiveIndex < filteredVariables.length) {
					insertVariable(filteredVariables[variableActiveIndex].label);
				}
				return;
			} else if (event.key === "Escape") {
				event.preventDefault();
				setShowVariables(false);
				setAtSymbolPos(-1);
				return;
			}
		}

		// 文件列表导航
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
						ref={inputRef}
						type="text"
						className="form--FormFilePathSuggestInput"
						value={value}
						onChange={handleInputChange}
						placeholder={props.placeholder || localInstance.select_form_file}
						onKeyDown={handleKeyDown}
					/>
					{showVariables && filteredVariables.length > 0 && (
						<div className="form--FormFilePathSuggestList" style={{ borderBottom: '1px solid var(--background-modifier-border)' }}>
							<div style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
								表单字段
							</div>
							{filteredVariables.map((variable, index) => (
								<div
									key={variable.label}
									className="form--FormFilePathSuggestItem"
									data-highlighted={variableActiveIndex === index ? "true" : "false"}
									onClick={() => insertVariable(variable.label)}
								>
									<span>@{variable.label}</span>
									{variable.info && (
										<span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
											{variable.info}
										</span>
									)}
								</div>
							))}
						</div>
					)}
					<div
						className="form--FormFilePathSuggestList"
						ref={listRef}
					>
						{items.map((item, index) => {
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
									{item.label}
								</div>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
