import { Plus, Trash2 } from "lucide-react";
import FolderSuggestInput from "src/component/combobox/FolderSuggestInput";
import MarkdownFileSuggestInput from "src/component/combobox/MarkdownFileSuggestInput";
import { localInstance } from "src/i18n/locals";
import {
	CreateFileFormAction,
	ContentTemplateSource,
} from "src/model/action/CreateFileFormAction";
import { IFormAction } from "src/model/action/IFormAction";
import { CreateFileMode } from "src/model/enums/CreateFileMode";
import { FormActionType } from "src/model/enums/FormActionType";
import { getFilePathCompatible } from "src/utils/getFilePathCompatible";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { FilePathFormItem } from "../common/FilePathFormItem";
import OpenPageTypeSelect from "../common/OpenPageTypeSelect";
import TextAreaContentSetting from "../common/TextAreaContentSetting";
import FileConflictResolutionSelect from "../common/FileConflictResolutionSelect";
import ContentTemplateSourceSelect from "./ContentTemplateSourceSelect";
import CreateFileModeSelect from "./CreateFileModeSelect";

export function CreateFileSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
}) {
	const { value } = props;
	if (value.type !== FormActionType.CREATE_FILE) {
		return null;
	}
	const action = value as CreateFileFormAction;
	const createFileMode =
		action.createFileMode || CreateFileMode.SINGLE_FILE;
	const targetFilePath = getFilePathCompatible(action);
	const batchFilePaths = action.batchFilePaths ?? [];
	const batchFolderPaths = action.batchFolderPaths ?? [];

	const renderContentSourceSettings = () => {
		return (
			<>
				<CpsFormItem label={localInstance.content_template}>
					<ContentTemplateSourceSelect
						value={
							action.contentTemplateSource ||
							ContentTemplateSource.TEXT
						}
						onChange={(v) => {
							const newAction = {
								...action,
								contentTemplateSource: v,
							};
							props.onChange(newAction);
						}}
					/>
				</CpsFormItem>

				{action.contentTemplateSource === ContentTemplateSource.FILE ? (
					<FilePathFormItem
						label={""}
						value={action.templateFile}
						onChange={(value) => {
							const newAction = {
								...action,
								templateFile: value,
							};
							props.onChange(newAction);
						}}
					/>
				) : (
					<TextAreaContentSetting
						actionId={action.id}
						content={action.content}
						onChange={(value) => {
							const newAction = { ...action, content: value };
							props.onChange(newAction);
						}}
					/>
				)}
			</>
		);
	};

	return (
		<>
			<CpsFormItem label={localInstance.create_file_mode}>
				<CreateFileModeSelect
					value={createFileMode}
					onChange={(mode) => {
						props.onChange({
							...action,
							createFileMode: mode,
						});
					}}
				/>
			</CpsFormItem>

			{createFileMode === CreateFileMode.SINGLE_FILE && (
				<>
					<CpsFormItem
						label={localInstance.open_file_after_submitted}
					>
						<OpenPageTypeSelect
							value={action.openPageIn}
							onChange={(value) => {
								const newAction = {
									...action,
									openPageIn: value,
								};
								props.onChange(newAction);
							}}
						/>
					</CpsFormItem>

					<CpsFormItem
						label={localInstance.file_conflict_resolution}
					>
						<FileConflictResolutionSelect
							value={action.conflictResolution}
							onChange={(value) => {
								const newAction = {
									...action,
									conflictResolution: value,
								};
								props.onChange(newAction);
							}}
						/>
					</CpsFormItem>

					<FilePathFormItem
						label={localInstance.file_path}
						value={targetFilePath}
						onChange={(value) => {
							const newAction = {
								...action,
								filePath: value,
							};
							props.onChange(newAction);
						}}
					/>

					{renderContentSourceSettings()}
				</>
			)}

			{createFileMode === CreateFileMode.BATCH_FILES && (
				<>
					<CpsFormItem
						label={localInstance.file_conflict_resolution}
					>
						<FileConflictResolutionSelect
							value={action.conflictResolution}
							onChange={(value) => {
								const newAction = {
									...action,
									conflictResolution: value,
								};
								props.onChange(newAction);
							}}
						/>
					</CpsFormItem>

					<CpsFormItem label={localInstance.batch_file_paths}>
						<div className="form--TextTargetFileList">
							{batchFilePaths.map((filePath, index) => (
								<div
									className="form--TextTargetFileItem"
									key={index}
								>
									<MarkdownFileSuggestInput
										value={filePath}
										placeholder={localInstance.file_path}
										onChange={(value) => {
											const newPaths = [
												...batchFilePaths,
											];
											newPaths[index] = value;
											props.onChange({
												...action,
												batchFilePaths: newPaths,
											});
										}}
									/>
									<button
										className="clickable-icon"
										onClick={() => {
											const newPaths =
												batchFilePaths.filter(
													(_, i) => i !== index
												);
											props.onChange({
												...action,
												batchFilePaths: newPaths,
											});
										}}
									>
										<Trash2 size={16} />
									</button>
								</div>
							))}
							<button
								className="form--AddButton"
								onClick={() => {
									props.onChange({
										...action,
										batchFilePaths: [
											...batchFilePaths,
											"",
										],
									});
								}}
							>
								<Plus size={16} /> {localInstance.add_file}
							</button>
						</div>
					</CpsFormItem>

					{renderContentSourceSettings()}
				</>
			)}

			{createFileMode === CreateFileMode.SINGLE_FOLDER && (
				<CpsFormItem label={localInstance.folder_path}>
					<FolderSuggestInput
						value={action.folderPath ?? ""}
						onChange={(value) => {
							props.onChange({
								...action,
								folderPath: value,
							});
						}}
						placeholder={localInstance.folder_path}
					/>
				</CpsFormItem>
			)}

			{createFileMode === CreateFileMode.BATCH_FOLDERS && (
				<CpsFormItem label={localInstance.batch_folder_paths}>
					<div className="form--TextTargetFileList">
						{batchFolderPaths.map((folderPath, index) => (
							<div className="form--TextTargetFileItem" key={index}>
								<FolderSuggestInput
									value={folderPath}
									placeholder={localInstance.folder_path}
									onChange={(value) => {
										const newPaths = [...batchFolderPaths];
										newPaths[index] = value;
										props.onChange({
											...action,
											batchFolderPaths: newPaths,
										});
									}}
								/>
								<button
									className="clickable-icon"
									onClick={() => {
										const newPaths =
											batchFolderPaths.filter(
												(_, i) => i !== index
											);
										props.onChange({
											...action,
											batchFolderPaths: newPaths,
										});
									}}
								>
									<Trash2 size={16} />
								</button>
							</div>
						))}
						<button
							className="form--AddButton"
							onClick={() => {
								props.onChange({
									...action,
									batchFolderPaths: [
										...batchFolderPaths,
										"",
									],
								});
							}}
						>
							<Plus size={16} /> {localInstance.add_folder}
						</button>
					</div>
				</CpsFormItem>
			)}
		</>
	);
}
