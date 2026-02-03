import { DropIndicator } from "@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef } from "react";
import { DragHandler } from "src/component/drag-handler/DragHandler";
import useSortable from "src/hooks/useSortable";
import useSortableItem from "src/hooks/useSortableItem";
import { localInstance } from "src/i18n/locals";
import "./InteractiveList.css";

export interface WithId {
	id: string;
}

const VIRTUALIZATION_THRESHOLD = 50;
const DEFAULT_ITEM_HEIGHT = 50;
const OVERSCAN_COUNT = 5;
const LIST_MAX_HEIGHT = 360;
const ITEM_GAP = "0.5rem";

export type InteractiveListProps<T extends WithId> = {
	title?: string;
	items: T[];
	onChange: (items: T[]) => void;
	onAdd?: () => void;
	addButtonLabel?: string;
	children: (
		item: T,
		index: number,
		removeItem: (item: T) => void
	) => React.ReactNode;
	className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "onChange">;

export function InteractiveList<T extends WithId>({
	title,
	items,
	onChange,
	onAdd,
	addButtonLabel = "+ " + localInstance.add,
	children,
	className,
	...rest
}: InteractiveListProps<T>): React.ReactElement {
	const parentRef = useRef<HTMLDivElement>(null);
	useSortable({
		items,
		getId: (item) => item.id,
		onChange,
	});

	const removeItem = useCallback(
		(item: T) => {
			const newItems = items.filter((i) => i.id !== item.id);
			onChange(newItems);
		},
		[items, onChange]
	);

	const shouldVirtualize = items.length >= VIRTUALIZATION_THRESHOLD;
	const listStyle = useMemo<React.CSSProperties>(
		() => ({
			maxHeight: LIST_MAX_HEIGHT,
			overflowY: "auto",
		}),
		[]
	);
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => DEFAULT_ITEM_HEIGHT,
		overscan: OVERSCAN_COUNT,
		getItemKey: (index) => items[index]?.id ?? index,
	});

	return (
		<div
			className={`form--InteractiveList ${className || ""}`}
			{...rest}
		>
			{title && (
				<div className="form--InteractiveListTitle">{title}</div>
			)}
			<div
				ref={parentRef}
				className="form--InteractiveListItems"
				style={listStyle}
			>
				{shouldVirtualize ? (
					<div
						style={{
							height: virtualizer.getTotalSize(),
							width: "100%",
							position: "relative",
						}}
					>
						{virtualizer.getVirtualItems().map((row) => {
							const item = items[row.index];
							if (!item) {
								return null;
							}
							return (
								<div
									key={item.id}
									ref={virtualizer.measureElement}
									style={{
										position: "absolute",
										top: 0,
										left: 0,
										width: "100%",
										transform: `translateY(${row.start}px)`,
										paddingBottom:
											row.index === items.length - 1
												? 0
												: ITEM_GAP,
									}}
								>
									{children(item, row.index, removeItem)}
								</div>
							);
						})}
					</div>
				) : (
					items.map((item, index) =>
						children(item, index, removeItem)
					)
				)}
			</div>
			{onAdd && (
				<button
					className="form--AddButton"
					style={{
						width: "100%",
					}}
					onClick={(e) => {
						e.stopPropagation();
						onAdd();
					}}
				>
					{addButtonLabel}
				</button>
			)}
		</div>
	);
}

export interface InteractiveListItemProps<T extends WithId> {
	item: T;
	children: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}

export function InteractiveListItem<T extends WithId>({
	item,
	children,
	className,
	style,
	...rest
}: InteractiveListItemProps<T> &
	Omit<
		React.HTMLAttributes<HTMLDivElement>,
		"children"
	>): React.ReactElement {
	const { closestEdge, setElRef, setDragHandleRef } = useSortableItem(
		item.id,
		["top", "bottom"],
		() => true
	);

	return (
		<div
			ref={setElRef}
			className={`form--InteractiveListItem ${className || ""}`}
			style={style}
			{...rest}
		>
			<div className="form--InteractiveListItemDrag">
				<DragHandler ref={setDragHandleRef} />
			</div>
			<div className="form--InteractiveListItemContent">
				{children}
			</div>
			{closestEdge && <DropIndicator edge={closestEdge} gap="1px" />}
		</div>
	);
}
