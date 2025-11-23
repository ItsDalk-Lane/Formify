import { useCallback, useState } from "react";
import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";
import { LoopVariableValidator } from "src/utils/LoopVariableValidator";
import { VariableConflictDetector } from "src/service/variable/VariableConflictDetector";
import { ConflictInfo } from "src/types/variable";
import { FieldNameConflictWarning } from "../../field/FieldNameConflictWarning";

const DEFAULT_ITEM = "item";
const DEFAULT_INDEX = "index";
const DEFAULT_TOTAL = "total";

export function LoopVariableNames(props: {
	action: LoopFormAction;
	onChange: (partial: Partial<LoopFormAction>) => void;
}) {
	const { action, onChange } = props;
	const formConfig = useFormConfig();
	const [conflicts, setConflicts] = useState<{
		item: ConflictInfo | null;
		index: ConflictInfo | null;
		total: ConflictInfo | null;
	}>({
		item: null,
		index: null,
		total: null
	});

	const updateConflict = useCallback((key: "item" | "index" | "total", conflict: ConflictInfo | null) => {
		setConflicts((prev) => ({
			...prev,
			[key]: conflict
		}));
	}, []);

	const runConflictCheck = useCallback((key: "item" | "index" | "total") => {
		const currentValue =
			key === "item"
				? action.itemVariableName ?? DEFAULT_ITEM
				: key === "index"
					? action.indexVariableName ?? DEFAULT_INDEX
					: action.totalVariableName ?? DEFAULT_TOTAL;

		const siblings =
			key === "item"
				? [action.indexVariableName, action.totalVariableName]
				: key === "index"
					? [action.itemVariableName, action.totalVariableName]
					: [action.itemVariableName, action.indexVariableName];

		const conflict = VariableConflictDetector.checkLoopVariableConflict(
			currentValue,
			action,
			formConfig,
			siblings.filter(Boolean) as string[]
		);

		updateConflict(key, conflict);
	}, [action, formConfig, updateConflict]);

	const itemValid = LoopVariableValidator.isValid(action.itemVariableName);
	const indexValid = LoopVariableValidator.isValid(action.indexVariableName);
	const totalValid = LoopVariableValidator.isValid(action.totalVariableName);

	return (
		<CpsForm layout="horizontal" className="form--LoopVariableNames">
			<CpsFormItem label={localInstance.loop_item_variable}>
				<input
					data-invalid={!itemValid || !!conflicts.item}
					type="text"
					value={action.itemVariableName ?? DEFAULT_ITEM}
					onChange={(event) => {
						updateConflict("item", null);
						onChange({
							itemVariableName: event.target.value,
						});
					}}
					onBlur={() => runConflictCheck("item")}
				/>
			</CpsFormItem>
			{!itemValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}
			<FieldNameConflictWarning
				conflict={conflicts.item}
				onApplySuggestion={(value) => {
					onChange({ itemVariableName: value });
					updateConflict("item", null);
				}}
			/>

			<CpsFormItem label={localInstance.loop_index_variable}>
				<input
					data-invalid={!indexValid || !!conflicts.index}
					type="text"
					value={action.indexVariableName ?? DEFAULT_INDEX}
					onChange={(event) => {
						updateConflict("index", null);
						onChange({
							indexVariableName: event.target.value,
						});
					}}
					onBlur={() => runConflictCheck("index")}
				/>
			</CpsFormItem>
			{!indexValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}
			<FieldNameConflictWarning
				conflict={conflicts.index}
				onApplySuggestion={(value) => {
					onChange({ indexVariableName: value });
					updateConflict("index", null);
				}}
			/>

			<CpsFormItem label={localInstance.loop_total_variable}>
				<input
					data-invalid={!totalValid || !!conflicts.total}
					type="text"
					value={action.totalVariableName ?? DEFAULT_TOTAL}
					onChange={(event) => {
						updateConflict("total", null);
						onChange({
							totalVariableName: event.target.value,
						});
					}}
					onBlur={() => runConflictCheck("total")}
				/>
			</CpsFormItem>
			{!totalValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}
			<FieldNameConflictWarning
				conflict={conflicts.total}
				onApplySuggestion={(value) => {
					onChange({ totalVariableName: value });
					updateConflict("total", null);
				}}
			/>
		</CpsForm>
	);
}


