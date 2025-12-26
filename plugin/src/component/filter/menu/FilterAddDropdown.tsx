import { ChevronDown, Clock, CopyPlusIcon, File, Plus } from "lucide-react";
import { v4 } from "uuid";
import { DropdownMenuItem, FilterDropdown } from "./FilterDropdown";
import { localInstance } from "src/i18n/locals";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { TimeConditionSubType, FileConditionSubType, FileTargetMode } from "src/model/startup-condition/StartupCondition";
import { createDefaultTimeConditionConfig, createDefaultFileConditionConfig } from "../ExtendedConditionEditor";

export function FilterAddDropdown(props: {
	filter: Filter;
	onChange: (filter: Filter) => void;
}) {
	const { filter } = props;

	const createFilterRule = () => {
		const newCondition = {
			id: v4(),
			type: "filter",
			property: "",
			operator: OperatorType.Equals,
			value: "",
			conditions: [],
		} as Filter;
		const newConditions = [...filter.conditions, newCondition];
		const f = {
			...filter,
			conditions: newConditions,
		} as Filter;
		props.onChange(f);
	};

	const createFilterGroup = () => {
		const newCondition = {
			id: v4(),
			type: "group",
			operator: "and",
			conditions: [],
		} as Filter;
		const newConditions = [...filter.conditions, newCondition];
		const f = {
			...props.filter,
			conditions: newConditions,
		} as Filter;
		props.onChange(f);
	};

	const createTimeCondition = () => {
		const newCondition = {
			id: v4(),
			type: FilterType.timeCondition,
			operator: OperatorType.Equals,
			conditions: [],
			extendedConfig: createDefaultTimeConditionConfig(TimeConditionSubType.TimeRange),
		} as Filter;
		const newConditions = [...filter.conditions, newCondition];
		const f = {
			...filter,
			conditions: newConditions,
		} as Filter;
		props.onChange(f);
	};

	const createFileCondition = () => {
		const newCondition = {
			id: v4(),
			type: FilterType.fileCondition,
			operator: OperatorType.Equals,
			conditions: [],
			extendedConfig: createDefaultFileConditionConfig(FileConditionSubType.ContentContains),
		} as Filter;
		const newConditions = [...filter.conditions, newCondition];
		const f = {
			...filter,
			conditions: newConditions,
		} as Filter;
		props.onChange(f);
	};

	const items: DropdownMenuItem[] = [
		{
			icon: <Plus size={16} />,
			label: localInstance.add_condition,
			value: "add_condition",
			onSelect: createFilterRule,
		},
		{
			icon: <Clock size={16} />,
			label: localInstance.add_time_condition || "添加时间条件",
			value: "add_time_condition",
			onSelect: createTimeCondition,
		},
		{
			icon: <File size={16} />,
			label: localInstance.add_file_condition || "添加文件条件",
			value: "add_file_condition",
			onSelect: createFileCondition,
		},
		{
			icon: <CopyPlusIcon size={16} />,
			label: localInstance.add_condition_group,
			value: "add_condition_group",
			onSelect: createFilterGroup,
		},
	];

	return (
		<FilterDropdown
			label={
				<button className="form--TextButton">
					<Plus size={16} /> {localInstance.add_condition}
					<ChevronDown size={16} />
				</button>
			}
			items={items}
		/>
	);
}
