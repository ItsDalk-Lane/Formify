import {
	ChevronDown,
	ChevronRight,
	Copy,
	MoreHorizontal,
	Network,
	Trash2,
	X,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import { DragHandler } from "src/component/drag-handler/DragHandler";
import Dialog2 from "src/component/dialog/Dialog2";
import { FilterRoot } from "src/component/filter/FilterRoot";
import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { IFormField } from "src/model/field/IFormField";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { VariableConflictDetector } from "src/service/variable/VariableConflictDetector";
import { ConflictInfo } from "src/types/variable";
import { FormTypeSelect } from "src/view/shared/select/FormTypeSelect";
import { fieldTypeOptions } from "../common/FieldTypeSelect";
import { CpsFormFieldDetailEditing } from "../CpsFormFieldDetailEditing";
import { FieldNameConflictWarning } from "../FieldNameConflictWarning";
import { applyFieldTypeChange } from "src/utils/applyFieldTypeChange";
import { FormCondition } from "src/view/shared/filter-content/FormCondition";
import { v4 } from "uuid";
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
	const [openCondition, setOpenCondition] = useState(false);

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

	const fieldConditionLength = useMemo(() => {
		if (!field.condition || !field.condition.conditions) {
			return 0;
		}

		const countValidFilters = (conditions: any[]): number => {
			if (!conditions || conditions.length === 0) {
				return 0;
			}

			return conditions.reduce((count, condition) => {
				if (condition.type === FilterType.group) {
					return count + countValidFilters(condition.conditions || []);
				}
				if (
					condition.type === FilterType.timeCondition ||
					condition.type === FilterType.fileCondition ||
					condition.type === FilterType.scriptCondition
				) {
					return condition.extendedConfig ? count + 1 : count;
				}
				if (condition.type === FilterType.filter) {
					return condition.property && condition.operator ? count + 1 : count;
				}
				return count;
			}, 0);
		};

		return countValidFilters(field.condition.conditions);
	}, [field.condition]);

	const condition: Filter = field.condition ?? {
		id: v4(),
		type: FilterType.group,
		operator: OperatorType.And,
		conditions: [],
	};

	const handleOpenToggle = useCallback(() => {
		props.onOpenChange(!open);
	}, [open, props.onOpenChange]);

	const titlePreview = field.label?.trim() || localInstance.please_input_name;

	return (
		<div
			className="form--CpsFormFieldSettingHeader"
			data-required={field.required}
			data-conflict={!!conflict}
		>
			<div className="form--CpsFormFieldSettingHeaderMain">
				<DragHandler
					ref={setDragHandleRef}
					aria-label={localInstance.drag_and_drop_to_reorder}
				/>

				{field.required && (
					<span className="form--CpsFormFieldSettingLabelRequired">
						*
					</span>
				)}
				<div className="form--CpsFormFieldSettingTypeSelect">
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
				</div>
				<button
					type="button"
					className="form--CpsFormFieldSettingTitlePreview"
					aria-label={open ? localInstance.fold : localInstance.expand}
					onClick={handleOpenToggle}
				>
					<span
						className="form--CpsFormFieldSettingTitlePreviewText"
						data-empty={!field.label?.trim()}
					>
						{titlePreview}
					</span>
				</button>
				<div className="form--CpsFormFieldSettingHeaderControl">
					<button
						type="button"
						className="clickable-icon form--CpsFormFieldSettingToggle"
						aria-label={open ? localInstance.fold : localInstance.expand}
						onClick={handleOpenToggle}
					>
						{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</button>

					<ConfirmPopover
						onConfirm={() => {
							props.onDelete(field);
						}}
						title={localInstance.confirm_to_delete}
					>
						<button
							type="button"
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
								type="button"
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
										type="button"
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
			<div className="form--CpsFormFieldSettingHeaderSecondary">
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
				<button
					type="button"
					className="form--VisibilityConditionButton"
					data-has-condition={fieldConditionLength > 0}
					onClick={() => {
						setOpenCondition(true);
					}}
				>
					<Network size={14} />
					{localInstance.visibility_condition}
					{fieldConditionLength > 0 && ` + ${fieldConditionLength}`}
				</button>
			</div>
			<Dialog2
				open={openCondition}
				onOpenChange={(open: boolean) => {
					setOpenCondition(open);
				}}
			>
				{() => {
					return (
						<FilterRoot
							filter={condition}
							onFilterChange={(filter: Filter) => {
								const newField = {
									...field,
									condition: filter,
								};
								onChange(newField);
							}}
							filterContentComponent={FormCondition}
						/>
					);
				}}
			</Dialog2>
		</div>
	);
}
