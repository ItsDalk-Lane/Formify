import React, { useCallback, useMemo } from "react";
import "./FilterItem.css";
import { useFilterContentComponent } from "./hooks/FilterContentComponentContext";
import { useFilterOperations } from "./hooks/useFilterOperations";
import { FilterAddDropdown } from "./menu/FilterAddDropdown";
import { FilterMenuDropdown } from "./menu/FilterMenuDropdown";
import { FilterRelationDropdown } from "./menu/FilterRelationDropdown";
import { localInstance } from "src/i18n/locals";
import { Filter, FilterType } from "src/model/filter/Filter";
import { RelationType, OperatorType } from "src/model/filter/OperatorType";
import { ExtendedConditionContent } from "./ExtendedConditionEditor";

export interface FilternProps {
	index: number;
	filter: Filter;
	relation: RelationType;
	onRelationChange: (relation: RelationType) => void;
	onFilterChange: (condition: Filter) => void;
	onFilterDuplicate: (id: string) => void;
	onFilterRemove: (id: string) => void;
}

const areEqualFilterItem = (
	prev: FilternProps,
	next: FilternProps
): boolean => {
	return (
		prev.index === next.index &&
		prev.relation === next.relation &&
		prev.filter === next.filter &&
		prev.onRelationChange === next.onRelationChange &&
		prev.onFilterChange === next.onFilterChange &&
		prev.onFilterDuplicate === next.onFilterDuplicate &&
		prev.onFilterRemove === next.onFilterRemove
	);
};

export const FilterItem = React.memo(FilterItemComponent, areEqualFilterItem);
export const FilterGroup = React.memo(FilterGroupComponent);

function FilterItemComponent(props: FilternProps) {
	const {
		filter,
		onFilterChange,
		onFilterRemove,
		onFilterDuplicate,
		relation,
		onRelationChange,
		index,
	} = props;

	const handleFilterChange = useCallback(
		(nextFilter: Filter) => {
			onFilterChange(nextFilter);
		},
		[onFilterChange]
	);

	const handleRelationChange = useCallback(
		(nextRelation: RelationType) => {
			onRelationChange(nextRelation);
		},
		[onRelationChange]
	);

	const relationEl = useMemo(() => {
		if (index === 0) {
			return localInstance.operator_condition;
		}

		if (index === 1) {
			return (
				<FilterRelationDropdown
					relation={relation}
					onChange={handleRelationChange}
				/>
			);
		} else {
			if (relation === OperatorType.And) {
				return localInstance.operator_and;
			} else {
				return localInstance.operator_or;
			}
		}
	}, [index, relation, handleRelationChange]);

	const handleMenuDelete = useCallback(() => {
		onFilterRemove(filter.id);
	}, [filter.id, onFilterRemove]);

	const handleMenuDuplicate = useCallback(() => {
		onFilterDuplicate(filter.id);
	}, [filter.id, onFilterDuplicate]);

	const handleFilterRemove = useCallback(
		(id: string) => {
			onFilterRemove(id);
		},
		[onFilterRemove]
	);

	// 判断是否为扩展条件类型
	const isExtendedCondition =
		filter.type === FilterType.timeCondition ||
		filter.type === FilterType.fileCondition ||
		filter.type === FilterType.scriptCondition;

	return (
		<div className="form--Filter">
			<div className="form--FilterRelation">{relationEl}</div>
			<div className="form--FilterContent">
				{filter.type === FilterType.group ? (
					<FilterGroup filter={filter} onChange={handleFilterChange} />
				) : isExtendedCondition ? (
					<ExtendedConditionContent filter={filter} onChange={handleFilterChange} />
				) : (
					<FilterRule
						filter={filter}
						onChange={handleFilterChange}
						onRemove={handleFilterRemove}
					/>
				)}
			</div>
			<div className="form--FilterMenu">
				<FilterMenuDropdown
					onDelete={handleMenuDelete}
					onDuplicate={handleMenuDuplicate}
				/>
			</div>
		</div>
	);
}

export function FilterRule(props: {
	filter: Filter;
	onChange: (filter: Filter) => void;
	onRemove?: (id: string) => void;
}) {
	const { filter, onChange } = props;
	const filterContentComponent = useFilterContentComponent();
	return (
		<div className="form--FilterRule">
			{filterContentComponent &&
				React.createElement(filterContentComponent, {
					filter,
					onChange,
				})}
		</div>
	);
}

function FilterGroupComponent(props: {
	filter: Filter;
	onChange: (filter: Filter) => void;
}) {
	const { filter, onChange } = props;

	const {
		removeCondition,
		duplicateCondition,
		updateCondition,
		changeOperator,
	} = useFilterOperations(filter, onChange);

	return (
		<div className="form--FilterGroup">
			{filter.conditions.map((c, index) => (
				<FilterItem
					key={c.id}
					filter={c}
					index={index}
					onFilterChange={updateCondition}
					onFilterRemove={removeCondition}
					onFilterDuplicate={duplicateCondition}
					relation={filter.operator as RelationType}
					onRelationChange={changeOperator}
				/>
			))}
			<div className="form--FilterGroupAdd">
				<FilterAddDropdown filter={filter} onChange={onChange} />
			</div>
		</div>
	);
}
