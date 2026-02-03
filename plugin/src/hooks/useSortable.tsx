import { useCallback, useEffect, useRef } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
	type Edge,
	extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";

export interface SortableContextProps<T> {
	items: T[];
	getId: (item: T) => string;
	onChange?: (items: T[]) => void;
	onNativeChange?: (
		sourceId: string,
		targetId: string,
		closestEdgeOfTarget: Edge | null
	) => void;
	axis?: "vertical" | "horizontal";
}

export default function <T>(props: SortableContextProps<T>) {
	const itemsRef = useRef(props.items);
	const getIdRef = useRef(props.getId);
	const onChangeRef = useRef(props.onChange);
	const onNativeChangeRef = useRef(props.onNativeChange);
	const axisRef = useRef(props.axis);

	itemsRef.current = props.items;
	getIdRef.current = props.getId;
	onChangeRef.current = props.onChange;
	onNativeChangeRef.current = props.onNativeChange;
	axisRef.current = props.axis;

	const onSort = useCallback(
		(
			items: T[],
			sourceId: string,
			targetId: string,
			closestEdgeOfTarget: Edge | null
		) => {
			const getId = getIdRef.current;
			const startIndex = items.findIndex((i) => getId(i) == sourceId);
			const indexOfTarget = items.findIndex((i) => getId(i) == targetId);
			const finishIndex = getReorderDestinationIndex({
				startIndex,
				closestEdgeOfTarget,
				indexOfTarget,
				axis: axisRef.current || "vertical",
			});
			if (finishIndex == undefined || startIndex == finishIndex) {
				return;
			}
			const newItems = reorder({
				list: items,
				startIndex: startIndex,
				finishIndex: finishIndex,
			});
			onChangeRef.current?.(newItems);
		},
		[]
	);

	useEffect(() => {
		return monitorForElements({
			canMonitor: (args) => {
				const source = args.source;
				const itemId = source.data.itemId as string;
				return itemsRef.current.some((item) => getIdRef.current(item) === itemId);
			},
			onDrop: (args) => {
				const { location, source } = args;
				if (!location.current.dropTargets.length) {
					return;
				}

				if (source.data.type == "sortable-item") {
					const target = location.current.dropTargets.find(
						(t) => t.data.type == "sortable-item"
					);
					if (!target) {
						return;
					}
					const closestEdgeOfTarget = extractClosestEdge(target.data);
					if (onNativeChangeRef.current) {
						onNativeChangeRef.current(
							source.data.itemId as string,
							target.data.itemId as string,
							closestEdgeOfTarget
						);
					} else {
						onSort(
							itemsRef.current,
							source.data.itemId as string,
							target.data.itemId as string,
							closestEdgeOfTarget
						);
					}
				}
			},
		});
	}, [onSort]);
}
