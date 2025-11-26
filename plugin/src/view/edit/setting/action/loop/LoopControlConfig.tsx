import { localInstance } from "src/i18n/locals";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { ErrorHandlingStrategy } from "src/model/enums/ErrorHandlingStrategy";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";

const errorStrategyOptions = [
	{
		value: ErrorHandlingStrategy.CONTINUE,
		label: localInstance.loop_error_continue,
	},
	{
		value: ErrorHandlingStrategy.STOP,
		label: localInstance.loop_error_stop,
	},
	{
		value: ErrorHandlingStrategy.RETRY,
		label: localInstance.loop_error_retry,
	},
];

const numberOrUndefined = (value: string): number | undefined => {
	if (value === "" || value === null || value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
};

export function LoopControlConfig(props: {
	action: LoopFormAction;
	onChange: (partial: Partial<LoopFormAction>) => void;
}) {
	const { action, onChange } = props;

	return (
		<CpsForm layout="horizontal" className="form--LoopControlConfig">
			<CpsFormItem label={localInstance.loop_max_iterations}>
				<input
					type="number"
					placeholder={localInstance.loop_max_iterations_placeholder}
					value={action.maxIterations ?? 1000}
					onChange={(event) => {
						onChange({
							maxIterations: numberOrUndefined(event.target.value),
						});
					}}
				/>
			</CpsFormItem>

			<CpsFormItem label={localInstance.loop_timeout}>
				<input
					type="number"
					placeholder={localInstance.loop_timeout_placeholder}
					value={action.timeout ?? ""}
					onChange={(event) => {
						onChange({
							timeout: numberOrUndefined(event.target.value),
						});
					}}
				/>
			</CpsFormItem>

			<CpsFormItem label={localInstance.loop_single_iteration_timeout}>
				<input
					type="number"
					value={action.singleIterationTimeout ?? ""}
					onChange={(event) => {
						onChange({
							singleIterationTimeout: numberOrUndefined(event.target.value),
						});
					}}
				/>
			</CpsFormItem>

			<CpsFormItem label={localInstance.loop_error_handling}>
				<select
					value={action.errorHandlingStrategy}
					onChange={(event) => {
						onChange({
							errorHandlingStrategy: event.target
								.value as ErrorHandlingStrategy,
						});
					}}
				>
					{errorStrategyOptions.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</CpsFormItem>

			{action.errorHandlingStrategy === ErrorHandlingStrategy.RETRY && (
				<>
					<CpsFormItem label={localInstance.loop_retry_count}>
						<input
							type="number"
							value={action.retryCount ?? 0}
							onChange={(event) => {
								onChange({
									retryCount: numberOrUndefined(event.target.value),
								});
							}}
						/>
					</CpsFormItem>
					<CpsFormItem label={localInstance.loop_retry_delay}>
						<input
							type="number"
							placeholder={localInstance.loop_retry_delay_placeholder}
							value={action.retryDelay ?? ""}
							onChange={(event) => {
								onChange({
									retryDelay: numberOrUndefined(event.target.value),
								});
							}}
						/>
					</CpsFormItem>
				</>
			)}

			<CpsFormItem label={localInstance.loop_show_progress}>
				<label className="form--LoopToggle">
					<input
						type="checkbox"
						checked={action.showProgress ?? false}
						onChange={(event) => {
							onChange({
								showProgress: event.target.checked,
							});
						}}
					/>
					<span>{eventualProgressLabel(action.showProgress)}</span>
				</label>
			</CpsFormItem>
		</CpsForm>
	);
}

function eventualProgressLabel(enabled?: boolean) {
	return enabled ? localInstance.checked : localInstance.unchecked;
}








