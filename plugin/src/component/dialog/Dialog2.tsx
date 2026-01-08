import { X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import React from "react";
import "./Dialog2.css";
import { Strings } from "src/utils/Strings";
import { localInstance } from "src/i18n/locals";

export default function Dialog2(props: {
	/** 兼容：原有字符串标题 */
	title?: string;
	/** 可选：自定义标题节点（优先于 title） */
	titleNode?: React.ReactNode;
	/** 可选：标题行右侧内容（如按钮） */
	titleRight?: React.ReactNode;
	description?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	dialogClassName?: string;
	modal?: boolean;
	children?: (close: () => void) => JSX.Element;
}) {
	const { title, titleNode, titleRight, open, onOpenChange, description } = props;
	const showTitle = titleNode != null || Strings.isNotBlank(title);
	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={onOpenChange}
			modal={props.modal === true}
		>
			<DialogPrimitive.Portal container={window.activeDocument.body}>
				<div className="form--DialogRoot">
					<div className="form--DialogOverlay" />
					<DialogPrimitive.Content
						className={`form--DialogContent ${
							props.dialogClassName || ""
						}`}
					>
						{showTitle ? (
							<div className="form--DialogHeader">
								<DialogPrimitive.Title className="form--DialogTitle">
									{titleNode ?? title}
								</DialogPrimitive.Title>
								{titleRight ? (
									<div className="form--DialogTitleRight">
										{titleRight}
									</div>
								) : null}
							</div>
						) : (
							<VisuallyHidden asChild>
								<DialogPrimitive.Title>
									Dialog
								</DialogPrimitive.Title>
							</VisuallyHidden>
						)}
						{description ? (
							<DialogPrimitive.Description className="form--DialogDescription">
								{description}
							</DialogPrimitive.Description>
						) : (
							<VisuallyHidden asChild>
								<DialogPrimitive.Description>
									Description
								</DialogPrimitive.Description>
							</VisuallyHidden>
						)}
						{props.children && (
							<div className="form--DialogPanelChildren">
								{props.children(() => onOpenChange(false))}
							</div>
						)}
						<DialogPrimitive.Close asChild>
							<button
								className="form--DialogCloseButton"
								aria-label={localInstance.close}
								onClick={() => onOpenChange(false)}
							>
								<X size={18} />
							</button>
						</DialogPrimitive.Close>
					</DialogPrimitive.Content>
				</div>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
