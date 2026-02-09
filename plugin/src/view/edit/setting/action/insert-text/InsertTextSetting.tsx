import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { InsertTextFormAction } from "src/model/action/InsertTextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { TargetFileType } from "src/model/enums/TargetFileType";
import { TextInsertPosition } from "src/model/enums/TextInsertPosition";
import { getFilePathCompatible } from "src/utils/getFilePathCompatible";
import { Strings } from "src/utils/Strings";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { FilePathFormItem } from "../common/FilePathFormItem";
import InsertPositionSelect from "../common/InsertPositionSelect";
import OpenPageTypeSelect from "../common/OpenPageTypeSelect";
import { TargetFileListInput } from "../common/TargetFileListInput";
import TargetFileTypeSelect from "../common/TargetFileTypeSelect";
import TextAreaContentSetting from "../common/TextAreaContentSetting";

export function InsertTextSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
}) {
	const { value } = props;
	if (value.type !== FormActionType.INSERT_TEXT) {
		return null;
	}
	const action = value as InsertTextFormAction;
	const isHeadingPosition = [
		TextInsertPosition.TOP_BELOW_TITLE,
		TextInsertPosition.BOTTOM_BELOW_TITLE,
	].includes(action.position);

	// 需要自定义模板
	const needsCustomTemplate = action.position === TextInsertPosition.CUSTOM_TEMPLATE;

	const targetFilePath = getFilePathCompatible(action);
	const isSpecifiedFile = action.targetFileType === TargetFileType.SPECIFIED_FILE;
	const isMultipleFiles = action.targetFileType === TargetFileType.MULTIPLE_FILES;
	const showFileTemplateSuggeest =
		isSpecifiedFile && Strings.isNotBlank(targetFilePath);

	return (
		<>
			<CpsFormItem label={localInstance.target_file}>
				<TargetFileTypeSelect
					showMultiple={true}
					value={action.targetFileType}
					onChange={(value) => {
						const nextPosition =
							value === TargetFileType.MULTIPLE_FILES &&
							action.position === TextInsertPosition.AT_CURSOR
								? TextInsertPosition.END_OF_CONTENT
								: action.position;
						const newAction = {
							...action,
							targetFileType: value,
							position: nextPosition,
						};
						props.onChange(newAction);
					}}
				/>
			</CpsFormItem>
			{isSpecifiedFile && (
				<>
					<FilePathFormItem
						label={""}
						value={targetFilePath}
						onChange={(value) => {
							const newAction = {
								...action,
								filePath: value,
							};
							props.onChange(newAction);
						}}
					/>
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
				</>
			)}
			{isMultipleFiles && (
				<CpsFormItem
					label={localInstance.text_target_files_label}
					description={localInstance.folder_icon_hint}
				>
					<TargetFileListInput
						files={action.targetFiles ?? []}
						mdOnly={true}
						onChange={(files) => {
							const newAction = {
								...action,
								targetFiles: files,
							};
							props.onChange(newAction);
						}}
					/>
				</CpsFormItem>
			)}
			{showFileTemplateSuggeest && (
				<FilePathFormItem
					label={localInstance.create_from_template}
					value={action.newFileTemplate || ""}
					placeholder={
						localInstance.select_template +
						`(${localInstance.optional})`
					}
					onChange={(value) => {
						const newAction = {
							...action,
							newFileTemplate: value,
						};
						props.onChange(newAction);
					}}
				/>
			)}

			<CpsFormItem label={localInstance.insert_position}>
				<InsertPositionSelect
					targetFileType={action.targetFileType}
					value={action.position}
					onChange={(value) => {
						const newAction = { ...action, position: value };
						props.onChange(newAction);
					}}
				/>
			</CpsFormItem>

			{isHeadingPosition && (
				<CpsFormItem label={localInstance.heading}>
					<input
						type="text"
						placeholder={localInstance.heading_placeholder}
						value={action.heading}
						onChange={(e) => {
							const newAction = {
								...action,
								heading: e.target.value,
							};
							props.onChange(newAction);
						}}
					/>
				</CpsFormItem>
			)}

			{needsCustomTemplate && (
				<CpsFormItem
					label={localInstance.position_template}
					description={localInstance.position_template_hint}
					layout="vertical"
					style={{
						flexDirection: "column",
						alignItems: "initial",
					}}
				>
					<textarea
						style={{
							width: "100%",
							minHeight: "167px",
							fontFamily: "monospace",
							padding: "8px",
							border: "1px solid var(--background-modifier-border)",
							borderRadius: "4px",
							resize: "vertical",
						}}
						placeholder={localInstance.position_template_hint}
						value={action.positionTemplate || ""}
						onChange={(e) => {
							const newAction = {
								...action,
								positionTemplate: e.target.value,
							};
							props.onChange(newAction);
						}}
					/>
				</CpsFormItem>
			)}

			<TextAreaContentSetting
				actionId={action.id}
				content={action.content}
				onChange={(v) => {
					const newAction = {
						...action,
						content: v,
					};
					props.onChange(newAction);
				}}
			/>
		</>
	);
}
