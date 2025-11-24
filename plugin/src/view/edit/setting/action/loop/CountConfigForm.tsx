import { localInstance } from "src/i18n/locals";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";

const toNumber = (value: string): number | undefined => {
	if (value === "" || value === null || value === undefined) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
};

export function CountConfigForm(props: {
	action: LoopFormAction;
	onChange: (partial: Partial<LoopFormAction>) => void;
}) {
	const { action, onChange } = props;

	return (
		<CpsForm layout="horizontal" className="form--LoopCountConfig">
			<CpsFormItem label={localInstance.loop_count_start}>
				<input
					type="number"
					value={action.countStart ?? 0}
					onChange={(event) => {
						onChange({
							countStart: toNumber(event.target.value),
						});
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.loop_count_end}>
				<input
					type="number"
					value={action.countEnd ?? 0}
					onChange={(event) => {
						onChange({
							countEnd: toNumber(event.target.value),
						});
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.loop_count_step}>
				<input
					type="number"
					value={action.countStep ?? 1}
					onChange={(event) => {
						onChange({
							countStep: toNumber(event.target.value),
						});
					}}
				/>
			</CpsFormItem>
		</CpsForm>
	);
}





