import { Trash2, Undo } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { localInstance } from "src/i18n/locals";
import { Filter } from "src/model/filter/Filter";
import { RelationType } from "src/model/filter/OperatorType";
import { FilterItem } from "./FilterItem";
import "./FilterRoot.css";
import {
	FilterContentComponent,
	FilterContentComponentContext,
} from "./hooks/FilterContentComponentContext";
import { useFilterOperations } from "./hooks/useFilterOperations";
import { FilterAddDropdown } from "./menu/FilterAddDropdown";

export interface FilterComponentProps {
	filter: Filter;
	onFilterChange: (filter: Filter) => void;
	filterContentComponent: FilterContentComponent;
}

export function FilterRoot(props: FilterComponentProps) {
	const { filter, onFilterChange, filterContentComponent } = props;
	const [undo, setUndo] = useState<Filter | null>(null);

	const relation = useMemo(
		() => filter.operator as RelationType,
		[filter.operator]
	);

	const conditions = useMemo(() => filter.conditions, [filter.conditions]);
	const hasConditions = useMemo(() => conditions.length > 0, [conditions.length]);

	const handleFilterChange = useCallback(
		(nextFilter: Filter) => {
			onFilterChange(nextFilter);
		},
		[onFilterChange]
	);

	const {
		removeCondition,
		duplicateCondition,
		updateCondition,
		changeOperator,
	} = useFilterOperations(filter, handleFilterChange);

	const handleClearFilters = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			if (hasConditions) {
				setUndo(filter);
			}
			handleFilterChange({
				...filter,
				conditions: [],
			});
		},
		[filter, handleFilterChange, hasConditions]
	);

	const handleUndoClear = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			if (undo) {
				handleFilterChange(undo);
				setUndo(null);
			}
		},
		[handleFilterChange, undo]
	);

	const filterItems = useMemo(() => {
		return conditions.map((condition: Filter, index: number) => {
			return (
					<FilterItem
						key={condition.id}
						filter={condition}
						index={index}
						onFilterDuplicate={duplicateCondition}
						onFilterRemove={removeCondition}
						onFilterChange={updateCondition}
						relation={relation}
						onRelationChange={changeOperator}
					/>
				);
			});
	}, [
		conditions,
		changeOperator,
		duplicateCondition,
		relation,
		removeCondition,
		updateCondition,
	]);

	return (
		<FilterContentComponentContext.Provider value={filterContentComponent}>
			<div className="form--FilterRoot">
				<div className="form--FilterRootContent">
					{filterItems}
					<div className="form--FilterRootAdd">
						<FilterAddDropdown
							filter={filter}
							onChange={handleFilterChange}
						/>
					</div>
				</div>
				<div className="form--FilterRootFooter">
					<button
						className="form--ClearFilterButton"
						data-type="danger"
						onClick={handleClearFilters}
					>
						<Trash2 size={14} /> {localInstance.clear_condition}
					</button>
					{undo && (
						<button
							className="form--UndoClearFilterButton"
							data-type="primary"
							onClick={handleUndoClear}
						>
							<Undo size={14} />
							{localInstance.undo}
						</button>
					)}
				</div>
			</div>
		</FilterContentComponentContext.Provider>
	);
}
