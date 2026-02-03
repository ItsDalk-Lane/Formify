import { ChevronDown, ChevronRight, Copy, MoreHorizontal, Trash2, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import { DragHandler } from "src/component/drag-handler/DragHandler";
import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { VariableConflictDetector } from "src/service/variable/VariableConflictDetector";
import { ConflictInfo } from "src/types/variable";
import { FormTypeSelect } from "src/view/shared/select/FormTypeSelect";
import { fieldTypeOptions } from "../common/FieldTypeSelect";
import { CpsFormFieldDetailEditing } from "../CpsFormFieldDetailEditing";
import { FieldNameConflictWarning } from "../FieldNameConflictWarning";
import { applyFieldTypeChange } from "src/utils/applyFieldTypeChange";
import "./FormFieldSettingHeader.css";

export function FormFieldSettingHeader(props: {
	children?: React.ReactNode;
	field: IFormField;
	onChange: (field: IFormField) => void;
	onDelete: (field: IFormField) => void;
	onDuplicate: (field: IFormField) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	setDragHandleRef: (ref: HTMLDivElement | null) => void;
}) {
	const { field, setDragHandleRef, onChange, onDuplicate, open } = props;
	const formConfig = useFormConfig();
	const [conflict, setConflict] = useState<ConflictInfo | null>(null);

	useEffect(() => {
		setConflict(null);
	}, [field.id, field.label]);

	const handleBlur = useCallback(() => {
		const result = VariableConflictDetector.checkFieldNameConflict(
			field.label,
			field.id,
			formConfig
		);
		setConflict(result);
	}, [field.id, field.label, formConfig]);

	const handleApplySuggestion = useCallback((suggestion: string) => {
		const newField = {
			...field,
			label: suggestion,
		};
		onChange(newField);
		setConflict(null);
	}, [field, onChange]);

	return (
		<div
			className="form--CpsFormFieldSettingHeader"
			data-required={field.required}
			data-conflict={!!conflict}
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					props.onOpenChange(!open);
				}
			}}
		>
			<DragHandler
				ref={setDragHandleRef}
				aria-label={localInstance.drag_and_drop_to_reorder}
			/>

			{field.required && (
				<span className="form--CpsFormFieldSettingLabelRequired">
					*
				</span>
			)}
			<button
				className="clickable-icon form--CpsFormFieldSettingToggle"
				aria-label={open ? localInstance.fold : localInstance.expand}
				onClick={() => props.onOpenChange(!open)}
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>
			<div className="form--FieldNameWrapper">
				<input
					type="text"
					className="form--CpsFormFieldSettingLabelInlineInput"
					value={field.label}
					placeholder={localInstance.please_input_name}
					data-conflict={!!conflict}
					onChange={(e) => {
						const newField = {
							...field,
							label: e.target.value,
						};
						props.onChange(newField);
					}}
					onBlur={handleBlur}
				/>
				<FieldNameConflictWarning
					conflict={conflict}
					onApplySuggestion={handleApplySuggestion}
				/>
			</div>

			<div className="form--CpsFormFieldSettingHeaderControl">
				<FormTypeSelect
					value={field.type}
					hideLabel={true}
					onChange={(value) => {
						props.onChange(
							applyFieldTypeChange(field, value as FormFieldType)
						);
					}}
					options={fieldTypeOptions}
				/>

				<ConfirmPopover
					onConfirm={() => {
						props.onDelete(field);
					}}
					title={localInstance.confirm_to_delete}
				>
					<button
						className="clickable-icon"
						aria-label={localInstance.delete}
						data-type="danger"
					>
						<Trash2 size={14} />
					</button>
				</ConfirmPopover>
				<Popover.Root>
					<Popover.Trigger asChild>
						<button
							className="clickable-icon"
							aria-label={localInstance.more}
						>
							<MoreHorizontal size={14} />
						</button>
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Content
							sideOffset={24}
							side="right"
							align="start"
							className="form--CpsFormFieldSettingPopover"
							collisionPadding={{
								left: 16,
								right: 16,
								top: 8,
								bottom: 8,
							}}
						>
							<div className="form--CpsFormFieldSettingPopoverTitle">
								<button
									className="clickable-icon"
									aria-label={localInstance.duplicate}
									onClick={onDuplicate.bind(null, field)}
								>
									<Copy size={14} />
								</button>
								{localInstance.form_fields_setting}
							</div>
							<CpsFormFieldDetailEditing
								value={field}
								onChange={(field) => {
									onChange(field);
								}}
							/>
							<Popover.Close
								className="form--CpsFormFieldSettingPopoverClose"
								aria-label={localInstance.close}
							>
								<X size={14} />
							</Popover.Close>
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>
				{props.children}
			</div>
		</div>
	);
}
