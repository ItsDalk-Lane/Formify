import { localInstance } from "src/i18n/locals";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";
import { LoopVariableValidator } from "src/utils/LoopVariableValidator";

const DEFAULT_ITEM = "item";
const DEFAULT_INDEX = "index";
const DEFAULT_TOTAL = "total";

export function LoopVariableNames(props: {
	action: LoopFormAction;
	onChange: (partial: Partial<LoopFormAction>) => void;
}) {
	const { action, onChange } = props;

	const itemValid = LoopVariableValidator.isValid(action.itemVariableName);
	const indexValid = LoopVariableValidator.isValid(action.indexVariableName);
	const totalValid = LoopVariableValidator.isValid(action.totalVariableName);

	return (
		<CpsForm layout="horizontal" className="form--LoopVariableNames">
			<CpsFormItem label={localInstance.loop_item_variable}>
				<input
					data-invalid={!itemValid}
					type="text"
					value={action.itemVariableName ?? DEFAULT_ITEM}
					onChange={(event) => {
						onChange({
							itemVariableName: event.target.value,
						});
					}}
				/>
			</CpsFormItem>
			{!itemValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}

			<CpsFormItem label={localInstance.loop_index_variable}>
				<input
					data-invalid={!indexValid}
					type="text"
					value={action.indexVariableName ?? DEFAULT_INDEX}
					onChange={(event) => {
						onChange({
							indexVariableName: event.target.value,
						});
					}}
				/>
			</CpsFormItem>
			{!indexValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}

			<CpsFormItem label={localInstance.loop_total_variable}>
				<input
					data-invalid={!totalValid}
					type="text"
					value={action.totalVariableName ?? DEFAULT_TOTAL}
					onChange={(event) => {
						onChange({
							totalVariableName: event.target.value,
						});
					}}
				/>
			</CpsFormItem>
			{!totalValid && (
				<p className="form--LoopVariableError">
					{localInstance.loop_variable_names}
				</p>
			)}
		</CpsForm>
	);
}

