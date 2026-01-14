import { Popover as RadixPopover } from "radix-ui";
import React from "react";
import "./Popover.css";

export type PopoverProps = {
	children: React.ReactNode | React.ReactNode[];
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	sideOffset?: number;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
	modal?: boolean;
};

export function Popover(props: PopoverProps) {
	const {
		open,
		children,
		side = "bottom",
		align = "start",
		sideOffset = 16,
		onOpenChange,
		defaultOpen,
		modal = false,
	} = props;

	const triggerElement = Array.isArray(children) ? children[0] : null;
	const contentElements = Array.isArray(children) ? children.slice(1) : null;

	return (
		<RadixPopover.Root
			open={open}
			onOpenChange={onOpenChange}
			defaultOpen={defaultOpen}
			modal={modal}
		>
			<RadixPopover.Trigger asChild>
				{triggerElement}
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					sideOffset={sideOffset}
					side={side}
					align={align}
					className="form--PopoverContent"
					onOpenAutoFocus={(event) => {
						// 阻止自动聚焦，防止意外触发关闭逻辑
						event.preventDefault();
					}}
					onInteractOutside={(event) => {
						// 阻止点击外部立即关闭，给用户时间操作
						event.preventDefault();
					}}
					collisionPadding={{
						left: 16,
						right: 16,
						top: 8,
						bottom: 8,
					}}
				>
					{contentElements}
					<RadixPopover.Arrow className="form--PopoverArrow" />
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
