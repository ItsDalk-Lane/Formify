import { Check, File, Folder, Plus, Trash2 } from "lucide-react";
import { TFolder } from "obsidian";
import { useState } from "react";
import FolderSuggestInput from "src/component/combobox/FolderSuggestInput";
import MarkdownFileSuggestInput from "src/component/combobox/MarkdownFileSuggestInput";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { VaultPathSuggestInput } from "../text/common/VaultPathSuggestInput";

interface TargetFileListInputProps {
	/** 文件/文件夹路径列表 */
	files: string[];
	/** 路径变化回调 */
	onChange: (files: string[]) => void;
	/** 是否仅限 Markdown 文件 */
	mdOnly?: boolean;
	/** 是否允许添加文件夹（默认 true） */
	allowFolders?: boolean;
	/** 输入占位符 */
	placeholder?: string;
}

/**
 * 目标文件列表输入组件
 * 支持添加单个文件和文件夹路径
 * 文件夹路径会在运行时自动展开为其中所有文件
 */
export function TargetFileListInput(props: TargetFileListInputProps) {
	const {
		files,
		onChange,
		mdOnly = false,
		allowFolders = true,
		placeholder,
	} = props;

	const app = useObsidianApp();
	const [showFolderInput, setShowFolderInput] = useState(false);
	const [folderInputValue, setFolderInputValue] = useState("");

	const isFolder = (path: string): boolean => {
		const abstractFile = app.vault.getAbstractFileByPath(path);
		return abstractFile instanceof TFolder;
	};

	const handleFileChange = (index: number, value: string) => {
		const newFiles = [...files];
		newFiles[index] = value;
		onChange(newFiles);
	};

	const handleRemove = (index: number) => {
		const newFiles = files.filter((_, i) => i !== index);
		onChange(newFiles);
	};

	const handleAddFile = () => {
		onChange([...files, ""]);
	};

	const handleAddFolder = () => {
		setShowFolderInput(true);
		setFolderInputValue("");
	};

	const handleFolderSelected = (value: string) => {
		if (value && value.trim() !== "") {
			onChange([...files, value]);
		}
		setShowFolderInput(false);
		setFolderInputValue("");
	};

	return (
		<div className="form--TextTargetFileList">
			{files.map((file, index) => {
				const isFolderPath = isFolder(file);
				return (
					<div className="form--TextTargetFileItem" key={index}>
					<span
							className="form--TargetFileListIcon"
							title={
								isFolderPath
									? localInstance.folder_icon_hint
									: undefined
							}
						>
							{isFolderPath ? (
								<Folder size={14} />
							) : (
								<File size={14} />
							)}
						</span>
						{mdOnly && !isFolderPath ? (
							<MarkdownFileSuggestInput
								value={file}
								placeholder={
									placeholder ??
									localInstance.text_target_files_placeholder
								}
								onChange={(value) =>
									handleFileChange(index, value)
								}
							/>
						) : (
							<VaultPathSuggestInput
								value={file}
								foldersOnly={isFolderPath}
								placeholder={
									placeholder ??
									localInstance.text_target_files_placeholder
								}
								onChange={(value) =>
									handleFileChange(index, value)
								}
							/>
						)}
						<button
							className="clickable-icon"
							onClick={() => handleRemove(index)}
						>
							<Trash2 size={16} />
						</button>
					</div>
				);
			})}

			{showFolderInput && (
				<div className="form--TextTargetFileItem">
					<span className="form--TargetFileListIcon">
						<Folder size={14} />
					</span>
					<FolderSuggestInput
						value={folderInputValue}
						placeholder={localInstance.add_folder}
						onChange={(value) => {
							setFolderInputValue(value);
						}}
					/>
					<button
						className="clickable-icon"
						onClick={() => handleFolderSelected(folderInputValue)}
					>
						<Check size={16} />
					</button>
					<button
						className="clickable-icon"
						onClick={() => setShowFolderInput(false)}
					>
						<Trash2 size={16} />
					</button>
				</div>
			)}

			<div className="form--TargetFileListButtons">
				<button className="form--AddButton" onClick={handleAddFile}>
					<Plus size={16} /> {localInstance.add_file}
				</button>
				{allowFolders && (
					<button
						className="form--AddButton"
						onClick={handleAddFolder}
					>
						<Folder size={16} /> {localInstance.add_folder}
					</button>
				)}
			</div>
		</div>
	);
}
