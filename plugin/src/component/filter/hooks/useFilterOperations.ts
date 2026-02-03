import { useCallback } from "react";
import { v4 } from "uuid";
import { Filter } from "src/model/filter/Filter";
import { RelationType } from "src/model/filter/OperatorType";

export interface UseFilterOperationsResult {
	removeCondition: (id: string) => void;
	duplicateCondition: (id: string) => void;
	updateCondition: (condition: Filter) => void;
	addCondition: (condition: Filter) => void;
	changeOperator: (operator: RelationType) => void;
}

/**
 * 使用示例:
 * const {
 *   removeCondition,
 *   duplicateCondition,
 *   updateCondition,
 *   addCondition,
 *   changeOperator,
 * } = useFilterOperations(filter, onFilterChange);
 */
export function useFilterOperations(
	filter: Filter,
	onFilterChange: (filter: Filter) => void
): UseFilterOperationsResult {
	const handleFilterChange = useCallback(
		(nextFilter: Filter) => {
			onFilterChange(nextFilter);
		},
		[onFilterChange]
	);

	const removeCondition = useCallback(
		(id: string) => {
			const newConditions = filter.conditions.filter((c) => c.id !== id);
			handleFilterChange({ ...filter, conditions: newConditions });
		},
		[filter, handleFilterChange]
	);

	const duplicateCondition = useCallback(
		(id: string) => {
			const condition = filter.conditions.find((c) => c.id === id);
			if (condition) {
				const newCondition = { ...condition, id: v4() };
				const newConditions = [...filter.conditions, newCondition];
				handleFilterChange({ ...filter, conditions: newConditions });
			}
		},
		[filter, handleFilterChange]
	);

	const updateCondition = useCallback(
		(condition: Filter) => {
			const newConditions = filter.conditions.map((c) => {
				if (c.id === condition.id) {
					return condition;
				}
				return c;
			});
			handleFilterChange({
				...filter,
				conditions: newConditions,
			});
		},
		[filter, handleFilterChange]
	);

	const addCondition = useCallback(
		(condition: Filter) => {
			const newConditions = [...filter.conditions, condition];
			handleFilterChange({
				...filter,
				conditions: newConditions,
			});
		},
		[filter, handleFilterChange]
	);

	const changeOperator = useCallback(
		(operator: RelationType) => {
			handleFilterChange({
				...filter,
				operator,
			});
		},
		[filter, handleFilterChange]
	);

	return {
		removeCondition,
		duplicateCondition,
		updateCondition,
		addCondition,
		changeOperator,
	};
}
