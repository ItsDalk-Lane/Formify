import { localInstance } from "src/i18n/locals";
import { PaginationLoopConfig } from "src/model/action/LoopFormAction";
import CpsFormItem from "src/view/shared/CpsFormItem";
import CpsForm from "src/view/shared/CpsForm";
import { ConditionExpressionInput } from "./ConditionExpressionInput";

const ensureConfig = (config?: PaginationLoopConfig): PaginationLoopConfig => {
	return {
		currentPageVariable: config?.currentPageVariable ?? "page",
		hasNextPageCondition: config?.hasNextPageCondition ?? "",
		pageSizeVariable: config?.pageSizeVariable,
		totalPageVariable: config?.totalPageVariable,
		totalItemsVariable: config?.totalItemsVariable,
		requestInterval: config?.requestInterval,
		maxPages: config?.maxPages,
	};
};

export function PaginationConfigForm(props: {
	value?: PaginationLoopConfig;
	onChange: (config: PaginationLoopConfig) => void;
}) {
	const config = ensureConfig(props.value);

	const updateConfig = (partial: Partial<PaginationLoopConfig>) => {
		props.onChange({
			...config,
			...partial,
		});
	};

	return (
		<CpsForm layout="horizontal" className="form--LoopPaginationConfig">
			<CpsFormItem label={localInstance.pagination_current_page_variable}>
				<input
					type="text"
					value={config.currentPageVariable}
					onChange={(event) => {
						updateConfig({ currentPageVariable: event.target.value });
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.pagination_page_size_variable}>
				<input
					type="text"
					value={config.pageSizeVariable ?? ""}
					onChange={(event) => {
						updateConfig({ pageSizeVariable: event.target.value });
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.pagination_total_page_variable}>
				<input
					type="text"
					value={config.totalPageVariable ?? ""}
					onChange={(event) => {
						updateConfig({ totalPageVariable: event.target.value });
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.pagination_request_interval}>
				<input
					type="number"
					value={config.requestInterval ?? ""}
					onChange={(event) => {
						const parsed = event.target.value === "" ? undefined : Number(event.target.value);
						updateConfig({ requestInterval: parsed });
					}}
				/>
			</CpsFormItem>
			<CpsFormItem label={localInstance.pagination_has_next_condition}>
				<ConditionExpressionInput
					value={config.hasNextPageCondition}
					onChange={(value) => {
						updateConfig({ hasNextPageCondition: value });
					}}
				/>
			</CpsFormItem>
		</CpsForm>
	);
}








